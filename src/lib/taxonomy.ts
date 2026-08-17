/**
 * The four kinds of room, which is not the same as four kinds of practitioner.
 *
 * These came off the old Provider Application form and classified the person:
 * Physical Activity, Traditional Medicine, Coaching & Personal Support, Mind &
 * Spirit. That was the right axis for a directory of practitioners and is the
 * wrong one for a marketplace whose unit is a room — somebody arriving here is
 * not asking "what am I", they are asking "where can I work on Tuesday", and a
 * naturopath and a masseur want the same room while a naturopath running a
 * consultation wants a different one.
 *
 * So the labels now describe the space. The keys are unchanged, because the
 * four map onto each other one for one — physical is still where movement
 * happens, spirit is still where sitting happens — which meant the concept
 * could change without touching the `space_category` enum, the stored rows or
 * anything that reads them.
 *
 * Four, and staying four. Ten top-level categories in a marketplace this size
 * would be eight empty shelves and a confused visitor. The finer question —
 * pilates or yoga, massage or acupuncture — is `suitable_for` on the listing
 * (see lib/space-types), which is also what the URLs are built from. Four for
 * navigation, ten for search.
 *
 * The line between Consultation and Holistic is the room, not the trade. The
 * same Ayurvedic practitioner needs a Consultation Room to talk to somebody
 * and a Holistic Practice Room to treat them, and the physical difference —
 * two chairs, or a couch and a sink — is the one a person booking actually
 * cares about.
 *
 * Deliberately free of icon or React imports so server-side validation can use
 * it without pulling the icon library into a server bundle. The icon mapping
 * lives alongside the components that render it.
 */

export const CATEGORY_KEYS = ["physical", "traditional", "social", "spirit"] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export interface Category {
  key: CategoryKey;
  /** Full name, as it appears in navigation and on the listing form. */
  label: string;
  /** Short form for chips and filters, where the full name will not fit. */
  shortLabel: string;
  /** What one room of this kind is called, singular — the badge on a listing. */
  roomType: string;
  specialties: readonly string[];
  /** Gradient stops used for cards, tiles, and map pins. */
  gradient: readonly [string, string];
}

export const CATEGORIES: readonly Category[] = [
  {
    key: "physical",
    label: "Movement Studios",
    shortLabel: "Movement",
    roomType: "Movement Studio",
    specialties: ["Pilates", "Yoga", "Tai Chi", "Qigong", "Mobility", "Stretching"],
    gradient: ["#3B9BE8", "#16304E"],
  },
  {
    key: "traditional",
    // Hands-on work, which is a room with a couch and a sink rather than a
    // room with two chairs. The trade does not decide this; the treatment does.
    label: "Holistic Practice Rooms",
    shortLabel: "Holistic",
    roomType: "Treatment Room",
    specialties: [
      "Massage",
      "Ayurveda",
      "Naturopathic",
      "Acupuncture",
      "Aromatherapy",
      "Reiki",
      "Skincare",
    ],
    gradient: ["#5FA876", "#12332A"],
  },
  {
    key: "social",
    // Where somebody sits down and talks. A coach, a nutritionist and an
    // Ayurvedic practitioner taking a history all need the same room.
    label: "Consultation & Coaching Rooms",
    shortLabel: "Consultation",
    roomType: "Consultation Room",
    specialties: [
      "Life Coach",
      "Relationship Coach",
      "Career Coach",
      "Financial Wellness",
      "Nutrition",
      "Herbalism",
      "Mindfulness Coach",
    ],
    gradient: ["#7FB4E8", "#1C2B4E"],
  },
  {
    key: "spirit",
    label: "Meditation & Breathwork Spaces",
    shortLabel: "Meditation",
    roomType: "Meditation Room",
    specialties: [
      "Meditation",
      "Mindfulness",
      "Breathwork",
      "Guided Visualization",
      "Spiritual Coaching",
    ],
    gradient: ["#8E7FE8", "#241C4E"],
  },
] as const;

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

export function getCategory(key: CategoryKey): Category {
  const category = BY_KEY.get(key);
  if (!category) throw new RangeError(`unknown category: ${key}`);
  return category;
}

export function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === "string" && BY_KEY.has(value as CategoryKey);
}

/** Room type is derived from the category — the two can never disagree. */
export function roomTypeFor(key: CategoryKey): string {
  return getCategory(key).roomType;
}

/**
 * The practices a room of this kind is for.
 *
 * Read by search, so somebody typing "yoga" finds a Movement Studio whether or
 * not the host happened to write the word. They are searching for their own
 * practice, not for a host's choice of adjective — and a listing reading
 * "bright, sprung floor, mirrors on one wall" is a yoga room without
 * containing the term anywhere.
 */
export function specialtiesFor(key: CategoryKey): readonly string[] {
  return getCategory(key).specialties;
}

/* ------------------------------------------------------------------ */
/*  Listing vocabulary                                                 */
/* ------------------------------------------------------------------ */

/**
 * How a practitioner gets in. Required at listing time — the brief makes this
 * part of Step 1, alongside free-text entry instructions.
 */
