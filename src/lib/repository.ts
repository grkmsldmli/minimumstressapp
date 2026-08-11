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
  MediaKind,
  Message,
  NewSpaceInput,
  Profile,
  PublicReview,
  PublicSpace,
  SpaceAccessDetails,
  SpaceEdit,
} from "./domain";
import type { NotificationEntry } from "./notify/history";
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

  /**
   * What the app has sent this account, newest first.
   *
   * The rows existed from the first booking and only staff could read them,
   * so somebody who missed an email had nowhere in the product to look — not
   * even to find out whether it had been sent.
   */
  listNotifications(): Promise<NotificationEntry[]>;

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
   * What people wrote about a room, newest first.
   *
   * Reads the released view, so an unanswered review is invisible to everybody
   * including the person it is about — the machinery for that has existed since
   * 0011 and nothing has ever read from it.
   */
  listSpaceReviews(spaceId: string): Promise<PublicReview[]>;

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

  /**
   * Adds photos or a video to a listing that already exists.
   *
   * There was no way to do this at all: media could only be attached while
   * the listing was being created, so a host with a badly lit photo had to
   * delist and start over — losing the reviews and the history with it.
   */
  addSpaceMedia(spaceId: string, files: { file: File; kind: MediaKind }[]): Promise<HostSpace>;

  /**
   * Removes one item, from the bucket as well as the table.
   *
   * A row deleted on its own leaves the file sitting in storage with nothing
   * pointing at it — invisible, unreferenced, and still ours to hold.
   */
  removeSpaceMedia(spaceId: string, mediaId: string): Promise<HostSpace>;

  /**
   * Takes a listing off search, or puts it back.
   *
   * Delisting is not deletion and never touches a booking that already
   * exists: sessions on the calendar go ahead, because cancelling them to
   * tidy up a listing lands the harm on somebody who did nothing.
   */
  setSpaceListed(spaceId: string, listed: boolean): Promise<HostSpace>;
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
