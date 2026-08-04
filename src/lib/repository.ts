/**
 * The data boundary the screens are built against.
 *
 * Every method here maps to a query the Supabase layer will make, so swapping
 * the in-memory implementation for the real one in M2 does not touch a single
 * component. The shapes deliberately mirror the migrations: reads that a
 * practitioner makes go through the public projections, and anything private
 * (address, access code) is a separate call that can fail authorization
 * independently.
 */

import type {
  Booking,
  CreditEntry,
  HostBooking,
  HostSpace,
  NewSpaceInput,
  Profile,
  PublicSpace,
  SpaceAccessDetails,
} from "./domain";
import type { CancellationEvent } from "./reliability";

export interface Repository {
  getProfile(): Promise<Profile>;
  updateProfile(patch: Partial<Profile>): Promise<Profile>;

  /** Active listings only — mirrors the spaces_public view. */
  listPublicSpaces(): Promise<PublicSpace[]>;
  getPublicSpace(id: string): Promise<PublicSpace | null>;

  /**
   * Null unless the caller holds a booking on this space. Separate from
   * getPublicSpace so the privileged read is an explicit, auditable call
   * rather than an extra field that might get logged or cached alongside
   * public data.
   */
  getSpaceAccessDetails(spaceId: string): Promise<SpaceAccessDetails | null>;

  listMyBookings(): Promise<Booking[]>;
  createBooking(input: CreateBookingInput): Promise<Booking>;
  cancelBooking(bookingId: string, actor: "practitioner" | "host"): Promise<Booking>;

  getCreditBalanceCents(): Promise<number>;
  listCreditEntries(): Promise<CreditEntry[]>;

  /**
   * Every cancellation involving this user, either side.
   *
   * Returned raw rather than pre-scored so `standingFor` stays the single
   * place the rule lives — the profile screen, the cancel confirmation and
   * the booking check all read the same history through the same function.
   */
  listCancellationHistory(): Promise<CancellationEvent[]>;

  listMySpaces(): Promise<HostSpace[]>;
  createSpace(input: NewSpaceInput): Promise<HostSpace>;
  updateSpaceAvailability(spaceId: string, blocks: HostSpace["availability"]): Promise<HostSpace>;
  listHostBookings(): Promise<HostBooking[]>;

  /** Stands in for the manual review the brief defers to a later phase. */
  approveSpace(spaceId: string): Promise<HostSpace>;

  startProSubscription(): Promise<Profile>;

  /**
   * Begins payout onboarding. Against Stripe this creates an Express account
   * link and hands the host to Stripe's hosted KYC flow, which is where
   * identity and bank details are collected — deliberately never by us.
   */
  connectPayouts(): Promise<Profile>;

  /** Ends the session. */
  signOut(): Promise<void>;
}

export interface CreateBookingInput {
  spaceId: string;
  startsAt: Date;
}
