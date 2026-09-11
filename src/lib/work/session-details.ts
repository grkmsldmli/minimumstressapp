/**
 * The teaching/session columns shared by work_requests and class_templates
 * (migration 0070), mapped between the DB row and the SessionDetails domain
 * shape in one place so the request path, the template path, the mock and the
 * board never drift on what a listing carries.
 */

import type { ProgrammingMode, SessionDetails, SessionFormat } from "../domain";

const FORMATS: readonly SessionFormat[] = ["group", "private", "semiprivate", "workshop"];
const PROGRAMMING: readonly ProgrammingMode[] = ["continue", "studio", "design"];

/** Empty session details — the shape a legacy row (pre-0070) reads back as. */
export function emptySessionDetails(): SessionDetails {
  return {
    sessionFormat: null,
    participantsExpected: null,
    audience: null,
    teachingNotes: null,
    requiredQualifications: [],
    preferredQualifications: [],
    sessionGoal: null,
    clientExperience: null,
    accommodations: null,
    programming: null,
  };
}

/** Domain → snake_case columns, validating the two controlled sets. */
export function sessionDetailsToRow(d: SessionDetails): Record<string, unknown> {
  return {
    session_format: d.sessionFormat && FORMATS.includes(d.sessionFormat) ? d.sessionFormat : null,
    participants_expected: d.participantsExpected,
    audience: d.audience,
    teaching_notes: d.teachingNotes,
    required_qualifications: d.requiredQualifications ?? [],
    preferred_qualifications: d.preferredQualifications ?? [],
    session_goal: d.sessionGoal,
    client_experience: d.clientExperience,
    accommodations: d.accommodations,
    programming: d.programming && PROGRAMMING.includes(d.programming) ? d.programming : null,
  };
}

/** Row → domain, tolerant of a legacy row that has none of these columns set. */
export function sessionDetailsFromRow(row: Record<string, unknown>): SessionDetails {
  return {
    sessionFormat: (row.session_format as SessionFormat | null) ?? null,
    participantsExpected: (row.participants_expected as number | null) ?? null,
    audience: (row.audience as string | null) ?? null,
    teachingNotes: (row.teaching_notes as string | null) ?? null,
    requiredQualifications: (row.required_qualifications as string[] | null) ?? [],
    preferredQualifications: (row.preferred_qualifications as string[] | null) ?? [],
    sessionGoal: (row.session_goal as string | null) ?? null,
    clientExperience: (row.client_experience as string | null) ?? null,
    accommodations: (row.accommodations as string | null) ?? null,
    programming: (row.programming as ProgrammingMode | null) ?? null,
  };
}
