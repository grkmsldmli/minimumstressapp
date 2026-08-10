/**
 * What a listing has to say before it is worth showing anybody.
 *
 * The listing screen was built to carry a description, four accessibility
 * answers, amenities and house rules, and every one of those sections hides
 * itself when empty. That is the right behaviour and it produced the wrong
 * result: three live listings, none with a usable description, none with a
 * single accessibility answer — so the page collapsed to a photo followed
 * immediately by a calendar, and a practitioner had nothing to decide on.
 *
 * Nothing was broken. The host was never asked, never told, and the listing
 * went live regardless.
 */

import type { AccessDetails } from "./access-details";

/**
 * Long enough to be a sentence about a room.
 *
 * The listings that prompted this said "Magic Show" — the room's own name,
 * seventeen characters, no information. Forty admits "Bright room, wooden
 * floor, quiet street" and refuses a label. It is a floor on effort, not a
 * standard of writing.
 */
export const MIN_DESCRIPTION_CHARS = 40;

export function describesTheRoom(description: string): boolean {
  return description.trim().length >= MIN_DESCRIPTION_CHARS;
}

export interface ListingGap {
  /** What is missing, in the host's words. */
  label: string;
  /** Why a practitioner cares — shown so the ask does not read as bureaucracy. */
  because: string;
}

interface Listing {
  description: string;
  amenities: readonly string[];
  access: AccessDetails;
  /** False when the host has not said anything about parking either way. */
  parkingAnswered: boolean;
  mediaCount: number;
}

/**
 * Everything a host could add that a practitioner would actually use.
 *
 * Ordered by what costs a booking. A room nobody can picture is passed over; a
 * room whose access is unknown is passed over by anybody who has to ask. The
 * rest is genuinely optional and sits at the end.
 *
 * Empty means the listing is complete, which is the point — this is meant to
 * be finishable rather than a permanent scold.
 */
export function listingGaps(listing: Listing): ListingGap[] {
  const gaps: ListingGap[] = [];

  if (!describesTheRoom(listing.description)) {
    gaps.push({
      label: "A description of the room",
      because: "It is the first thing anyone reads, and yours is where the paragraph would be.",
    });
  }

  const accessAnswers = [
    listing.access.entrance,
    listing.access.floor,
    listing.access.doorwayInches,
    listing.access.restroom,
  ].filter((answer) => answer !== null).length;

  if (accessAnswers === 0) {
    gaps.push({
      label: "How somebody gets in",
      because: "Anyone who needs to know has to message you first, and most will book elsewhere.",
    });
  }

  if (listing.parkingAnswered === false) {
    gaps.push({
      label: "Where to park",
      because: "Anyone driving decides on this, and the ones who cannot find out drive somewhere else.",
    });
  }

  if (listing.mediaCount < 3) {
    gaps.push({
      label: "More photos",
      because: "One angle of a room is hard to judge. Three or four is where people stop guessing.",
    });
  }

  if (listing.amenities.length < 2) {
    gaps.push({
      label: "What the room comes with",
      because: "Mats, mirrors, sound, storage — the things that decide whether it fits a class.",
    });
  }

  return gaps;
}
