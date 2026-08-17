/**
 * Domain types, shaped to match the database rather than the screens.
 *
 * Money is always integer cents and always the host's rate — the practitioner
 * price is derived through `quote()`, never stored. A booking carries its own
 * frozen breakdown so a host raising their rate cannot rewrite history.
 */

import type { AccessDetails } from "./access-details";
import type { Parking } from "./parking";
import type { AvailabilityBlock } from "./availability";
import type { AccessTypeKey, CategoryKey, RestroomOption } from "./taxonomy";

export type SpaceStatus = "pending" | "active" | "delisted";
export type MediaKind = "image" | "video";
export type PayoutSchedule = "standard" | "instant";

/** No account yet · submitted and waiting on Stripe · money can arrive. */
export type PayoutSetup = "not_started" | "in_review" | "ready";

/**
 * Which side of the marketplace an account is, chosen once at sign-up.
 *
 * Null means the choice has not been made yet — a profile row exists from the
 * moment someone signs in, and the question comes on the screen after that.
 * The app treats null as "the only screen you may see".
 */
export type AccountType = "practitioner" | "host";

export type BookingStatus =
  | "upcoming"
  | "completed"
  | "cancelled_by_practitioner"
  | "cancelled_by_host"
  | "no_show";

/**
 * Somebody to call if a session goes wrong while it is happening.
 *
 * Never leaves the server for anyone but its owner. The counterpart in a
 * booking does not see it in either direction — a practitioner alone in a
 * stranger's building and a host letting a stranger into theirs have the same
 * need and the same right to privacy about it.
 */
export interface EmergencyContact {
  name: string | null;
  phone: string | null;
  relationship: string | null;
}

export interface Profile {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
  isPro: boolean;
  insuranceDocName: string | null;
  payoutSchedule: PayoutSchedule;
  /**
   * Where payout setup actually stands.
   *
   * This was a boolean, which had no room for the state Stripe leaves a host
   * in for hours: the form is submitted, "we'll review your application" is
   * the last thing they were told, and nothing has been enabled yet. Connected
   * was a lie and not-set-up read as though the submission had been lost, so
   * the honest answer was missing in both directions.
   */
  payoutSetup: PayoutSetup;
  notifyBookings: boolean;
  notifyPayouts: boolean;
  notifyOffers: boolean;
  emergencyContact: EmergencyContact;
  /** Null until chosen. Cannot be changed afterwards — see migration 0012. */
  accountType: AccountType | null;
  /**
   * Which version of the terms this account accepted, and when.
   *
   * Null for everyone who signed up before there was anything to accept.
   * Deliberately not backfilled — recording an acceptance that never happened
   * is worse than having none, since being true is the whole value of it.
   */
  /**
   * A postcode they typed, kept until they change it.
   *
   * Not the GPS path, which is still used once and forgotten. This is a
   * preference somebody wrote down, and asking for it every visit is friction
   * with no privacy gained.
   */
  searchPostcode: string | null;
  termsVersion: number | null;
  termsAcceptedAt: Date | null;
  /**
   * Milestone keys already shown, so the one full-screen moment appears once.
   *
   * Only "have they seen it" — whether a milestone is *earned* is derived from
   * bookings, reviews and payouts every time it is asked, so it cannot drift
   * from what actually happened or be granted by writing a row.
   */
  milestonesSeen: string[];
}

export interface SpaceMedia {
  id: string;
  url: string;
  kind: MediaKind;
}

