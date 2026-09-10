/**
 * A stored calendar date read back the way a person writes it: "May 2, 2026".
 *
 * Insurance coverage dates are a date with no time and no zone. Two forms reach
 * this: the raw "2026-05-02" string a reviewer typed, and the Date the domain
 * parses it into — which is UTC midnight of that day, because that is how the
 * bare string parses. Both are formatted in UTC, so the day shown is the day
 * the certificate says. Formatting a UTC-midnight date in a zone west of London
 * would render the evening before, slipping a certificate that runs to the 2nd
 * back to the 1st.
 *
 * Degrades to the raw value rather than throwing: a malformed date is a bad row
 * to surface, not a screen to crash.
 */
export function formatCoverageDate(value: string | Date): string {
  const date = typeof value === "string" ? isoDateToUtc(value) : value;
  if (!date || Number.isNaN(date.getTime())) {
    return typeof value === "string" ? value : "";
  }

  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "2026-05-02" as UTC midnight, or null when it is not that shape. */
function isoDateToUtc(iso: string): Date | null {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}
