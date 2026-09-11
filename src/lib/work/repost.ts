import type { CoverageRequest, SessionFormat } from "../domain";

/**
 * Prefill for reposting a past coverage request.
 *
 * A repost copies the *reusable class shape* — what the session is, who can
 * cover it, the qualifications, the pay — so a studio doesn't retype a class it
 * runs every week. It deliberately does NOT carry over:
 *   - the date/time: a repost is a NEW session and must be given a new future
 *     time (there is no field for it here, so the form starts empty and its
 *     future-time check applies unchanged);
 *   - the private-session context (goal, client experience, accommodations,
 *     programming): that describes one past session and could be stale, so it is
 *     dropped rather than silently reused. The host re-enters it fresh.
 *
 * Kept pure (no React) so "what a repost carries" is one readable, tested rule.
 */
export interface RepostPrefill {
  spaceId: string | null;
  title: string;
  profession: string;
  sessionFormat: SessionFormat;
  level: string;
  participantsExpected: string;
  participantsMax: string;
  audience: string;
  teachingNotes: string;
  equipmentNotes: string;
  requiredQuals: string;
  preferredQuals: string;
  /** Dollars, as the pay field shows them. */
  pay: string;
  /** Minutes, derived from the source's own start/end. */
  duration: string;
  urgent: boolean;
}

export function repostPrefill(r: CoverageRequest): RepostPrefill {
  const durationMinutes = Math.round((r.endsAt.getTime() - r.startsAt.getTime()) / 60000);
  return {
    spaceId: r.spaceId,
    title: r.title,
    profession: r.profession ?? "",
    sessionFormat: r.sessionFormat ?? "group",
    level: r.level ?? "",
    participantsExpected: r.participantsExpected != null ? String(r.participantsExpected) : "",
    participantsMax: r.participantsMax != null ? String(r.participantsMax) : "",
    audience: r.audience ?? "",
    teachingNotes: r.teachingNotes ?? "",
    equipmentNotes: r.equipmentNotes ?? "",
    requiredQuals: r.requiredQualifications.join(", "),
    preferredQuals: r.preferredQualifications.join(", "),
    pay: String(Math.round(r.payCents / 100)),
    duration: String(durationMinutes >= 15 ? durationMinutes : 60),
    urgent: r.urgent,
  };
}
