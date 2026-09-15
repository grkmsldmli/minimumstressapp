import { describe, expect, it } from "vitest";

import { NOTIFICATION_KINDS, render, toHtml } from "./messages";

/**
 * The failure mode here is not an exception. It is a correct delivery of the
 * wrong number to a real person, so these check what the words actually say.
 */

/**
 * Read from the source list rather than copied. The copy that used to be here
 * had stopped at `payout_failed`, so seven kinds — every refund and claim
 * message the app sends — were never checked for a leaked `undefined`.
 */
const ALL_KINDS = NOTIFICATION_KINDS;

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

describe("insurance review", () => {
  it("names the outcome and, when we have it, the cover expiry", () => {
    const message = render("insurance_verified", { name: "Sam", until: "May 2, 2027" });
    expect(message.subject).toMatch(/verified/i);
    expect(message.body).toMatch(/verified and is now on file/i);
    expect(message.body).toContain("Coverage expires: May 2, 2027");
    // Booking is subject to the normal gates, not guaranteed by insurance alone.
    expect(message.body).toMatch(/subject to the normal booking requirements/i);
  });

  it("promises nothing it cannot keep", () => {
    const message = render("insurance_verified", { name: "Sam", until: "May 2, 2027" });
    // There is no expiry-reminder scheduler, so it must not promise one.
    expect(message.body).not.toMatch(/remind|we'?ll ask|before then|fresh certificate/i);
  });

  it("reads cleanly when the expiry is not supplied", () => {
    const message = render("insurance_verified", { name: "Sam" });
    expect(message.body).toMatch(/verified and is now on file/i);
    // No empty "Coverage expires:" line, and no leaked slot.
    expect(message.body).not.toMatch(/coverage expires/i);
    expect(message.body).not.toMatch(/undefined|null/i);
  });

  it("carries the reviewer's own words and says what to do next", () => {
    const message = render("insurance_rejected", {
      name: "Sam",
      note: "The second page of the certificate is cut off.",
    });
    expect(message.subject).toMatch(/action needed/i);
    expect(message.body).toContain("The second page of the certificate is cut off.");
    expect(message.body).toMatch(/upload/i);
  });

  it("still reads as a rejection when no note is attached", () => {
    const message = render("insurance_rejected", { name: "Sam" });
    expect(message.body).toMatch(/could not verify/i);
    expect(message.body).toMatch(/upload/i);
    expect(message.body).not.toMatch(/why:\s*[.\n]/i);
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

describe("privacy-safe push", () => {
  it("provides generic lock-screen copy for every user-facing kind", () => {
    for (const kind of ALL_KINDS) {
      const { push } = render(kind, FULL);
      if (kind === "staff_waiting") {
        expect(push).toBeNull();
        continue;
      }

      expect(push).toMatchObject({
        title: expect.any(String),
        body: expect.any(String),
        url: expect.stringMatching(/^https:\/\//),
      });
      expect(push!.title.length).toBeGreaterThan(0);
      expect(push!.body.length).toBeGreaterThan(0);
    }
  });

  it("never copies private notification context onto the lock screen", () => {
    const privateValues = [
      "PRIVATE_NAME_781",
      "PRIVATE_SPACE_782",
      "PRIVATE_TIME_783",
      "PRIVATE_ADDRESS_784",
      "PRIVATE_CODE_785",
      "PRIVATE_ENTRY_786",
      "PRIVATE_REASON_787",
      "PRIVATE_NOTE_788",
      "PRIVATE_PURPOSE_789",
      "PRIVATE_CLASS_790",
    ];
    const context = {
      name: privateValues[0],
      spaceName: privateValues[1],
      when: privateValues[2],
      address: privateValues[3],
      accessCode: privateValues[4],
      entryInstructions: privateValues[5],
      reason: privateValues[6],
      note: privateValues[7],
      purpose: privateValues[8],
      className: privateValues[9],
      amountCents: 987654321,
      chargedCents: 987654321,
      refundedCents: 987654321,
    };

    for (const kind of ALL_KINDS) {
      const push = render(kind, context).push;
      if (!push) continue;
      const serialized = JSON.stringify(push);
      for (const value of [...privateValues, "987654321"]) {
        expect(serialized).not.toContain(value);
      }
      expect(serialized).not.toMatch(/undefined|null|NaN|\[object|\$\{/);
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
  it("does not invent a refund when Stripe reports that no money moved", () => {
    const body = render("cancelled_by_practitioner", {
      ...FULL,
      chargedCents: 0,
      refundedCents: 0,
    }).body;

    expect(body).toMatch(/nothing remains charged/i);
    expect(body).not.toMatch(/working days|on its way back/i);
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
    expect(body).toMatch(/working days/i);
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

describe("lifecycle receipts", () => {
  it("describes a submitted request as held, not charged, with a deadline and no action", () => {
    const message = render("request_submitted", {
      ...FULL,
      deadline: "Monday, Sep 14 at 4:00 PM PDT",
    });

    expect(message.body).toContain("temporary hold for $54.00");
    expect(message.body).toContain("authorization, not a charge");
    expect(message.body).toContain("Monday, Sep 14 at 4:00 PM PDT");
    expect(message.body).toContain("No action is needed from you");
  });

  it("describes a host transfer without claiming it reached the bank", () => {
    const message = render("host_payout_sent", FULL);

    expect(message.body).toContain("sent to your Stripe connected balance");
    expect(message.body).toContain("not a bank deposit");
    expect(message.body).toMatch(/arrival time varies by bank and account/i);
    expect(message.body).not.toMatch(/arrived|deposited|reached your bank/i);
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

/**
 * The only message that tells somebody money has left their account. It was
 * missing entirely until a walkthrough noticed a host could lose a payout and
 * hear nothing, so what it says is the whole point of it existing.
 */
describe("taking a payout back", () => {
  const said = render("refund_taken_back", { ...FULL, amountCents: 4500 });

  it("names the amount in both the subject and the body", () => {
    expect(said.subject).toContain("$45.00");
    expect(said.body).toContain("$45.00");
  });

  /**
   * A claw-back reads like a fine, so the message says what it does to their
   * standing — as a fact, since reassurance about a rule is arguable in a way
   * a fact is not.
   */
  it("says what it does to their standing", () => {
    expect(said.body).toMatch(/standing is unchanged/i);
  });

  it("carries the reasoning staff wrote", () => {
    const withNote = render("refund_taken_back", { ...FULL, note: "The door was propped open." });
    expect(withNote.body).toContain("The door was propped open.");
  });
});

describe("toHtml", () => {
  it("escapes content rather than letting it become markup", () => {
    const html = toHtml(render("booking_confirmed", { ...FULL, spaceName: "<script>x</script>" }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps the content paragraphs and moves the sign-off into the footer", () => {
    const message = render("access_code_ready", FULL);
    const html = toHtml(message);
    expect(html.match(/<p /g)?.length).toBe(message.body.split("\n\n").length - 1);
    expect(html).toContain("<footer");
  });
});
