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
/**
 * The professional proof a profession must provide before it can book.
 *
 * Every practitioner provides some proof appropriate to what they do — the
 * marketplace does not run on self-declaration alone — but the *kind* of proof
 * is profession-specific, and the model is category-aware so the requirements
 * can evolve. `required` is here so a profession can later be made proof-optional
 * without a schema change; today every profession requires proof.
 *
 *   camtc         Minimum Stress platform standard for massage work in
 *                 California: a CAMTC certification. This is our eligibility
 *                 rule for booking through the platform, not a statement that
 *                 CAMTC is universally required by California state law.
 *   training      A relevant training or certification document (Pilates, yoga,
 *                 movement, meditation and breathwork, holistic/Reiki work).
 *   professional  Reasonable professional proof for work with no single
 *                 certification standard (coaching, consulting, the generic
 *                 professional) — recognised training, practice documentation,
 *                 or comparable evidence, judged by the admin review rules.
 *
 * Reviewed by hand for now. Nothing here is a quality claim.
 */
export type ProofKind = "camtc" | "training" | "professional";

export interface ProofRequirement {
  required: boolean;
  kind: ProofKind;
  /** What the practitioner is asked to provide, in plain words. */
  label: string;
}

const CAMTC_PROOF: ProofRequirement = {
  required: true,
  kind: "camtc",
  label: "CAMTC certification",
};
const TRAINING_PROOF: ProofRequirement = {
  required: true,
  kind: "training",
  label: "Training or certification",
};
const PROFESSIONAL_PROOF: ProofRequirement = {
  required: true,
  kind: "professional",
  label: "Professional proof",
};

export interface Profession {
  key: string;
  label: string;
  proof: ProofRequirement;
}

export const PRACTITIONER_PROFESSIONS: readonly Profession[] = [
  { key: "pilates", label: "Pilates Instructor", proof: TRAINING_PROOF },
  { key: "yoga", label: "Yoga Teacher", proof: TRAINING_PROOF },
  { key: "movement", label: "Movement Coach", proof: TRAINING_PROOF },
  { key: "massage", label: "Massage Therapist", proof: CAMTC_PROOF },
  { key: "holistic", label: "Holistic Practitioner", proof: TRAINING_PROOF },
  { key: "meditation", label: "Meditation & Breathwork Teacher", proof: TRAINING_PROOF },
  { key: "coaching", label: "Coach or Consultant", proof: PROFESSIONAL_PROOF },
  { key: "other", label: "Wellness Professional", proof: PROFESSIONAL_PROOF },
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

/**
 * The proof a profession must provide. Unknown or absent professions fall back
 * to generic professional proof — so a booking still needs proof rather than
 * slipping through on a blank or unrecognised profession.
 */
export function proofFor(key: string | null | undefined): ProofRequirement {
  return professionFor(key)?.proof ?? PROFESSIONAL_PROOF;
}

/**
 * True when a verified credential is needed to book. Every practitioner provides
 * proof today, including one who has not chosen a profession — so this is the
 * one gate that also nudges them to declare what they do.
 */
export function requiresCredential(key: string | null | undefined): boolean {
  return proofFor(key).required;
}

/** Every valid key, for the database check constraint's mirror in tests. */
export const PROFESSION_KEYS: readonly string[] = PRACTITIONER_PROFESSIONS.map((p) => p.key);
