import { Check } from "lucide-react";

import type { PractitionerTrust } from "@/lib/domain";

/**
 * The trust signals a host reads about a practitioner — the craft, the verified
 * facts, and a plain count of completed sessions.
 *
 * Facts only, never a claim about quality: "Identity verified", not "Certified".
 * Everything here is already established platform data (see host_requests /
 * host_bookings); no document, number, or contact detail ever reaches it. Each
 * badge appears only when true, so an unverified or borderline practitioner is
 * shown by the absence of a line rather than a warning painted on them.
 */
export function PractitionerTrustSummary({
  craft,
  trust,
  compact = false,
}: {
  /** The profession label, e.g. "Pilates Instructor". Omitted when unset. */
  craft?: string;
  trust: PractitionerTrust;
  /** One tight line of badges, for a dense history row rather than a decision. */
  compact?: boolean;
}) {
  const badges: string[] = [];
  if (trust.identityVerified) badges.push("Identity verified");
  if (trust.insuranceVerified) badges.push("Insurance verified");
  // Only when a credential was actually reviewed — a factual "reviewed", never a
  // claim that the platform certifies the work. Absent for professions that need
  // no credential, so it never reads as something missing.
  if (trust.credentialReviewed) badges.push("Credential reviewed");
  if (trust.goodStanding) badges.push("Good standing");

  const sessions =
    trust.completedSessions > 0
      ? `${trust.completedSessions} completed ${trust.completedSessions === 1 ? "session" : "sessions"}`
      : null;

  if (compact) {
    const parts = [craft, ...badges, sessions].filter(Boolean) as string[];
    if (parts.length === 0) return null;
    return (
      <p className="font-body font-normal text-[12.5px] text-ink-soft">{parts.join(" · ")}</p>
    );
  }

  return (
    <div className="mt-1">
      {craft && <p className="font-body font-normal text-[13.5px] text-ink-soft">{craft}</p>}
      {badges.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
          {badges.map((badge) => (
            <li
              key={badge}
              className="flex items-center gap-1 font-body font-medium text-[12.5px] text-positive"
            >
              <Check size={12} className="shrink-0" />
              {badge}
            </li>
          ))}
        </ul>
      )}
      {sessions && (
        <p className="font-body font-normal text-[12.5px] mt-1 text-ink-faint">{sessions}</p>
      )}
    </div>
  );
}
