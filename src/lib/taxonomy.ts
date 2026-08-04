/**
 * The four categories from the Provider Application form. Locked by the brief:
 * one category, one room type, no others.
 *
 * Deliberately free of icon or React imports so server-side validation can use
 * it without pulling the icon library into a server bundle. The icon mapping
 * lives alongside the components that render it.
 */

export const CATEGORY_KEYS = ["physical", "traditional", "social", "spirit"] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export interface Category {
  key: CategoryKey;
  /** Full name, as it appears on the Provider Application form. */
  label: string;
  /** Short form for chips and filters, where the full name will not fit. */
  shortLabel: string;
  /** The single room type this category maps to. */
  roomType: string;
  specialties: readonly string[];
  /** Gradient stops used for cards, tiles, and map pins. */
  gradient: readonly [string, string];
}

export const CATEGORIES: readonly Category[] = [
  {
    key: "physical",
    label: "Physical Activity",
    shortLabel: "Physical Activity",
    roomType: "Movement Studio",
    specialties: ["Yoga", "Pilates", "Tai Chi", "Qigong", "Mobility", "Stretching"],
    gradient: ["#3B9BE8", "#16304E"],
  },
  {
    key: "traditional",
    label: "Traditional Medicine & Natural Wellness",
    shortLabel: "Traditional Medicine",
    roomType: "Treatment Room",
    specialties: [
      "Ayurveda",
      "Naturopathic",
      "Herbal",
      "Aromatherapy",
      "Holistic Wellness",
    ],
    gradient: ["#5FA876", "#12332A"],
  },
  {
    key: "social",
    label: "Coaching & Personal Support",
    shortLabel: "Social Wellness",
    roomType: "Consultation Room",
    specialties: ["Life Coach", "Relationship Coach", "Mindfulness Coach", "Career Coach"],
    gradient: ["#7FB4E8", "#1C2B4E"],
  },
  {
    key: "spirit",
    label: "Mind & Spirit",
    shortLabel: "Mind & Spirit",
    roomType: "Meditation Room",
    specialties: ["Meditation", "Breathwork", "Reiki", "Guided Visualization"],
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
