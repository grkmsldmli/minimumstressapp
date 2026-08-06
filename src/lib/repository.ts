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
  CreatedBooking,
  HostBooking,
  HostSpace,
  Message,
  NewSpaceInput,
  Profile,
  PublicSpace,
  SpaceAccessDetails,
  SpaceEdit,
} from "./domain";
import type { CancellationEvent } from "./reliability";

export interface Repository {
  getProfile(): Promise<Profile>;
  updateProfile(patch: Partial<Profile>): Promise<Profile>;

  /**
   * Stores a profile photo and returns the profile that now points at it.
   *
   * Separate from updateProfile because a picture is bytes, not a field. It
   * was once handled by handing the screen a `blob:` URL from
   * URL.createObjectURL — which renders perfectly, survives nothing, and
   * vanishes the moment the tab navigates. It looked saved and never was.
   */
  uploadAvatar(file: File): Promise<Profile>;

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
  createBooking(input: CreateBookingInput): Promise<CreatedBooking>;
  cancelBooking(bookingId: string, actor: "practitioner" | "host"): Promise<Booking>;

  /**
   * Leaves a review on a finished session.
   *
   * Takes no author and no role: both are derived server-side from the
   * booking, because a caller who could name their own side could review as
   * the other party.
   */
  submitReview(input: ReviewInput): Promise<void>;

  /* ---------------- messages ---------------- */

  listMessages(bookingId: string): Promise<Message[]>;

  /**
   * Returns the message as it was actually sent, plus a note when something
   * was masked. The note is for the sender's own screen — the recipient never
   * saw what was hidden and does not need telling.
   */
  sendMessage(bookingId: string, body: string): Promise<{ notice: string | null }>;

  /* ---------------- standing ---------------- */

  getSessionCount(): Promise<number>;

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

  /**
   * Changes an existing listing.
   *
   * Rejects rather than silently doing less: moving a space that has sessions
   * booked against it throws, because somebody has arranged their day around
   * that address and changing it quietly is the harm the cancellation policy
   * exists to prevent. Changing the address, the room type or the lease sends
   * the listing back to pending — what was verified is no longer what is
   * listed.
   */
  editSpace(spaceId: string, edit: SpaceEdit): Promise<HostSpace>;
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

/** What the review screen collects. The server decides everything else. */
export interface ReviewInput {
  bookingId: string;
  overall: number;
  comment: string;
  safetyConcern: boolean;
  practitioner?: Record<string, unknown>;
  host?: Record<string, unknown>;
}
