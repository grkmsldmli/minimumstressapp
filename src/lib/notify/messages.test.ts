import { describe, expect, it } from "vitest";

import { type NotificationKind, render, toHtml } from "./messages";

/**
 * The failure mode here is not an exception. It is a correct delivery of the
 * wrong number to a real person, so these check what the words actually say.
 */

const ALL_KINDS: NotificationKind[] = [
  "booking_confirmed",
  "host_new_booking",
  "access_code_ready",
  "cancelled_by_practitioner",
  "cancelled_by_host",
  "reliability_warning",
  "reliability_suspended",
  "payout_failed",
];

const FULL = {
  name: "Elena",
  spaceName: "Willow",
  when: "Tuesday, Mar 4, 11:00 AM",
  address: "12 Alder Lane",
  accessCode: "4417",
  entryInstructions: "Keypad on the right door frame.",
  amountCents: 5400,
  chargedCents: 0,
  refundedCents: 5400,
  strikes: 3,
  limit: 3,
  until: "18 March",
  reason: "account closed",
};

describe("every kind", () => {
  it.each(ALL_KINDS)("%s produces a subject and a body", (kind) => {
    const message = render(kind, FULL);
    expect(message.subject.length).toBeGreaterThan(0);
    expect(message.body.length).toBeGreaterThan(0);
  });

  /** A `{}` or an `undefined` reaching a real inbox is the giveaway. */
  it.each(ALL_KINDS)("%s never leaks a placeholder", (kind) => {
    const message = render(kind, FULL);
    for (const text of [message.subject, message.body, message.sms ?? ""]) {
      expect(text).not.toMatch(/undefined|null|NaN|\[object|\$\{/);
    }
  });

  /** Missing context must degrade, not produce "your session at undefined". */
  it.each(ALL_KINDS)("%s survives an empty context", (kind) => {
    const message = render(kind, {});
    expect(message.body).not.toMatch(/undefined|NaN|\[object/);
  });
});

describe("what SMS is for", () => {
  /**
   * SMS is metered and it interrupts someone. Only the two kinds where being
   * told an hour later is too late should have any.
   */
  it("is reserved for the door code and a host pulling out", () => {
    const withSms = ALL_KINDS.filter((kind) => render(kind, FULL).sms !== null);
    expect(withSms).toEqual(["access_code_ready", "cancelled_by_host"]);
  });

  it("puts the code in the text rather than sending someone to look it up", () => {
    const { sms } = render("access_code_ready", FULL);
    expect(sms).toContain("4417");
    expect(sms).toContain("12 Alder Lane");
  });

  it("stays inside a single segment", () => {
    for (const kind of ALL_KINDS) {
      const { sms } = render(kind, FULL);
      if (sms) expect(sms.length).toBeLessThanOrEqual(160);
    }
  });

  /**
   * The text and the email land within a minute of each other. If they
   * disagree about whether money is coming back, the app has contradicted
   * itself to the same person twice.
   */
  it.each([
    [0, /not charged/i, /refund/i],
    [5400, /refunded/i, /not charged/i],
  ])("agrees with the email when refundedCents is %s", (refundedCents, expected, forbidden) => {
    const message = render("cancelled_by_host", { ...FULL, refundedCents });

    expect(message.sms).toMatch(expected);
    expect(message.sms).not.toMatch(forbidden);
    expect(message.body).toMatch(expected);
  });

  /** A blank line is wasted length in a format that charges by the character. */
  it("carries no paragraph breaks", () => {
    for (const kind of ALL_KINDS) {
      const { sms } = render(kind, FULL);
      if (sms) expect(sms).not.toContain("\n\n");
    }
  });
});

describe("money", () => {
  it("quotes the amount as currency, not cents", () => {
    expect(render("booking_confirmed", FULL).body).toContain("$54.00");
    // The refund, which is now the whole of what a host cancellation returns.
    expect(render("cancelled_by_host", FULL).body).toContain("$54.00");
  });

  /**
   * The host is told their rate. The practitioner's total is not theirs to
   * see — the same boundary host_bookings() enforces in SQL, and the caller
   * passes host_rate_cents for exactly this reason.
   */
  it("never explains the platform's fee to a host", () => {
    const body = render("host_new_booking", { ...FULL, amountCents: 4500 }).body;
    expect(body).toContain("$45.00");
    expect(body).not.toMatch(/service fee|our cut|platform/i);
  });

  /**
   * The money is taken at booking, so cancelling early is a real refund and has
   * to be described as one — with the wait attached.
   *
   * This test used to assert the opposite, and correctly so: the card was
   * authorised rather than charged, and calling a released hold a "refund"
   * would have had people watching a statement for a credit that was never
   * coming. Now the credit is coming, and saying "you were never charged"
   * would be the lie instead.
   */
  it("calls a refund a refund, and says when it lands", () => {
    const body = render("cancelled_by_practitioner", {
      ...FULL,
      chargedCents: 0,
      refundedCents: 0,
    }).body;

    expect(body).toMatch(/refunded in full/i);
    expect(body).toMatch(/working days/i);
    // The old promise. Nothing may still claim the card was left alone.
    expect(body).not.toMatch(/hold|authoris|never charged/i);
  });

  it("says charged in full when the 24-hour window was missed", () => {
    const body = render("cancelled_by_practitioner", {
      ...FULL,
      chargedCents: 5400,
      refundedCents: 0,
    }).body;

    expect(body).toMatch(/charged in full/i);
    expect(body).toContain("$54.00");
    expect(body).not.toMatch(/on its way back/i);
  });

  it("says a refund is coming only when money actually moved", () => {
    const body = render("cancelled_by_practitioner", {
      ...FULL,
      chargedCents: 0,
      refundedCents: 5400,
    }).body;

    expect(body).toContain("$54.00");
    expect(body).toMatch(/on its way back/i);
  });

  /** A host cancelling before capture owes an apology, not a refund promise. */
  it("does not promise a host-cancel refund that was never captured", () => {
    const body = render("cancelled_by_host", { ...FULL, refundedCents: 0 }).body;

    expect(body).toMatch(/not charged/i);
    expect(body).toMatch(/nothing to refund/i);
  });

  it("omits the credit line when no credit was given", () => {
    const body = render("cancelled_by_host", { ...FULL }).body;
    expect(body).not.toMatch(/credit to your account/i);
    expect(body).toMatch(/refunded/i);
  });
});

describe("suspension wording", () => {
  /**
   * The policy is that existing bookings are always honoured. If the message
   * fails to say so, a suspended host spends two weeks assuming their calendar
   * was cancelled.
   */
  it.each(["reliability_warning", "reliability_suspended"] as const)(
    "%s promises that booked sessions still go ahead",
    (kind) => {
      expect(render(kind, FULL).body).toMatch(/already booked|already in your calendar/i);
    },
  );
});

describe("toHtml", () => {
  it("escapes content rather than letting it become markup", () => {
    const html = toHtml(render("booking_confirmed", { ...FULL, spaceName: "<script>x</script>" }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps every paragraph", () => {
    const message = render("access_code_ready", FULL);
    const html = toHtml(message);
    expect(html.match(/<p /g)?.length).toBe(message.body.split("\n\n").length);
  });
});
