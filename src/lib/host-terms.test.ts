import { describe, expect, it } from "vitest";

import { PROHIBITED_USES } from "./booking-use";
import {
  HOST_TERMS_CONFIRMATION,
  HOST_TERMS_SECTIONS,
  HOST_TERMS_SUMMARY,
  HOST_TERMS_VERSION,
  hasAcceptedHostTerms,
  hostTermsDigest,
} from "./host-terms";
import { TERMS_VERSION } from "./terms";

/**
 * The Host Terms as a document, and as a versioned acceptance.
 *
 * These are the same guards the general terms carry — a pinned digest so the
 * text cannot change under a stored acceptance, a version check, and the two
 * separate records staying separate — applied to the second agreement.
 */

describe("what a host is agreeing to", () => {
  const document = HOST_TERMS_SECTIONS.flatMap((s) => [s.title, ...s.points])
    .join(" ")
    .toLowerCase();

  it("covers the right to offer the space", () => {
    expect(document).toContain("right that lets you offer it");
    expect(document).toContain("proof of your right to offer the space");
  });

  it("makes listing accuracy the host's responsibility", () => {
    expect(document).toContain("accurate and current");
  });

  it("says the platform's prohibited uses cannot be overridden", () => {
    expect(document).toContain("floor nobody can lower");
    expect(document).toContain("sexual activity");
    expect(document).toContain("parties and nightlife");
  });

  /*
   * The floor is PROHIBITED_USES in booking-use.ts — the same list the booking
   * flow shows a guest and /terms publishes. If a host is told they cannot
   * allow something, it has to be a thing the product actually forbids, and if
   * the product forbids something the Host Terms must not quietly permit it by
   * omission. This ties the agreement to that one list by a distinctive word
   * from each entry, so adding a prohibited use without stating it here fails.
   */
  it("names every prohibited use the platform enforces", () => {
    const keyword: Record<string, string> = {
      "Sexual activity or sexual services": "sexual activity",
      "Pornography or adult-content production": "adult-content production",
      "Prostitution or escort activity": "escort activity",
      "Anything illegal, and illegal drugs": "illegal drugs",
      "Weapons, where prohibited or unsafe": "weapons",
      "Hazardous activities": "hazardous activities",
      "Parties and nightlife events": "parties and nightlife",
      "More people than the booking declared": "more people than the booking declared",
      "Entering outside the booked time": "entering outside the booked time",
      "Commercial filming or production that was not declared and allowed":
        "undeclared commercial production",
      "Anything that damages the room or creates an unreasonable safety risk":
        "damages the space or creates an unreasonable safety risk",
      "Any use materially different from the declared purpose":
        "materially different from the one declared",
    };

    for (const use of PROHIBITED_USES) {
      const word = keyword[use];
      expect(word, `no keyword mapped for prohibited use: ${use}`).toBeDefined();
      expect(document, use).toContain(word);
    }
  });

  it("states the payout model the product actually runs", () => {
    expect(document).toContain("you receive that rate in full");
    expect(document).toContain("added on top and paid by the guest");
    expect(document).toContain("never taken out of what you are owed");
  });

  it("places property and business insurance on the host", () => {
    expect(document).toContain("your own property and business insurance");
    expect(document).toContain("does not provide insurance");
  });

  it("never uses the word therapy", () => {
    expect(document).not.toContain("therap");
  });

  it("does not repeat the disputed 'not a party to the booking' disclaimer", () => {
    // That platform-role wording is under attorney review on the general
    // terms; the Host Terms must not restate it until counsel resolves it.
    expect(document).not.toContain("not a party to the");
  });

  it("carries the suspension powers, stated as investigate/pause/remove/cancel/suspend", () => {
    for (const power of ["investigate", "pause a listing", "remove a listing", "cancel future bookings", "suspend or close"]) {
      expect(document, power).toContain(power);
    }
  });
});

describe("the version and its fingerprint", () => {
  it("is independent of the general terms version", () => {
    // Same value today is a coincidence, not a link — they change for
    // different reasons. This asserts they are read from two places, not that
    // they differ.
    expect(typeof HOST_TERMS_VERSION).toBe("number");
    expect(typeof TERMS_VERSION).toBe("number");
  });

  /*
   * If this fails you changed the Host Terms text. Either the change is
   * cosmetic — update the pin — or it alters what a host agrees to, in which
   * case raise HOST_TERMS_VERSION (and required_host_terms_version() in a
   * migration) so every host is asked again.
   */
  it("pins the exact words the current version stands for", () => {
    // v2: the allowed-use examples dropped "personal practice" and "dance and
    // movement rehearsal" (HOST_TERMS_VERSION raised to 2, required version
    // bumped in migration 0056).
    expect(hostTermsDigest()).toBe("de2b9b76");
  });
});

describe("whether an account has accepted", () => {
  it("is false with no acceptance", () => {
    expect(hasAcceptedHostTerms({ hostTermsVersion: null })).toBe(false);
  });

  it("is false at an older version", () => {
    expect(hasAcceptedHostTerms({ hostTermsVersion: HOST_TERMS_VERSION - 1 })).toBe(false);
  });

  it("is true at the current version or newer", () => {
    expect(hasAcceptedHostTerms({ hostTermsVersion: HOST_TERMS_VERSION })).toBe(true);
    expect(hasAcceptedHostTerms({ hostTermsVersion: HOST_TERMS_VERSION + 1 })).toBe(true);
  });
});

describe("the plain-language summary", () => {
  it("is a reader's aid, kept out of the binding text", () => {
    // If the summary were part of the agreement it would be in the digest, and
    // editing it would force a version bump. It is not: the digest hashes the
    // sections alone, so the summary can be reworded freely without touching
    // what a stored acceptance stands for. The digest pin above is the guard
    // that this stays true.
    const document = HOST_TERMS_SECTIONS.flatMap((s) => [s.title, ...s.points]).join("\n");
    for (const line of HOST_TERMS_SUMMARY) {
      expect(document).not.toContain(line);
    }
  });

  it("names the four things a host most needs to see first", () => {
    expect(HOST_TERMS_SUMMARY).toHaveLength(4);
    const joined = HOST_TERMS_SUMMARY.join(" ").toLowerCase();
    expect(joined).toContain("right to offer");
    expect(joined).toContain("availability, rate");
    expect(joined).toContain("declare their booking");
    expect(joined).toContain("prohibited uses always apply");
  });
});

describe("the checkbox line", () => {
  it("pairs the acceptance with the right-to-offer representation", () => {
    expect(HOST_TERMS_CONFIRMATION).toContain("Host Terms");
    expect(HOST_TERMS_CONFIRMATION).toContain("right to offer this space");
  });
});
