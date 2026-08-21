import { describe, expect, it } from "vitest";

import {
  checkInsuranceForBooking,
  insuranceCoversInterval,
  insuranceStatus,
  type InsuranceFacts,
} from "./insurance";

/*
 * The dates here are UTC on purpose. A policy is a window of whole days, and the
 * module treats an expiry date as covering all of its own day — the tests that
 * pin the inclusive boundary are the reason the +1-day-minus-1ms in the module
 * is not an accident waiting to be "simplified" away.
 */
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const at = (iso: string, time: string) => new Date(`${iso}T${time}:00Z`);
const HOUR_MS = 60 * 60 * 1000;
/** A one-hour session starting at `start`, as [startsAt, endsAt]. */
const session = (start: Date): [Date, Date] => [start, new Date(start.getTime() + HOUR_MS)];

const VERIFIED: InsuranceFacts = {
  hasCertificate: true,
  state: "verified",
  effectiveDate: d("2026-01-01"),
  expiresAt: d("2026-12-31"),
};

describe("insuranceStatus — the word shown on a profile", () => {
  const NOW = d("2026-06-01");

  it("is not_added when no certificate was ever uploaded", () => {
    expect(
      insuranceStatus(
        { hasCertificate: false, state: "pending", effectiveDate: null, expiresAt: null },
        NOW,
      ),
    ).toBe("not_added");
  });

  it("is pending_review while a certificate sits unreviewed", () => {
    expect(
      insuranceStatus(
        { hasCertificate: true, state: "pending", effectiveDate: null, expiresAt: null },
        NOW,
      ),
    ).toBe("pending_review");
  });

  it("is rejected when staff turned it down", () => {
    expect(
      insuranceStatus(
        { hasCertificate: true, state: "rejected", effectiveDate: null, expiresAt: null },
        NOW,
      ),
    ).toBe("rejected");
  });

  it("is verified while the window is open", () => {
    expect(insuranceStatus(VERIFIED, NOW)).toBe("verified");
  });

  it("ages a verified certificate into expired without the row changing", () => {
    // Same verified row, read after its window — the DB still says 'verified'.
    expect(insuranceStatus(VERIFIED, d("2027-06-01"))).toBe("expired");
  });

  it("still reads verified on the last day of the window", () => {
    expect(insuranceStatus(VERIFIED, d("2026-12-31"))).toBe("verified");
  });
});

describe("checkInsuranceForBooking — the gate the server runs", () => {
  const NOW = d("2026-06-01");
  const [START, END] = session(at("2026-06-15", "10:00"));

  it("passes a session wholly inside a verified window", () => {
    expect(checkInsuranceForBooking(VERIFIED, START, END, NOW)).toBeNull();
  });

  it("refuses when no certificate exists", () => {
    expect(
      checkInsuranceForBooking(
        { hasCertificate: false, state: "pending", effectiveDate: null, expiresAt: null },
        START,
        END,
        NOW,
      ),
    ).toBe("insurance_required");
  });

  it("refuses while a certificate is still being reviewed", () => {
    expect(
      checkInsuranceForBooking(
        { hasCertificate: true, state: "pending", effectiveDate: null, expiresAt: null },
        START,
        END,
        NOW,
      ),
    ).toBe("insurance_pending");
  });

  it("refuses a rejected certificate", () => {
    expect(
      checkInsuranceForBooking(
        { hasCertificate: true, state: "rejected", effectiveDate: null, expiresAt: null },
        START,
        END,
        NOW,
      ),
    ).toBe("insurance_rejected");
  });

  it("refuses cover that has already lapsed, whatever the session's dates", () => {
    // now is past the window; the session is inside it, and it still fails.
    const [s, e] = session(at("2026-12-30", "10:00"));
    expect(checkInsuranceForBooking(VERIFIED, s, e, d("2027-01-05"))).toBe("insurance_expired");
  });

  it("refuses a future session the live cover does not reach", () => {
    const [s, e] = session(at("2027-03-01", "10:00"));
    expect(checkInsuranceForBooking(VERIFIED, s, e, NOW)).toBe("insurance_not_valid_for_date");
  });

  it("refuses a session that begins before cover does", () => {
    const [s, e] = session(at("2025-12-31", "10:00"));
    expect(checkInsuranceForBooking(VERIFIED, s, e, d("2025-12-01"))).toBe(
      "insurance_not_valid_for_date",
    );
  });

  it("treats a verified row with missing dates as no usable cover", () => {
    expect(
      checkInsuranceForBooking(
        { hasCertificate: true, state: "verified", effectiveDate: null, expiresAt: null },
        START,
        END,
        NOW,
      ),
    ).toBe("insurance_required");
  });

  /*
   * The interval, not the day. These are the tests behind "cover the entire
   * booking interval" — the same start date passes or fails on where the
   * session *ends* and *begins*, which a day-only check could not tell apart.
   */
  describe("the whole session interval must be covered", () => {
    it("passes a session that begins and ends inside the last covered day", () => {
      const [s, e] = session(at("2026-12-31", "10:00")); // 10:00–11:00 on the expiry day
      expect(checkInsuranceForBooking(VERIFIED, s, e, NOW)).toBeNull();
    });

    it("refuses a session that starts on the last day but runs past midnight", () => {
      // 23:30 on the expiry day to 00:30 the next: the start is covered, the end is not.
      const start = at("2026-12-31", "23:30");
      const end = new Date(start.getTime() + HOUR_MS); // 2027-01-01 00:30
      expect(checkInsuranceForBooking(VERIFIED, start, end, NOW)).toBe(
        "insurance_not_valid_for_date",
      );
    });

    it("passes a session at the very start of the effective day", () => {
      const [s, e] = session(d("2026-01-01")); // 00:00–01:00 on the effective day
      expect(checkInsuranceForBooking(VERIFIED, s, e, NOW)).toBeNull();
    });

    it("refuses a session that starts the moment before cover begins", () => {
      // 23:30 the day before effective to 00:30 on it: the start is not covered.
      const start = at("2025-12-31", "23:30");
      const end = new Date(start.getTime() + HOUR_MS); // 2026-01-01 00:30
      expect(checkInsuranceForBooking(VERIFIED, start, end, d("2025-12-01"))).toBe(
        "insurance_not_valid_for_date",
      );
    });
  });
});

describe("insuranceCoversInterval — the same gate, asked about a session", () => {
  it("is true for a session inside a verified window", () => {
    const [s, e] = session(at("2026-06-15", "10:00"));
    expect(insuranceCoversInterval(VERIFIED, s, e)).toBe(true);
  });

  it("is false for a session whose end falls past the window", () => {
    const start = at("2026-12-31", "23:30");
    const end = new Date(start.getTime() + HOUR_MS);
    expect(insuranceCoversInterval(VERIFIED, start, end)).toBe(false);
  });
});
