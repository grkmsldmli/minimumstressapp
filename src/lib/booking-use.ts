/**
 * What a room may be used for: the platform's floor, the host's choice, and
 * what the person booking says they are going to do.
 *
 * Three layers, and the order matters.
 *
 * The platform's list is a floor nobody can lower. A host cannot allow a
 * prohibited use, and it does not appear on any form — the prohibitions are
 * stated in the terms and enforced by their absence from every menu here,
 * rather than offered as an option somebody could tick.
 *
 * The host's list sits on top of that floor. They own the room, they set the
 * rate and the hours, and what happens in it is the same kind of decision. A
 * host with a treatment table who is glad to let a yoga teacher use the floor
 * should be able to say so, and one who never wants a group in there should be
 * able to say that instead. Deciding this by room category instead would take
 * the choice away from the only person with a stake in it.
 *
 * The declaration is what the person booking says. It is not a promise we can
 * verify, and pretending otherwise would be the same mistake as claiming to
 * vet qualifications. What it does is make a misuse into a stated falsehood
 * rather than a disagreement about what was meant, which is the difference
 * between having a rule and having a rule you can act on.
 *
 * Identity is deliberately not part of this. A practitioner can misuse a room
 * exactly as easily as anybody else, and requiring a professional title to
 * book a movement studio for an hour turns away real demand — two friends who
 * want to rehearse — while buying no safety at all. The question is what will
 * happen in the room, not who is asking.
 */

/**
 * Never allowed, whatever a host says.
 *
 * Deliberately not selectable anywhere. These exist as a list so the terms,
 * the trust page and any enforcement decision are quoting one source, and so
 * a use added to the host menu can be tested against them.
 */
export const PROHIBITED_USES = [
  "Sexual activity or sexual services",
  "Pornography or adult-content production",
  "Prostitution or escort activity",
  "Anything illegal, and illegal drugs",
  "Weapons, where prohibited or unsafe",
  "Hazardous activities",
  "Parties and nightlife events",
  "More people than the booking declared",
  "Entering outside the booked time",
  "Commercial filming or production that was not declared and allowed",
  "Anything that damages the room or creates an unreasonable safety risk",
  "Any use materially different from the declared purpose",
] as const;

/**
 * What somebody says they are booking for.
 *
 * `other` exists because a list that does not fit forces a wrong answer, and a
 * wrong answer is worse than a free-text one: it looks like a declaration and
 * is not. Choosing it requires writing what the use actually is.
 */
export interface BookingUse {
  key: string;
  label: string;
  /** Shown on the host's side when they choose what to allow. */
  hostLabel: string;
  /** True when the room is being used with other people in it. */
  bringsPeople: boolean;
}

export const BOOKING_USES: readonly BookingUse[] = [
  {
    key: "personal_practice",
    label: "Personal practice",
    hostLabel: "Personal practice",
    bringsPeople: false,
  },
  {
    key: "dance_rehearsal",
    label: "Dance or movement rehearsal",
    hostLabel: "Dance and movement rehearsal",
    bringsPeople: true,
  },
  {
    key: "movement_session",
    label: "Yoga, Pilates or movement session",
    hostLabel: "Yoga, Pilates and movement",
    bringsPeople: true,
  },
  {
    key: "meditation",
    label: "Meditation or breathwork",
    hostLabel: "Meditation and breathwork",
    bringsPeople: true,
  },
  {
    key: "client_session",
    label: "Private session with a client",
    hostLabel: "Private client sessions",
    bringsPeople: true,
  },
  {
    key: "consultation",
    label: "Consultation or coaching",
    hostLabel: "Consultation and coaching",
    bringsPeople: true,
  },
  {
    key: "group_class",
    label: "Small group class",
    hostLabel: "Small group classes",
    bringsPeople: true,
  },
  {
    key: "workshop",
    label: "Workshop",
    hostLabel: "Workshops",
    bringsPeople: true,
  },
  {
    key: "filming",
    label: "Photography or filming",
    hostLabel: "Photography and filming",
    bringsPeople: true,
  },
  {
    key: "other",
    label: "Something else",
    hostLabel: "Other uses, by arrangement",
    bringsPeople: true,
  },
] as const;

/**
 * The uses a host has to tick for themselves.
 *
 * Everything here changes who else is in the room, or what leaves it. A host
 * who scrolls past this question should not discover afterwards that they
 * agreed to a workshop, a class of eight strangers, or a camera — so these are
 * never pre-selected, whatever the room is.
 */
