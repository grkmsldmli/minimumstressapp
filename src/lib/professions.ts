/**
 * What a practitioner does, as a small controlled list.
 *
 * V1 is display only: it tells a host what kind of professional is booking, and
 * it is the field a later credential/license step will key off. It is
 * deliberately not free text — an arbitrary string could never drive a
 * verification rule, and "Pilates Instructor" typed nine ways is nine
 * professions to a computer and one to a person.
 *
 * The keys are stable and never shown; the labels are natural American English
 * and are what a host reads. The set tracks the marketplace's own categories
 * (see lib/taxonomy) without being a strict mirror of them — a person picks a
 * profession, not a room type.
 *
 * `other` exists so nobody is forced into a wrong answer; it reads as the
 * generic professional it is, never as "unspecified".
 */
export interface Profession {
  key: string;
  label: string;
}

export const PRACTITIONER_PROFESSIONS: readonly Profession[] = [
  { key: "pilates", label: "Pilates Instructor" },
  { key: "yoga", label: "Yoga Teacher" },
  { key: "movement", label: "Movement Coach" },
  { key: "massage", label: "Massage Therapist" },
  { key: "holistic", label: "Holistic Practitioner" },
  { key: "meditation", label: "Meditation & Breathwork Teacher" },
  { key: "coaching", label: "Coach or Consultant" },
  { key: "other", label: "Wellness Professional" },
] as const;

/*
 * No "Therapist or Counselor" in V1. A declared profession here is a category a
 * host reads, not a verified credential — and therapy/counseling is a
 * licensed profession in much of the US, so listing it before there is any
 * credential check would imply a verification that does not exist yet. It
 * returns with the credential/license package. There is deliberately no
 * "Profession verified" anywhere: this field is declared, never certified.
 */

const BY_KEY = new Map(PRACTITIONER_PROFESSIONS.map((p) => [p.key, p]));

/** The profession for a stored key, or null for an unknown or absent one. */
export function professionFor(key: string | null | undefined): Profession | null {
  return key ? (BY_KEY.get(key) ?? null) : null;
}

/** The label to show, or null when the practitioner has not chosen one. */
export function professionLabel(key: string | null | undefined): string | null {
  return professionFor(key)?.label ?? null;
}

/** True when a key is one of ours — the guard before storing what a client sent. */
export function isKnownProfession(key: string): boolean {
  return BY_KEY.has(key);
}

/** Every valid key, for the database check constraint's mirror in tests. */
export const PROFESSION_KEYS: readonly string[] = PRACTITIONER_PROFESSIONS.map((p) => p.key);