export const ACCESS_TYPES = [
  { key: "keypad", label: "Keypad code" },
  { key: "lockbox", label: "Lockbox" },
  { key: "greeter", label: "Someone lets you in" },
] as const;
export type AccessTypeKey = (typeof ACCESS_TYPES)[number]["key"];

export function isAccessTypeKey(value: unknown): value is AccessTypeKey {
  return ACCESS_TYPES.some((a) => a.key === value);
}

export const RESTROOM_OPTIONS = ["Private", "Shared", "None"] as const;
export type RestroomOption = (typeof RESTROOM_OPTIONS)[number];

/* ------------------------------------------------------------------ */
/*  House rules                                                        */
/* ------------------------------------------------------------------ */

/**
 * What a host expects of whoever uses the room.
 *
 * Structured rather than free text, for three reasons. A fixed vocabulary can
 * be shown on the listing *before* someone books — a rule you discover after
 * paying is a trap, and this app already refuses that pattern with pricing.
 * It can be scanned in a second instead of read as a paragraph. And it keeps
 * the common cases out of a free-text box that is otherwise the easiest place
 * for a rule to drift into something it should not be.
 *
 * `kind` drives how they group on the listing, because the three are genuinely
 * different obligations and reading them as one list is how people miss the
 * one that needed a purchase:
 *
 *   bring  something the practitioner has to turn up with
 *   avoid  something they must not do in the room
 *   know   a constraint of the building they cannot change
 */
export const REQUIREMENTS = [
  { key: "grip_socks", kind: "bring", label: "Grip socks required" },
  { key: "own_mat", kind: "bring", label: "Bring your own mat" },
  { key: "own_linens", kind: "bring", label: "Bring your own linens or towels" },
  { key: "indoor_shoes", kind: "bring", label: "Indoor shoes only — no outdoor soles" },

  { key: "no_outside_equipment", kind: "avoid", label: "No outside equipment" },
  { key: "no_food_drink", kind: "avoid", label: "No food or drink" },
  { key: "no_open_flame", kind: "avoid", label: "No candles, incense or open flame" },
  { key: "no_scents", kind: "avoid", label: "No scented oils or sprays" },
  { key: "no_amplified_music", kind: "avoid", label: "No amplified music" },
  { key: "no_filming", kind: "avoid", label: "No filming or photography" },

  { key: "quiet_building", kind: "know", label: "Quiet building — keep noise down" },
  { key: "no_waiting_area", kind: "know", label: "No waiting area for clients" },
  { key: "stairs_only", kind: "know", label: "Stairs only, no lift" },
  { key: "wipe_down", kind: "know", label: "Wipe down equipment after use" },
  { key: "take_rubbish", kind: "know", label: "Take your rubbish with you" },
] as const;

export type RequirementKey = (typeof REQUIREMENTS)[number]["key"];
export type RequirementKind = (typeof REQUIREMENTS)[number]["kind"];

export const REQUIREMENT_GROUPS: { kind: RequirementKind; heading: string }[] = [
  { kind: "bring", heading: "Bring with you" },
  { kind: "avoid", heading: "Please don't" },
  { kind: "know", heading: "Worth knowing" },
];

export function isRequirementKey(value: unknown): value is RequirementKey {
  return REQUIREMENTS.some((r) => r.key === value);
}

export function requirementLabel(key: RequirementKey): string {
  return REQUIREMENTS.find((r) => r.key === key)!.label;
}

export function requirementsByKind(keys: readonly string[]) {
  return REQUIREMENT_GROUPS.map(({ kind, heading }) => ({
    kind,
    heading,
    items: REQUIREMENTS.filter((r) => r.kind === kind && keys.includes(r.key)),
  })).filter((group) => group.items.length > 0);
}

export const AMENITIES = [
  "Mirrors",
  "Sound system",
  "Climate control",
  "Soundproofed",
  "Sink access",
  "Natural light",
  "Storage",
  "Private entrance",
] as const;
export type Amenity = (typeof AMENITIES)[number];

/** Turnover buffer between bookings, in minutes. */
export const BUFFER_OPTIONS = [0, 15, 30] as const;
export type BufferMinutes = (typeof BUFFER_OPTIONS)[number];

export function formatBuffer(minutes: number): string {
  return minutes === 0 ? "None" : `${minutes} min`;
}

/* ------------------------------------------------------------------ */
/*  Weekly availability                                                */
/* ------------------------------------------------------------------ */

/** Monday-first for display; `weekday` values are 0=Sun..6=Sat to match Date. */
export const WEEKDAYS = [
  { weekday: 1, short: "Mon" },
  { weekday: 2, short: "Tue" },
  { weekday: 3, short: "Wed" },
  { weekday: 4, short: "Thu" },
  { weekday: 5, short: "Fri" },
  { weekday: 6, short: "Sat" },
  { weekday: 0, short: "Sun" },
] as const;

/** A single bookable block. A day may hold several, with real gaps between. */
export interface AvailabilityBlock {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export const SELECTABLE_HOURS = Array.from({ length: 17 }, (_, i) => (6 + i) * 60);

/** 540 -> "9:00 AM" */
export function formatMinuteOfDay(minute: number): string {
  const hour24 = Math.floor(minute / 60);
  const minutes = minute % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}
