import { describe, expect, it } from "vitest";

import { formatCoverageDate } from "./format-date";

describe("formatCoverageDate", () => {
  it("reads a stored date back the way a person writes it", () => {
    expect(formatCoverageDate("2026-05-02")).toBe("May 2, 2026");
    expect(formatCoverageDate("2026-01-01")).toBe("January 1, 2026");
    expect(formatCoverageDate("2027-12-31")).toBe("December 31, 2027");
  });

  it("keeps the day the certificate says, not the day a timezone shifts it to", () => {
    // The bug this guards: "2026-05-02" parsed as UTC midnight and formatted in
    // a zone west of UTC renders as May 1. Built in UTC and formatted in UTC,
    // it is the 2nd in every environment. New Year's Day is the sharpest case —
    // an off-by-one there moves the year, not just the day.
    expect(formatCoverageDate("2026-05-02")).toBe("May 2, 2026");
    expect(formatCoverageDate("2026-01-01")).toBe("January 1, 2026");
  });

  it("degrades to the raw value rather than throwing on a malformed date", () => {
    expect(formatCoverageDate("")).toBe("");
    expect(formatCoverageDate("nonsense")).toBe("nonsense");
    expect(formatCoverageDate("2026-13")).toBe("2026-13");
  });
});