/** What a practitioner may see before booking. No address, no entry details. */
export interface PublicSpace {
  id: string;
  hostId: string;
  name: string;
  category: CategoryKey;
  /** The host's rate. The all-in price is derived, never stored. */
  hourlyRateCents: number;
  capacity: number;
  accessType: AccessTypeKey;
  accessible: boolean | null;
  restroom: RestroomOption | null;
  bufferMinutes: number;
  /**
   * Usable floor area in square feet. Null when the host has not said.
   *
   * Capacity is a judgement — a room that seats twelve for meditation seats
   * four for movement — and this is the fact underneath it.
   */
  floorAreaSqft: number | null;
  /**
   * IANA zone of the room, e.g. "America/Los_Angeles".
   *
   * Public because it has to be: availability is stored as wall-clock minutes,
   * and without knowing whose wall, a 9am block cannot be turned into a moment
   * in time. It is also not a secret — a rough location is already shown.
   */
  timeZone: string;
  amenities: string[];
  /** Keys from REQUIREMENTS in taxonomy.ts, shown before booking. */
  requirements: string[];
  /** Free-text overflow for the genuinely specific. Secondary to the above. */
  houseRules: string;
  description: string;
  media: SpaceMedia[];
  availability: AvailabilityBlock[];
  /** Illustrative map position, standing in for real coordinates. */
  mapX: number;
  mapY: number;
  /**
   * Town and postcode, never the street.
   *
   * Trimmed in the database rather than here — a column the browser has to be
   * trusted to cut down is a column the browser has already been sent. Null
   * when the stored address has no comma to split on, because guessing wrong
   * would leak the thing this exists to withhold.
   */
  area: string | null;
  /**
   * The town and state on their own, which `area` cannot answer.
   *
   * `area` is one formatted string — "San Mateo, CA 94404, USA" — good to
   * print and useless to group by. These are what a page is built from: the
   * rooms in San Mateo, the heading that names it, the URL it lives at. Null
   * where the geocoder did not say, which puts the listing on no city page
   * rather than on a wrong one.
   */
  city: string | null;
  state: string | null;
  /**
   * What the room is bookable for — slugs from lib/space-types.
   *
   * Empty is normal and allowed: a host who ticked nothing still has a
   * listing that browses and books. It just does not appear on the pages
   * built around a particular use.
   */
  suitableFor: string[];
  /**
   * The street, and where it is on a map.
   *
   * Public because every listing here is a retail studio whose address is
   * already on Google Maps and its own website — withholding it protected
   * nothing and cost a practitioner the fact they judge a room by. The entry
   * instructions and the access code are what stay behind the booking.
   *
   * Null on a listing that predates geocoding.
   */
  /**
   * What "accessible" means for this room, as four answered facts.
   *
   * Replaces a boolean that rendered as "Wheelchair accessible" and told
   * somebody nothing they could act on. Null throughout means unanswered,
   * which is shown as unanswered.
   */
  access: AccessDetails;
  /**
   * Where somebody leaves the car, and how long they may leave it.
   *
   * Public because it is read while deciding, which is before a booking
   * exists — and because "street parking" locates nothing.
   */
  parking: Parking;
  addressLine: string | null;
  lat: number | null;
  lng: number | null;
  distanceLabel: string;
  /**
   * Counted from released reviews only, so a sealed one cannot be inferred by
   * watching the number move. The decision to withhold an average under three
   * reviews lives in reviews.ts, not here.
   */
  reviewCount: number;
  averageRating: number | null;
}

/**
 * Something the other side has said about a session, waiting on an answer.
 *
 * One shape for both directions. A practitioner asking for their money back
 * and a studio asking to be paid for a mess are the same conversation pointed
 * opposite ways: somebody made a claim about a session, the other person is
 * asked what happened, and a person decides. Two screens for that would be two
 * places to look and two sets of wording to keep honest.
 */
export interface OpenDispute {
  id: string;
  /** Which direction it points. */
  kind: "refund" | "claim";
  bookingId: string;
  spaceName: string;
  sessionStart: Date;
  timeZone: string;
  /** What they picked from the list, in words. */
  reason: string;
  /** What they wrote. */
  detail: string;
  /** What it would cost, where there is already a figure. */
  amountCents: number | null;
  /** True when this account is the one being asked to answer. */
  awaitingYou: boolean;
  /** Set once decided, so a closed one still reads as an answer. */
  outcome: string | null;
}

/**
 * A review somebody else wrote, once it has been released.
 *
 * Released means both sides wrote, or fourteen days passed — see the
 * public_reviews view in 0011. Nobody sees a review that could still be
 * answered, which is what keeps the second one from being a reply to the first.
 */
