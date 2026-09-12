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
  BoardFilters,
  CreatedBooking,
  BookingRequest,
  ClassTemplate,
  ClassTemplateInput,
  CoverageRequest,
  CoverageRequestInput,
  HostBooking,
  HostSpace,
  MediaKind,
  Message,
  NewSpaceInput,
  OpenDispute,
  Profile,
  PublicReview,
  PublicSpace,
  ReferralSummary,
  RequestInterest,
  RosterMember,
  SpaceAccessDetails,
  SpaceEdit,
  WorkOpportunity,
  WorkPreferences,
  WorkPreferencesInput,
} from "./domain";
import type { AvailabilityBlock } from "./availability";
import type { NotificationEntry } from "./notify/history";
import type { DeclaredUse } from "./booking-use";
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

  /**
   * The practitioner's liability certificate, actually uploaded.
   *
   * Bytes, not a field. The file goes into the private verification-docs bucket
   * at practitioner/{userId}/…, the stored path points at it, and the review
   * returns to pending so staff re-check a new certificate. The old flow saved
   * only the filename, leaving the admin a name and no file to open.
   */
  uploadInsuranceCertificate(file: File): Promise<Profile>;

  /**
   * A professional credential (license or certificate), uploaded to the private
   * bucket with what the practitioner typed about it. Review returns to pending;
   * only staff can verify it. Required to book only for a profession whose rule
   * is "required" (see lib/professions).
   */
  uploadCredentialCertificate(
    file: File,
    details: {
      credentialType: string | null;
      credentialNumber: string | null;
      credentialJurisdiction: string | null;
    },
  ): Promise<Profile>;

  /** Active listings only — mirrors the spaces_public view. */
  listPublicSpaces(): Promise<PublicSpace[]>;
  getPublicSpace(id: string): Promise<PublicSpace | null>;

  /**
   * Record what a practitioner was looking for when nothing suitable came back,
   * so an empty search is a demand signal rather than a dead end. Reuses the
   * open space-request capture — the town is required, the space type optional;
   * no new data model, no reward, no promise beyond "we'll write when one opens".
   */
  requestSpace(input: { lookingIn: string; spaceType?: string | null }): Promise<void>;

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

  /**
   * Mark the caller's incoming messages on a booking as read. Server-authoritative
   * (only read_at changes, only on messages addressed to the caller); returns how
   * many were newly marked, so a no-op is a plain 0.
   */
  markMessagesRead(bookingId: string): Promise<number>;

  /**
   * Unread incoming messages per booking, keyed by booking id — server truth
   * (the caller's own messages never count). Bookings with none are absent.
   */
  unreadMessageCounts(): Promise<Record<string, number>>;

  /**
   * Report the other party in a booking (App Store Guideline 1.2). The server
   * derives who the other party is from the booking and records who, which
   * booking, and why for staff review — never an address, code, or message.
   */
  reportBooking(bookingId: string, reason: string): Promise<void>;

  /**
   * Block the other party in a booking so neither can message the other. The
   * booking, its records and its access details are untouched — only the chat
   * closes. A repeat block is a no-op.
   */
  blockBookingParty(bookingId: string): Promise<void>;

  /* ---------------- standing ---------------- */

  getSessionCount(): Promise<number>;

  /**
   * How many Founding Host spots are still open, derived from real rows.
   *
   * Straight from `founding_hosts_remaining()` — a count of hosts who hold a
   * founding number, subtracted from fifty, never a stored or seeded figure.
   * Shown to a host who has not earned the status while spots remain.
   */
  foundingHostsRemaining(): Promise<number>;

  /**
   * How many Founding Practitioner spots are still open, derived from real rows.
   *
   * Straight from `founding_practitioners_remaining()` — a count of practitioners
   * who have earned a founding number, subtracted from fifty, never stored or
   * seeded. Shown to a practitioner who has not earned the status while spots
   * remain.
   */
  foundingPractitionersRemaining(): Promise<number>;

  /* ---------------- referrals ---------------- */

  /**
   * The caller's own shareable referral code, assigned on first read.
   *
   * Server-generated, stable once set, and opaque — it is not the user's id.
   * The share link is built from it; see lib/referrals.
   */
  myReferralCode(): Promise<string>;

  /**
   * The caller's referrals, as safe status summaries — no referred-host id or
   * private data. Empty for anyone who has referred nobody.
   */
  listReferrals(): Promise<ReferralSummary[]>;

  /**
   * Lock this account's attribution to the referrer behind `code`.
   *
   * Server-authoritative and idempotent: a self-referral, an unknown code, an
   * already-attributed account, or an account that has already begun hosting is
   * silently a no-op. Safe to call more than once. No reward is created.
   */
  attributeReferral(code: string): Promise<void>;

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
   * Refund requests and studio claims involving this account, both directions.
   *
   * One call rather than two, because the screen that shows them is one screen:
   * a person wants to know what is waiting on them, not which table it is in.
   */
  listOpenDisputes(): Promise<OpenDispute[]>;

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

  /** Hide immediately and ask staff to archive the listing permanently. */
  requestSpaceClosure(
    spaceId: string,
    reason: import("./listing-closure").ListingClosureReason,
    detail?: string,
  ): Promise<HostSpace>;
  updateSpaceAvailability(spaceId: string, blocks: HostSpace["availability"]): Promise<HostSpace>;
  listHostBookings(): Promise<HostBooking[]>;

  /**
   * What is waiting on the host to answer.
   *
   * Separate from listHostBookings because they are separate questions and,
   * underneath, separate SQL: a host's bookings are captured sessions, and a
   * request is uncaptured by definition.
   */
  listBookingRequests(): Promise<BookingRequest[]>;

  /**
   * Say yes or no to one.
   *
   * The note is optional and only reaches the guest on a decline — a host is
   * entitled to refuse their own room without giving a reason, and requiring
   * one would just produce a field full of full stops.
   */
  answerBookingRequest(
    bookingId: string,
    decision: "approve" | "decline",
    note?: string,
  ): Promise<void>;

  /** Stands in for the manual review the brief defers to a later phase. */
  approveSpace(spaceId: string): Promise<HostSpace>;

  startProSubscription(): Promise<Profile>;

  /**
   * Start or manage Studio Pro — the host-account subscription that unlocks the
   * Work coverage board's host side. Opens hosted Stripe Checkout (or the billing
   * portal if already subscribed) in the system browser; studio_pro is granted
   * only by the webhook. The Founding-Host free period needs no call at all — it
   * is derived server-side from founding status.
   */
  startStudioProSubscription(): Promise<Profile>;

  /**
   * Begin the one-time identity check. Against Stripe this opens a hosted
   * Identity session — a government ID and a selfie, which we never see — and
   * hands the practitioner to it. The verified state is written only by the
   * webhook, so this never marks anyone verified; it just opens the form. When
   * the practitioner is already verified it resolves without leaving the app.
   */
  startIdentityVerification(): Promise<Profile>;

  /**
   * Begins payout onboarding. Against Stripe this creates an Express account
   * link and hands the host to Stripe's hosted KYC flow, which is where
   * identity and bank details are collected — deliberately never by us.
   */
  connectPayouts(): Promise<Profile>;

  /**
   * Opens the host's own Stripe dashboard, for everything that happens after
   * onboarding: a changed bank account, a payout that bounced, a detail Stripe
   * has started asking for.
   */
  openPayoutDashboard(): Promise<void>;

  /* ---------------- work (practitioner) ---------------- */

  /**
   * The caller's Work opt-in and preferences. Returns defaults (off, no
   * location) for a practitioner who has never opened Work — the row is created
   * on first save, not on first read.
   */
  getWorkPreferences(): Promise<WorkPreferences>;
  /**
   * Change the "available for work" switch and the soft preferences around it.
   * Turning it off takes the practitioner out of future matching immediately;
   * existing interest and confirmed shifts are untouched.
   */
  updateWorkPreferences(patch: WorkPreferencesInput): Promise<WorkPreferences>;

  /** The caller's recurring weekly work availability, as a flat block list. */
  getWorkAvailability(): Promise<AvailabilityBlock[]>;
  /** Replace the whole weekly template (normalised) — never a partial diff. */
  setWorkAvailability(blocks: AvailabilityBlock[]): Promise<AvailabilityBlock[]>;

  /**
   * The coverage job board: every open, future request, browseable by a Pro
   * practitioner, plus any the practitioner has already engaged with (for
   * status). No matching decides visibility — the optional filters only narrow
   * the browse, and only safe previews leave the server. Requires Work Pro
   * server-side (a free practitioner gets a 403, not an empty list).
   */
  listWorkOpportunities(filters?: BoardFilters): Promise<WorkOpportunity[]>;
  /** Say "I can cover that." No practitioner id — the server derives it. */
  expressWorkInterest(requestId: string, message: string | null): Promise<void>;
  /** Take back an interest, or step out of a shift already confirmed. */
  withdrawWorkInterest(interestId: string): Promise<void>;

  /* ---------------- work (host / studio) ---------------- */

  /** The host's own reusable class templates, newest first, archived excluded. */
  listClassTemplates(): Promise<ClassTemplate[]>;
  createClassTemplate(input: ClassTemplateInput): Promise<ClassTemplate>;
  updateClassTemplate(id: string, patch: ClassTemplateInput): Promise<ClassTemplate>;
  /** Archive rather than delete — a past request may still name it. */
  archiveClassTemplate(id: string): Promise<void>;

  /** The host's own coverage requests, newest first, with a live interest count. */
  listCoverageRequests(): Promise<CoverageRequest[]>;
  createCoverageRequest(input: CoverageRequestInput): Promise<CoverageRequest>;
  cancelCoverageRequest(id: string): Promise<void>;
  /**
   * Repost an existing request as a fresh open one at a new time — the whole
   * session context is copied, no applicants carry over. Requires Studio Pro.
   */
  duplicateCoverageRequest(id: string, startsAt: Date): Promise<CoverageRequest>;

  /**
   * The practitioners interested in one of the host's requests, as safe previews
   * — a partial name, profession, the coarse trust signals, a distance label.
   * Never a document, contact detail, or exact location. Full name arrives only
   * once one is confirmed.
   */
  listRequestInterest(requestId: string): Promise<RequestInterest[]>;
  /**
   * Confirm one interested practitioner. Atomic on the server: exactly one is
   * confirmed and the rest are declined, so a second confirm cannot double-fill.
   */
  confirmRequestInterest(requestId: string, interestId: string): Promise<void>;

  /* ---------------- work (My Roster — Studio Pro) ---------------- */

  /**
   * The host's trusted-substitute network, newest first. Requires Studio Pro.
   * "Times worked together" is derived from confirmed covers, never stored.
   */
  listRoster(): Promise<RosterMember[]>;
  /**
   * Keep a practitioner on the roster. Only allowed after the host has confirmed
   * them for at least one class — no cold-adding a stranger.
   */
  addToRoster(practitionerId: string, note: string | null): Promise<void>;
  removeFromRoster(rosterId: string): Promise<void>;
  /**
   * Invite a roster member to a specific open request. Notifies only — never an
   * assignment; the practitioner still applies and is confirmed the normal way.
   */
  inviteFromRoster(requestId: string, practitionerId: string): Promise<void>;

  /** Ends the session. */
  signOut(): Promise<void>;
}

export interface CreateBookingInput {
  spaceId: string;
  startsAt: Date;
  /** What the space will be used for, and how many will be there. */
  declared: DeclaredUse;
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
