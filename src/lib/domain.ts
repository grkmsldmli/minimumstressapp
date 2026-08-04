/**
 * Domain types, shaped to match the database rather than the screens.
 *
 * Money is always integer cents and always the host's rate — the practitioner
 * price is derived through `quote()`, never stored. A booking carries its own
 * frozen breakdown so a host raising their rate cannot rewrite history.
 */

import type { AvailabilityBlock } from "./availability";
import type { AccessTypeKey, CategoryKey, RestroomOption } from "./taxonomy";

export type SpaceStatus = "pending" | "active" | "delisted";
export type MediaKind = "image" | "video";
export type PayoutSchedule = "standard" | "instant";

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
  stripeConnected: boolean;
  notifyBookings: boolean;
  notifyPayouts: boolean;
  notifyOffers: boolean;
  emergencyContact: EmergencyContact;
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
  distanceLabel: string;
  /**
   * Counted from released reviews only, so a sealed one cannot be inferred by
   * watching the number move. The decision to withhold an average under three
   * reviews lives in reviews.ts, not here.
   */
  reviewCount: number;
  averageRating: number | null;
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
export interface HostSpace extends PublicSpace {
  status: SpaceStatus;
  addressLine: string;
  /** Alongside the address, and just as private. */
  lat: number | null;
  lng: number | null;
  entryInstructions: string;
  subleaseDocName: string | null;
  insuranceDocName: string | null;
}

/** The money frozen onto the booking at creation. Mirrors bookings' columns. */
export interface BookingMoneyRecord {
  hostRateCents: number;
  serviceFeeCents: number;
  instantFeeCents: number;
  proDiscountCents: number;
  creditAppliedCents: number;
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
}

export interface CreditEntry {
  id: string;
  deltaCents: number;
  reason: string;
  createdAt: Date;
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
  mapX: number;
  mapY: number;
  accessible: boolean | null;
  restroom: RestroomOption | null;
  amenities: string[];
  requirements: string[];
  houseRules: string;
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