export interface PublicReview {
  id: string;
  /** 1-5. */
  overall: number;
  comment: string | null;
  /** Which side wrote it: a room's review, or its practitioner's. */
  role: "practitioner" | "host";
  createdAt: Date;
}

/** Released only once the practitioner holds a booking on this space. */
export interface SpaceAccessDetails {
  addressLine: string;
  entryInstructions: string;
  accessType: AccessTypeKey;
  /** Null for listings created before addresses were geocoded. */
  lat: number | null;
  lng: number | null;
}

/**
 * A booking, and whatever still has to happen before it is paid for.
 *
 * The two backends genuinely differ here and the type says so rather than
 * papering over it. Against Stripe a booking exists the moment the row is
 * written, but the card has only been *authorised for* — the practitioner
 * still has to confirm it. The mock has no card and nothing to confirm.
 *
 * Returning a bare Booking would force the caller to guess which world it is
 * in; a null clientSecret says "nothing further" in both.
 */
export interface CreatedBooking {
  booking: Booking;
  /** Scoped to this one PaymentIntent, and useless for anything else. */
  clientSecret: string | null;
}

/** A host's own listing, including the fields never shown to practitioners. */
export type DocReviewState = "pending" | "verified" | "rejected";

/** What became of a file a host handed over. */
export interface DocumentReview {
  state: DocReviewState;
  /** When somebody looked. Null while nobody has. */
  reviewedAt: Date | null;
}

export interface HostSpace extends PublicSpace {
  status: SpaceStatus;
  addressLine: string;
  /** Alongside the address, and just as private. */
  lat: number | null;
  lng: number | null;
  entryInstructions: string;
  subleaseDocName: string | null;
  insuranceDocName: string | null;
  /*
   * We are holding somebody's lease. They should not have to guess whether it
   * was read, and "pending" on the listing covered three different answers.
   */
  subleaseReview: DocumentReview;
  insuranceReview: DocumentReview;
  /** Written by staff when something is rejected, and shown verbatim. */
  reviewNote: string | null;
}

/**
 * What a host may change after a listing exists.
 *
 * The set is narrower than the create form on purpose, and the database
 * enforces the same list — see 0019. Address and room type are in here, but
 * changing either sends the listing back for review and is refused outright
 * while sessions are booked against it.
 */
export interface SpaceEdit {
  name?: string;
  hourlyRateCents?: number;
  capacity?: number;
  accessType?: AccessTypeKey;
  entryInstructions?: string;
  description?: string;
  bufferMinutes?: number;
  accessible?: boolean | null;
  restroom?: RestroomOption | null;
  /*
   * The four access answers. Free to change and live immediately — correcting
   * "one step" to "step-free" after a ramp goes in is the app working, and
   * none of it is something a booking was agreed on.
   */
  entranceAccess?: AccessDetails["entrance"];
  floorAccess?: AccessDetails["floor"];
  doorwayInches?: number | null;
  restroomAccess?: AccessDetails["restroom"];
  category?: CategoryKey;
  addressLine?: string;
  /*
   * The address as a place, not as a string.
   *
   * Sent together or not at all. A listing whose text says one city and whose
   * coordinates say another is worse than one that is merely out of date: the
   * map after booking, the distance ranking on Discover and the pin on the
   * browse map all read the numbers, and all three would quietly point at the
   * building the host used to be in.
   */
  lat?: number;
  lng?: number;
  /** Re-resolved whenever the coordinates above change, never typed. */
  timeZone?: string;
  /** Derived from lat/lng by toBrowsePosition, and granted in 0037. */
  mapX?: number;
  mapY?: number;
  parking?: Parking;
  floorAreaSqft?: number | null;
}

/** The money frozen onto the booking at creation. Mirrors bookings' columns. */
export interface BookingMoneyRecord {
  hostRateCents: number;
  serviceFeeCents: number;
  instantFeeCents: number;
  proDiscountCents: number;
  totalCents: number;
  platformCents: number;
}

