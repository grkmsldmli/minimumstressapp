import { describe, expect, it } from "vitest";

import { explainRedaction, isEmptyAfterRedaction, redact } from "./message-redaction";

/**
 * Two failure directions, and the second is worse.
 *
 * Missing a phone number costs one booking's commission. Masking "be there at
 * 5:30" teaches a host that the feature is broken, and they stop using the
 * thread — which loses every message after it, including the one where
 * something goes wrong.
 */

const hidden = (text: string) => text.includes("[hidden]");

describe("what must be caught", () => {
  it.each([
    "call me on 415 555 0134",
    "my mobile is +1 (415) 555-0134",
    "4155550134",
    "415-555-0134",
    "reach me at 415.555.0134",
  ])("hides a phone number in %s", (input) => {
    const result = redact(input);
    expect(hidden(result.text)).toBe(true);
    expect(result.found).toContain("phone");
  });

  /** Spelling it out is the first thing anybody tries. */
  it("hides a number written as words", () => {
    const result = redact("four one five five five five zero one three four");
    expect(result.found).toContain("phone");
  });

  it.each([
    "email me at sam@example.com",
    "sam (at) example.com",
    "sam@example.co.uk",
  ])("hides an email in %s", (input) => {
    expect(redact(input).found).toContain("email");
  });

  it.each(["see https://mysite.com/booking", "go to www.mystudio.com"])(
    "hides a link in %s",
    (input) => {
      expect(redact(input).found).toContain("link");
    },
  );

  /**
   * "find me at mystudio.com" is genuinely both — the obfuscated-email pattern
   * reads " at " as "@", and it is not wrong to. Which label it lands under
   * changes one word in the note back to the sender; whether it is hidden is
   * the part that matters, so that is what is asserted.
   */
  it("hides an address that reads as either a link or an email", () => {
    const result = redact("find me at mystudio.com");
    expect(hidden(result.text)).toBe(true);
    expect(result.found.length).toBeGreaterThan(0);
  });

  it.each(["message me on whatsapp", "I'm @samyoga on instagram", "add me on telegram"])(
    "hides a handle in %s",
    (input) => {
      expect(redact(input).found).toContain("handle");
    },
  );

  /** Moving the money off-platform removes the refund guarantee with it. */
  it.each(["venmo me", "pay by paypal", "cashapp is easier", "send to $samyoga"])(
    "hides payment details in %s",
    (input) => {
      expect(redact(input).found).toContain("payment");
    },
  );

  it("hides several kinds in one message", () => {
    const result = redact("call 415 555 0134 or email sam@example.com");
    expect(result.found).toContain("phone");
    expect(result.found).toContain("email");
  });
});

describe("what must survive", () => {
  it.each([
    "See you at 5:30",
    "I'll be 10 minutes late",
    "The session runs 60 minutes",
    "Door code is on the app",
    "Room 3 on the second floor",
    "Bring 2 mats if you can",
  ])("leaves %s alone", (input) => {
    expect(redact(input).text).toBe(input);
  });

  /** A price is digits and punctuation, and masking one reads as a bug. */
  it.each(["That's $45.00 an hour", "£120 for the block", "€60 per session"])(
    "leaves the price in %s alone",
    (input) => {
      expect(hidden(redact(input).text)).toBe(false);
    },
  );

  it("leaves a date alone", () => {
    expect(hidden(redact("Booked for 2026-08-04").text)).toBe(false);
  });

  it("leaves an ordinary sentence entirely untouched", () => {
    const message = "Hi — is there parking nearby, and can I get in a few minutes early?";
    const result = redact(message);
    expect(result.text).toBe(message);
    expect(result.found).toEqual([]);
  });

  /** Four digits is a door code or a year, not a phone number. */
  it.each(["The code is 4417", "Since 2019", "Suite 200"])("leaves %s alone", (input) => {
    expect(hidden(redact(input).text)).toBe(false);
  });
});

describe("explainRedaction", () => {
  it("says nothing when nothing was hidden", () => {
    expect(explainRedaction([])).toBeNull();
  });

  it("names one thing plainly", () => {
    expect(explainRedaction(["phone"])).toContain("a phone number");
  });

  it("lists several readably", () => {
    const message = explainRedaction(["phone", "email"]);
    expect(message).toContain("a phone number and an email address");
  });

  /**
   * The reason is given as what the person loses, not as a rule they broke.
   * "Against our terms" invites working around it; "the refund stops working"
   * is the actual consequence.
   */
  it("explains the consequence rather than citing a policy", () => {
    const message = explainRedaction(["phone"]) ?? "";
    expect(message.toLowerCase()).not.toContain("policy");
    expect(message.toLowerCase()).not.toContain("terms");
  });
});

describe("isEmptyAfterRedaction", () => {
  it("is true when the message was only a phone number", () => {
    expect(isEmptyAfterRedaction(redact("415 555 0134"))).toBe(true);
  });

  it("is false when something readable survives", () => {
    expect(isEmptyAfterRedaction(redact("call me on 415 555 0134"))).toBe(false);
  });

  it("is true for an empty message", () => {
    expect(isEmptyAfterRedaction(redact("   "))).toBe(true);
  });
});