export const OPT_IN_USES = ["group_class", "workshop", "filming", "other"] as const;

/**
 * What a room of this kind is offered for unless the host says otherwise.
 *
 * Starting with everything ticked was the wrong default and the reasoning for
 * it was backwards: a host who does not read the question ends up having
 * allowed the things they would most have wanted to decline. Starting with
 * nothing ticked is the other failure — an unbookable listing — so each
 * category opens on the uses that room is obviously for, and the rest are the
 * host's to add.
 */
export const DEFAULT_USES: Record<string, readonly string[]> = {
  physical: ["personal_practice", "dance_rehearsal", "movement_session"],
  social: ["consultation", "client_session"],
  traditional: ["client_session"],
  spirit: ["personal_practice", "meditation"],
};

export function defaultUsesFor(category: string): string[] {
  return [...(DEFAULT_USES[category] ?? ["personal_practice"])];
}

const BY_KEY = new Map(BOOKING_USES.map((use) => [use.key, use]));

export function bookingUse(key: string): BookingUse | null {
  return BY_KEY.get(key) ?? null;
}

/** The uses a host chooses from. Same list — there is no hidden second menu. */
export const HOST_USES = BOOKING_USES;

export function knownUses(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  return keys.filter((key) => {
    if (!BY_KEY.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** How much explanation "something else" needs before it counts as declared. */
export const MIN_OTHER_CHARS = 15;
export const MAX_OTHER_CHARS = 300;

export type UseRejection =
  | "purpose_missing"
  | "purpose_unknown"
  | "purpose_needs_detail"
  | "use_not_allowed"
  | "attendees_missing"
  | "too_many_attendees";

export interface DeclaredUse {
  purpose: string;
  /** Required when the purpose is `other`. */
  purposeNote?: string | null;
  /** Everybody who will be in the room, the person booking included. */
  attendees: number;
}

export interface SpaceRules {
  /** Empty means the host has not chosen — see `allowsUse`. */
  allowedUses: readonly string[];
  capacity: number;
}

/**
 * Whether this host allows this use.
 *
 * An empty list is treated as "everything the platform allows" rather than
 * "nothing", because every listing that existed before hosts were asked has
 * one — and a migration that silently made those rooms unbookable would take
 * the marketplace down to nothing on the day it shipped. Hosts choose from
 * here on; the ones already listed keep working until they do.
 */
export function allowsUse(rules: SpaceRules, purpose: string): boolean {
  if (rules.allowedUses.length === 0) return true;
  return rules.allowedUses.includes(purpose);
}

/**
 * The whole check, in one place, as a pure function.
 *
 * Returns the first reason it fails rather than a list, because the form shows
 * one message at a time and the caller should not be choosing which of several
 * to display.
 */
export function checkDeclaredUse(
  declared: DeclaredUse | null,
  rules: SpaceRules,
): UseRejection | null {
  if (!declared || !declared.purpose) return "purpose_missing";

  const use = bookingUse(declared.purpose);
  if (!use) return "purpose_unknown";

  /*
   * "Something else" has to say what else. A purpose field that accepts an
   * unexplained "other" records nothing, and the record is the entire point:
   * it is what a later dispute is measured against.
   */
  if (use.key === "other") {
    const note = (declared.purposeNote ?? "").trim();
    if (note.length < MIN_OTHER_CHARS) return "purpose_needs_detail";
  }

  if (!allowsUse(rules, use.key)) return "use_not_allowed";

  if (!Number.isInteger(declared.attendees) || declared.attendees < 1) {
    return "attendees_missing";
  }
  if (declared.attendees > rules.capacity) return "too_many_attendees";

  return null;
}

/** What the person booking is told, per reason. */
export function explainUseRejection(reason: UseRejection, rules: SpaceRules): string {
  switch (reason) {
    case "purpose_missing":
      return "Tell us what you will be using the space for.";
    case "purpose_unknown":
      return "Choose what you will be using the space for.";
    case "purpose_needs_detail":
      return "Say a little more about what you will be doing.";
    case "use_not_allowed":
      return "This host does not offer the space for that. Try another room, or another use.";
    case "attendees_missing":
      return "How many people will be there, including you?";
    case "too_many_attendees":
      return `This room takes ${rules.capacity}. Book a larger one, or bring fewer people.`;
  }
}