export interface Booking extends BookingMoneyRecord {
  id: string;
  spaceId: string;
  spaceName: string;
  roomType: string;
  category: CategoryKey;
  practitionerId: string;
  startsAt: Date;
  endsAt: Date;
  /**
   * The room's zone, carried so times can be written the way the host meant.
   *
   * `startsAt` is an absolute instant and always correct; what it is *called*
   * is not. "2:00 PM" formatted in the reader's zone is a different afternoon
   * from the one the host opened, and somebody who moves, travels or books
   * across a state line would be told the wrong hour by their own phone.
   */
  timeZone: string;
  status: BookingStatus;
  isInstant: boolean;
  wasPro: boolean;
  /**
   * Null until the reveal time has passed. The server withholds the value
   * rather than the client hiding it — see space_access_details in
   * supabase/migrations/0002_rls.sql for the same reasoning applied to
   * addresses.
   */
  revealedAccessCode: string | null;
  accessCodeRevealedAt: Date;
}

/** A booking as its host sees it: net earnings, never a fee percentage. */
export interface HostBooking {
  id: string;
  spaceId: string;
  practitionerName: string;
  practitionerCraft: string;
  startsAt: Date;
  endsAt: Date;
  status: BookingStatus;
  /** Exactly the host's rate. The platform's cut is not theirs to see. */
  netCents: number;
  /**
   * When the transfer reached their bank. Null until it has.
   *
   * Not "when it will be" — a session is settled or it is not, and a host
   * checking last week wants the difference.
   */
  hostPaidAt: Date | null;
}

/** One message on a booking's thread, as its two participants see it. */
export interface Message {
  id: string;
  bookingId: string;
  senderId: string;
  body: string;
  createdAt: Date;
  /** What was masked on the way out. Only meaningful on your own messages. */
  redactedKinds: string[];
}

/** Everything AddSpace collects, before the row exists. */
export interface NewSpaceInput {
  name: string;
  category: CategoryKey;
  hourlyRateCents: number;
  capacity: number;
  accessType: AccessTypeKey;
  entryInstructions: string;
  addressLine: string;
  /** Real coordinates, as private as the address they came from. */
  lat: number;
  lng: number;
  /**
   * The town, the state and the postcode, split by the geocoder.
   *
   * Public, unlike the three above — a listing already says which town it is
   * in, and these are the columns the city pages are built on. Null where the
   * provider did not return one. Nothing derives them from `addressLine`: a
   * town read off the wrong comma files a room under a place it is not in, and
   * every page built on it is then confidently wrong.
   */
  city: string | null;
  state: string | null;
  postalCode: string | null;
  /**
   * What the room is bookable for — slugs from lib/space-types.
   *
   * Several, because rooms are. A finer axis than `category`: a movement
   * studio genuinely suits yoga, pilates and mobility work alike, and one
   * label would be both less true and fewer pages for the same room.
   */
  suitableFor: string[];
  mapX: number;
  mapY: number;
  /** Resolved from the coordinates above, server-side. See zone-for-point.ts. */
  timeZone: string;
  parking: Parking;
  floorAreaSqft: number | null;
  /**
   * The four answered facts, which is what the listing shows.
   *
   * Not the old `accessible` boolean. That column is still there and still
   * written by nothing — see 0026 — because backfilling it into these would
   * mean inventing answers, and a fabricated accessibility claim is worse than
   * a missing one.
   */
  access: AccessDetails;
  restroom: RestroomOption | null;
  amenities: string[];
  requirements: string[];
  houseRules: string;
  /**
   * What the room is like, in the host's words.
   *
   * The column and the screen have both existed since the beginning; nothing
   * ever collected it, so every real listing showed an empty space where a
   * paragraph belonged.
   */
  description: string;
  bufferMinutes: number;
  availability: AvailabilityBlock[];
  /**
   * The files themselves, not previews of them.
   *
   * This carried `{ url, kind }` — a blob: URL from the browser's own
   * memory — and the repository dutifully stored the URL. Against the mock
   * that works, because the tab that made the URL is the tab that reads it.
   * Against a database it meant every listing was saved with a reference to
   * nothing, and the review process had no document to review.
   */
  media: { file: File; kind: MediaKind }[];
  subleaseDoc: File;
  insuranceDoc: File | null;
}
