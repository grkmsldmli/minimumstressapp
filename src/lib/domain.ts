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
  description: string;
  media: SpaceMedia[];
  availability: AvailabilityBlock[];
  /** Illustrative map position, standing in for real coordinates. */
  mapX: number;
  mapY: number;
  distanceLabel: string;
}

/** Released only once the practitioner holds a booking on this space. */
export interface SpaceAccessDetails {
  addressLine: string;
  entryInstructions: string;
  accessType: AccessTypeKey;
}

/** A host's own listing, including the fields never shown to practitioners. */
export interface HostSpace extends PublicSpace {
  status: SpaceStatus;
  addressLine: string;
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
  mapX: number;
  mapY: number;
  accessible: boolean | null;
  restroom: RestroomOption | null;
  amenities: string[];
  bufferMinutes: number;
  availability: AvailabilityBlock[];
  media: { url: string; kind: MediaKind }[];
  subleaseDocName: string;
  insuranceDocName: string | null;
}
