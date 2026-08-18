import { type CategoryKey } from "./taxonomy";

/**
 * What a room is bookable for, in the words people search with.
 *
 * The four categories are how the app organises itself — Movement Studio,
 * Treatment Room, Consultation Room, Meditation Room. Nobody searches for
 * those. They search "pilates studio rental san mateo" and "massage room for
 * rent near me", and a site whose vocabulary does not match the query does not
 * appear in the results.
 *
 * So this is a second, finer axis, and it is deliberately multi-valued. A
 * reformer studio really is bookable for yoga and for mobility work; forcing a
 * host to pick one label would be both less true and fewer pages. One room
 * marking three uses appears on three city pages, which at this stage matters
 * more than it will later.
 *
 * Two rules govern what can go in this list.
 *
 * The first is that a slug here is a URL forever. `/spaces/ca/san-mateo/
 * pilates-studio` is a page a search engine indexes and somebody links to, and
 * renaming it later throws away whatever it earned. That is why the same list
 * is a check constraint in the database: adding a use is a migration on
 * purpose, so that it is a decision rather than a typo.
 *
 * The second is that none of them say "therapy". Renting a room to a licensed
 * massage therapist is one thing; advertising "therapy offices" is a claim
 * about clinical practice, and the platform is a booking system that says in
 * its own terms it provides no therapeutic or psychological service. The room
 * that would carry that name is a Consultation Room here.
 */

export interface SpaceType {
  /** The URL segment. Permanent — see above. */
  slug: string;
  /** Singular, for a heading: "Pilates Studio". */
  label: string;
  /** Plural, for a city page: "Pilates Studios for Rent in San Mateo". */
  plural: string;
  /** Which of the four this sits under, so the form can group them. */
  category: CategoryKey;
  /** One line, used on the type's own landing page. */
  blurb: string;
}

export const SPACE_TYPES: readonly SpaceType[] = [
  {
    slug: "pilates-studio",
    label: "Pilates Studio",
    plural: "Pilates Studios",
    category: "physical",
    blurb: "Room for reformer or mat work, without taking on a studio lease.",
  },
  {
    slug: "yoga-studio",
    label: "Yoga Studio",
    plural: "Yoga Studios",
    category: "physical",
    blurb: "A quiet floor with room to move, for classes and one-to-one teaching.",
  },
  {
    slug: "movement-studio",
    label: "Movement Studio",
    plural: "Movement Studios",
    category: "physical",
    blurb: "Open floor for mobility, stretching, tai chi and personal training.",
  },
  {
    slug: "massage-room",
    label: "Massage Room",
    plural: "Massage Rooms",
    category: "traditional",
    blurb: "A private room with a table, for bodywork on your schedule.",
  },
  {
    slug: "treatment-room",
    label: "Treatment Room",
    plural: "Treatment Rooms",
    category: "traditional",
    blurb: "A clean, private room for hands-on work, with a sink and somewhere to change.",
  },
  {
    slug: "acupuncture-room",
    label: "Acupuncture Room",
    plural: "Acupuncture Rooms",
    category: "traditional",
    blurb: "Quiet, private and set up for treatment, hired for the hours you need it.",
  },
  {
    slug: "esthetician-room",
    label: "Esthetician Room",
    plural: "Esthetician Rooms",
    category: "traditional",
    blurb: "A skincare room with the light, water and privacy the work needs.",
  },
  {
    slug: "consultation-room",
    label: "Consultation Room",
    plural: "Consultation Rooms",
    category: "social",
    blurb: "A private room to see people in, without signing for an office you half use.",
  },
  {
    slug: "meditation-room",
    label: "Meditation Room",
    plural: "Meditation Rooms",
    category: "spirit",
    blurb: "A still room for sitting, breathwork and guided practice.",
  },
  {
    slug: "reiki-room",
    label: "Reiki Room",
    plural: "Reiki Rooms",
    /*
     * Holistic rather than Meditation, which is the categories' own new rule
     * applied honestly: the client lies on a table for an hour, so the room
     * needed is the one massage needs — a couch, warmth, a door that locks —
     * and not a floor to sit on. It sat under Mind & Spirit while the
     * categories described the practitioner rather than the room.
     */
    category: "traditional",
    blurb: "Private, quiet and warm, for energy work, for the time you need.",
  },
] as const;

const BY_SLUG = new Map(SPACE_TYPES.map((type) => [type.slug, type]));

export function spaceTypeBySlug(slug: string): SpaceType | null {
  return BY_SLUG.get(slug) ?? null;
}

/** The uses offered for a room in this category, in listing order. */
export function spaceTypesFor(category: CategoryKey): SpaceType[] {
  return SPACE_TYPES.filter((type) => type.category === category);
}

/**
 * Drops anything not on the list.
 *
 * The database has the same list as a constraint, so an unknown value is a
 * failed insert rather than a bad row — but a host should not lose a listing
 * because a stale tab posted a use that has since been renamed.
 */
export function knownSpaceTypes(slugs: readonly string[]): string[] {
  const seen = new Set<string>();
  return slugs.filter((slug) => {
    if (!BY_SLUG.has(slug) || seen.has(slug)) return false;
    seen.add(slug);
    return true;
  });
}
