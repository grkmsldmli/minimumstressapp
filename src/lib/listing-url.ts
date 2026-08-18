import { citySlug, stateSlug } from "./directory";
import { spaceTypeBySlug } from "./space-types";

/**
 * A listing's own address, and how it stays that address forever.
 *
 * `/spaces/ca/belmont/bright-pilates-studio-1284`. The town is in the path
 * because that is what somebody searched for, and the trailing id is what
 * makes the name renameable: a host who calls their studio something else
 * next year does not throw away whatever the page had earned, because the
 * part that resolves it never changed.
 *
 * It shares the fourth segment with the use pages — /spaces/ca/belmont/
 * pilates-studio is a category of rooms, not a room. They cannot collide.
 * Use slugs are a closed list of ten with no id on the end, and a listing slug
 * always carries one, so the two shapes are distinguishable by looking rather
 * than by hoping.
 */

/** How much of the id goes in the URL. Eight hex characters of a uuid. */
const ID_LENGTH = 8;

function words(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

export function listingSlug(name: string, id: string): string {
  const stem = words(name);
  const tail = id.replace(/-/g, "").slice(0, ID_LENGTH);
  // A room with a name of nothing but punctuation still needs an address.
  return stem ? `${stem}-${tail}` : `room-${tail}`;
}

/**
 * The id back out of a slug, or null.
 *
 * Only the tail is trusted. Everything before it is the host's name for the
 * room and may have changed since the link was made — which is the point, and
 * why an old link still lands on the right listing.
 */
export function idFromSlug(slug: string): string | null {
  const match = slug.match(new RegExp(`-([0-9a-f]{${ID_LENGTH}})$`));
  return match ? match[1] : null;
}

/**
 * Whether this segment is a room rather than a category of rooms.
 *
 * Checked in that order on purpose: a use slug is a fixed name we control, so
 * it wins, and nothing a host types can take it. `listingSlug` can never
 * produce one anyway — every listing slug ends in an id.
 */
export function isListingSlug(segment: string): boolean {
  return spaceTypeBySlug(segment) === null && idFromSlug(segment) !== null;
}

export function listingPath(space: {
  state: string | null;
  city: string | null;
  name: string;
  id: string;
}): string | null {
  // A room the geocoder could not place has no town to live under. It stays
  // bookable in the app and simply has no page out here, which is better than
  // a page at an address that claims a town it may not be in.
  if (!space.state || !space.city) return null;
  return `/spaces/${stateSlug(space.state)}/${citySlug(space.city)}/${listingSlug(space.name, space.id)}`;
}
