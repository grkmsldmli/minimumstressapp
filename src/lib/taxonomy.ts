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

/**
 * The broadest `suitable_for` use inside each category — the one whose name
 * matches the category's room type.
 *
 * A category is not a `suitable_for` slug, and the marketing "Explore by space"
 * cards open the search on a slug. Rather than teach the homepage a second
 * vocabulary, each card opens the widest use in its category, and the finer
 * ones (a category's specialties) are reached from there. Lives here, beside
 * the categories, so the two cannot drift and a test can hold every value to a
 * slug the app actually supports — see space-types.ts. Every value here MUST be
 * a real SPACE_TYPES slug, or a card routes to a use the search cannot answer.
 */
export const GENERIC_USE: Record<CategoryKey, string> = {
  physical: "movement-studio",
  traditional: "treatment-room",
  social: "consultation-room",
  spirit: "meditation-room",
};

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

/**
 * What is in the room, and what the room itself is like.
 *
 * These were eight strings and every one of them described the building:
 * mirrors, climate control, natural light, soundproofing. Nothing described
 * the things a practitioner actually needs to find in there. Somebody looking
 * at a Holistic Practice Room could not tell whether it had a treatment table;
 * somebody looking at a movement studio could not tell whether the reformers
 * were included or the host expected them to bring their own.
 *
 * That is the first question after the price, and it was unanswerable.
 *
 * So the list carries a group. "Equipment" is what you will find waiting for
 * you; "room" is what the space is like around it. One column still, because a
 * host ticks one set of boxes and a reader scans one list — the group only
 * decides which heading each lands under.
 */
export interface Amenity {
  key: string;
  label: string;
  group: "equipment" | "room";
}

export const AMENITIES: readonly Amenity[] = [
  // Movement.
  { key: "reformers", label: "Reformers", group: "equipment" },
  { key: "mats", label: "Yoga mats", group: "equipment" },
  { key: "props", label: "Blocks, straps and bolsters", group: "equipment" },
  { key: "weights", label: "Weights", group: "equipment" },

  // Hands-on work.
  { key: "treatment_table", label: "Treatment table", group: "equipment" },
  { key: "linens", label: "Fresh linens and towels", group: "equipment" },

  // Sitting down with somebody.
  { key: "seating", label: "Chairs for two", group: "equipment" },
  { key: "desk", label: "Desk or table", group: "equipment" },
  { key: "cushions", label: "Meditation cushions", group: "equipment" },

  // Shared.
  { key: "sound_system", label: "Sound system", group: "equipment" },
  { key: "storage", label: "Storage for your things", group: "equipment" },
  { key: "water", label: "Drinking water", group: "equipment" },

  // The room itself.
  { key: "mirrors", label: "Mirrors", group: "room" },
  { key: "natural_light", label: "Natural light", group: "room" },
  { key: "climate_control", label: "Climate control", group: "room" },
  { key: "soundproofed", label: "Soundproofed", group: "room" },
  { key: "sink", label: "Sink in the room", group: "room" },
  { key: "private_entrance", label: "Private entrance", group: "room" },
  /*
   * Both of these existed only as a warning — "No waiting area for clients"
   * sat in the requirements and there was no way to say the opposite. A host
   * with somewhere for clients to sit could not mention it, which is the
   * wrong way round: the thing worth advertising was the one that could only
   * be admitted.
   */
  { key: "waiting_area", label: "Waiting area for clients", group: "room" },
  { key: "changing_area", label: "Somewhere to change", group: "room" },
] as const;

export const AMENITY_GROUPS: { group: Amenity["group"]; heading: string }[] = [
  { group: "equipment", heading: "What's in the room" },
  { group: "room", heading: "The room itself" },
];

export function amenitiesIn(group: Amenity["group"]): Amenity[] {
  return AMENITIES.filter((amenity) => amenity.group === group);
}

export function amenityLabel(key: string): string | null {
  return AMENITIES.find((amenity) => amenity.key === key)?.label ?? null;
}

/** Drops anything not on the list, so a stale tab cannot cost a listing. */
export function knownAmenities(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  return keys.filter((key) => {
    if (!AMENITIES.some((a) => a.key === key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Whether the room is yours for the hour, or a corner of somewhere busier.
 *
 * Absent until now, and it is the question straight after the price for
 * anybody seeing one person at a time. Capacity and category hint at it;
 * neither says it.
 */
export const ROOM_SETUPS = [
  {
    key: "private_room",
    label: "Private room",
    detail: "A private room with a door, yours during your booking.",
  },
  {
    key: "room_in_studio",
    label: "Room in a shared studio",
    detail: "Your own room, with other people working in the building.",
  },
  {
    key: "whole_studio",
    label: "The whole studio",
    detail: "The entire space is yours while you are booked.",
  },
] as const;

export type RoomSetupKey = (typeof ROOM_SETUPS)[number]["key"];

export function roomSetupLabel(key: string | null): string | null {
  return ROOM_SETUPS.find((setup) => setup.key === key)?.label ?? null;
}

export function isRoomSetupKey(value: unknown): value is RoomSetupKey {
  return ROOM_SETUPS.some((setup) => setup.key === value);
}

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
