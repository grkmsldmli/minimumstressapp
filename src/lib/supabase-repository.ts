/**
 * Repository backed by Supabase.
 *
 * Reads run as the signed-in user, so the RLS policies in
 * supabase/migrations/0002_rls.sql are the enforcement — not conventions this
 * file happens to follow. Where a query goes matters:
 *
 *   spaces_public / availability_public / space_media_public
 *       browsing, no address, no documents
 *   space_access_details(space_id)
 *       entry instructions and door code, released only once a booking exists
 *   bookings_with_access_code
 *       the code appears only after its reveal time, decided server-side
 *   host_bookings()
 *       who booked my room, net earnings, no fee columns at all
 *
 * Booking writes are deliberately absent. Creating or cancelling one has to
 * void, capture or refund a Stripe PaymentIntent in the same breath as writing
 * the row and its ledger entry, and a client that is interrupted between those
 * two steps leaves money in a state nobody reconciles. Those go through server
 * routes in the Stripe milestone; until then they throw rather than pretend.
 */

import { apiFetch } from "./api-fetch";
import { type HeldBookingRow, isHeldBooking } from "./booking-visibility";
import { payoutSetupFrom } from "./payout-setup";
import type { SupabaseClient } from "@supabase/supabase-js";

import { errorMessage } from "./error-message";

/**
 * A real Error carrying what Supabase actually said.
 *
 * PostgrestError is a plain object, so `throw error` sent something no screen
 * recognised — and every `instanceof Error` check downstream fell through to a
 * generic message, discarding the sentence a constraint or trigger raised for
 * exactly that moment.
 */
function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(errorMessage(cause, "Request failed"));
}

import type { AccessDetails } from "./access-details";
import type { AvailabilityBlock } from "./availability";
import type { NotificationEntry } from "./notify/history";
import {
  rejectionReason,
  spaceDocPath,
  practitionerDocPath,
  avatarPath,
  spaceMediaPath,
} from "./uploads";
import type {
  Booking,
  BookingRequest,
  BookingStatus,
  CreatedBooking,
  DocReviewState,
  HostBooking,
  HostSpace,
  MediaKind,
  Message,
  NewSpaceInput,
  OpenDispute,
  PublicReview,
  Profile,
  PublicSpace,
  SpaceAccessDetails,
  SpaceEdit,
} from "./domain";
import { toCancellationEvents, type CancellationEvent } from "./reliability";
import type { CreateBookingInput, Repository, ReviewInput } from "./repository";
import type { ApprovalState } from "./booking-approval";
import { knownUses } from "./booking-use";
import { knownSpaceTypes } from "./space-types";
import { type CategoryKey, isRoomSetupKey, roomTypeFor } from "./taxonomy";
import { type ClaimKind, claimType, overstayCents } from "./claims";
import { type RefundReason, questionFor } from "./refunds";
import { FALLBACK_ZONE } from "./timezone";

/** Rows as PostgREST returns them, before mapping into domain shapes. */
interface SpaceRow {
  id: string;
  host_id: string;
  name: string;
  category: CategoryKey;
  hourly_rate_cents: number;
  capacity: number;
  access_type: "keypad" | "lockbox" | "greeter";
  accessible: boolean | null;
  restroom: string | null;
  buffer_minutes: number;
  timezone: string;
  floor_area_sqft?: number | null;
  parking?: string[] | null;
  parking_limit_minutes?: number | null;
  status?: "pending" | "active" | "delisted";
  description?: string;
  amenities?: string[];
  requirements?: string[];
  house_rules?: string;
  address_line?: string;
  // Added in 0043. Optional here because the base table and the public view
  // are both read through this shape, and a row selected before the migration
  // ran simply has neither.
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  suitable_for?: string[] | null;
  room_setup?: string | null;
  allowed_uses?: string[] | null;
  booking_mode?: string | null;
  entry_instructions?: string;
  sublease_doc_path?: string;
  insurance_doc_path?: string | null;
  sublease_doc_state?: string;
  sublease_doc_reviewed_at?: string | null;
  insurance_doc_state?: string;
  insurance_doc_reviewed_at?: string | null;
  doc_review_note?: string | null;
  lat?: number | null;
  lng?: number | null;
  // numeric(4,1) arrives as a string from PostgREST, not a number.
  area?: string | null;
  entrance_access?: string | null;
  floor_access?: string | null;
  doorway_inches?: number | null;
  restroom_access?: string | null;
  address_line_public?: string | null;
  map_x?: number | string | null;
  map_y?: number | string | null;
}

interface AvailabilityRow {
  space_id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
}

interface MessageRow {
  id: string;
  booking_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  redacted_kinds: string[] | null;
}

interface MediaRow {
  id: string;
  space_id: string;
  storage_path: string;
  kind: "image" | "video";
}

/** A row of `bookings_with_access_code`, the fields a Booking is built from. */
interface BookingViewRow {
  id: string;
  space_id: string;
  practitioner_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  is_instant: boolean;
  was_pro: boolean;
  host_rate_cents: number;
  service_fee_cents: number;
  instant_fee_cents: number;
  pro_discount_cents: number;
  total_cents: number;
  platform_cents: number;
  revealed_access_code: string | null;
  access_code_revealed_at: string;
  approval_state: string | null;
}

/**
 * One view row into the domain Booking. Shared by the list and the by-id read
 * so they build the same shape; the space label comes from the public catalogue
 * because the view carries no name.
 */
function mapBookingRow(row: BookingViewRow, byId: Map<string, PublicSpace>): Booking {
  const space = byId.get(row.space_id);
  const category = (space?.category ?? "physical") as CategoryKey;
  return {
    id: row.id,
    spaceId: row.space_id,
    spaceName: space?.name ?? "Your booking",
    roomType: roomTypeFor(category),
    category,
    practitionerId: row.practitioner_id,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    timeZone: space?.timeZone ?? FALLBACK_ZONE,
    status: row.status as BookingStatus,
    isInstant: row.is_instant,
    wasPro: row.was_pro,
    hostRateCents: row.host_rate_cents,
    serviceFeeCents: row.service_fee_cents,
    instantFeeCents: row.instant_fee_cents,
    proDiscountCents: row.pro_discount_cents,
    totalCents: row.total_cents,
    platformCents: row.platform_cents,
    revealedAccessCode: row.revealed_access_code ?? null,
    accessCodeRevealedAt: new Date(row.access_code_revealed_at),
    // Older rows predate the column and are not requests.
    approvalState: (row.approval_state ?? "not_required") as ApprovalState,
  };
}


export class SupabaseRepository implements Repository {
  constructor(private readonly db: SupabaseClient) {}

  private async userId(): Promise<string> {
    const { data, error } = await this.db.auth.getUser();
    if (error || !data.user) throw new Error("Not signed in");
    return data.user.id;
  }

  /* ---------------- profile ---------------- */

  async getProfile(): Promise<Profile> {
    const { data: auth } = await this.db.auth.getUser();
    const user = auth.user;
    if (!user) throw new Error("Not signed in");

    const { data, error } = await this.db
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (error) throw asError(error);

    // A profile row is created on first sign-in, but a session can outlive a
    // failed insert, so absence is treated as "defaults" rather than an error.
    return {
      id: user.id,
      email: user.email ?? null,
      displayName: data?.display_name ?? null,
      avatarUrl: data?.avatar_path ? this.publicUrl("avatars", data.avatar_path) : null,
      isPro: data?.is_pro ?? false,
      insuranceDocName: data?.insurance_doc_path ?? null,
      // The practitioner's liability cover. Columns added in 0054; a row read
      // before the migration ran simply has none of them, which reads as an
      // unreviewed certificate — never as verified.
      insuranceReview: {
        state: (data?.insurance_doc_state as DocReviewState | undefined) ?? "pending",
        reviewedAt: data?.insurance_doc_reviewed_at
          ? new Date(data.insurance_doc_reviewed_at)
          : null,
      },
      insuranceEffectiveDate: data?.insurance_effective_date
        ? new Date(data.insurance_effective_date)
        : null,
      insuranceExpiresAt: data?.insurance_expires_at
        ? new Date(data.insurance_expires_at)
        : null,
      insuranceInsurer: data?.insurance_insurer ?? null,
      insurancePolicyNumber: data?.insurance_policy_number ?? null,
      insuranceReviewNote: data?.insurance_review_note ?? null,
      payoutSchedule: data?.payout_schedule ?? "standard",
      payoutSetup: payoutSetupFrom({
        stripe_connect_account_id: data?.stripe_connect_account_id ?? null,
        stripe_connect_charges_enabled: data?.stripe_connect_charges_enabled ?? false,
      }),
      notifyBookings: data?.notify_bookings ?? true,
      notifyPayouts: data?.notify_payouts ?? true,
      notifyOffers: data?.notify_offers ?? false,
      accountType: data?.account_type ?? null,
      searchPostcode: data?.search_postcode ?? null,
      termsVersion: data?.terms_version ?? null,
      termsAcceptedAt: data?.terms_accepted_at ? new Date(data.terms_accepted_at) : null,
      hostTermsVersion: data?.host_terms_version ?? null,
      hostTermsAcceptedAt: data?.host_terms_accepted_at
        ? new Date(data.host_terms_accepted_at)
        : null,
      milestonesSeen: (data?.milestones_seen as string[] | null) ?? [],
      // Read back only for its owner — this query runs as the signed-in user,
      // and no policy lets anyone select another person's profile row.
      emergencyContact: {
        name: data?.emergency_contact_name ?? null,
        phone: data?.emergency_contact_phone ?? null,
        relationship: data?.emergency_contact_relationship ?? null,
      },
    };
  }

  async updateProfile(patch: Partial<Profile>): Promise<Profile> {
    const id = await this.userId();

    const row: Record<string, unknown> = { id };
    if (patch.displayName !== undefined) row.display_name = patch.displayName;
    if (patch.notifyBookings !== undefined) row.notify_bookings = patch.notifyBookings;
    if (patch.notifyPayouts !== undefined) row.notify_payouts = patch.notifyPayouts;
    if (patch.notifyOffers !== undefined) row.notify_offers = patch.notifyOffers;
    if (patch.payoutSchedule !== undefined) row.payout_schedule = patch.payoutSchedule;
    if (patch.insuranceDocName !== undefined) row.insurance_doc_path = patch.insuranceDocName;
    if (patch.emergencyContact !== undefined) {
      row.emergency_contact_name = patch.emergencyContact.name;
      row.emergency_contact_phone = patch.emergencyContact.phone;
      row.emergency_contact_relationship = patch.emergencyContact.relationship;
    }
    /**
     * Writable exactly once, and the database is what enforces that — a
     * trigger refuses any change from one value to another. Sending it again
     * with the same value is harmless; sending a different one fails loudly
     * rather than quietly turning a practitioner into a host.
     */
    if (patch.searchPostcode !== undefined) row.search_postcode = patch.searchPostcode;
    if (patch.accountType !== undefined) row.account_type = patch.accountType;
    /*
     * The version travels; the timestamp does not. A trigger sets it from the
     * server clock, so a client cannot record that somebody agreed last year.
     */
    if (patch.termsVersion !== undefined) row.terms_version = patch.termsVersion;
    /*
     * Sent by the client, but the database decides the number: a trigger in
     * 0052 clamps whatever arrives to the current required version and stamps
     * the moment, so a caller cannot record a version they were not shown.
     */
    if (patch.hostTermsVersion !== undefined) row.host_terms_version = patch.hostTermsVersion;
    // Dismissing a card is the person's own action, and nothing downstream
    // reads this for money or access.
    if (patch.milestonesSeen !== undefined) row.milestones_seen = patch.milestonesSeen;

    // isPro and stripeConnected are absent on purpose: both are set by webhooks
    // after money or verification actually clears, never by the client asking.

    const { error } = await this.db.from("profiles").upsert(row);
    if (error) throw asError(error);
    return this.getProfile();
  }

  /**
   * A profile photo, actually stored.
   *
   * The screen used to be handed `URL.createObjectURL(file)` — a blob that
   * renders immediately, is never uploaded, and disappears the moment the tab
   * navigates. It looked saved and never was, and nothing said otherwise
   * because nothing was ever asked.
   *
   * Uploaded first, recorded second, so the path in the row always points at
   * bytes that are already there — the same order the listing documents use.
   */
  async uploadAvatar(file: File): Promise<Profile> {
    const reason = rejectionReason(file, "image");
    if (reason) throw new Error(reason);

    const id = await this.userId();
    const path = avatarPath(id, file.type, crypto.randomUUID());

    const { error: uploadError } = await this.db.storage
      .from("avatars")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw asError(uploadError);

    const { error } = await this.db.from("profiles").upsert({ id, avatar_path: path });
    if (error) throw asError(error);

    return this.getProfile();
  }

  /**
   * The practitioner's liability certificate, actually uploaded.
   *
   * The old flow stored the filename in insurance_doc_path and never uploaded
   * anything, so the admin review card had a name and no file to open. This
   * writes the bytes to the private verification-docs bucket under the
   * practitioner's own folder — the one the storage policy in 0003 lets them
   * write and the admin route knows how to sign — and records that real path.
   *
   * Uploaded first, recorded second, so the path in the row always points at
   * bytes that are already there — the same order the avatar and listing
   * documents use.
   */
  async uploadInsuranceCertificate(file: File): Promise<Profile> {
    const reason = rejectionReason(file, "document");
    if (reason) throw new Error(reason);

    const id = await this.userId();
    const path = practitionerDocPath(id, file.type, crypto.randomUUID());

    const { error: uploadError } = await this.db.storage
      .from("verification-docs")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw asError(uploadError);

    /*
     * A new certificate is unreviewed by definition, so the review returns to
     * pending: the staff note is cleared and reviewed-at is nulled, the shape
     * profiles_insurance_review_consistent (0054) requires and the booking gate
     * reads. Profiles has no edit-reset trigger the way spaces do (0019), so it
     * is set here. The verified-only date columns are left for staff to set on
     * re-verification; the pending state makes insuranceStatus ignore them.
     */
    const { error } = await this.db.from("profiles").upsert({
      id,
      insurance_doc_path: path,
      insurance_doc_state: "pending",
      insurance_doc_reviewed_at: null,
      insurance_review_note: null,
    });
    if (error) throw asError(error);

    return this.getProfile();
  }

  /**
   * Hands off to Stripe and leaves.
   *
   * Nothing is set here. The route decides whether this is a new subscription
   * or a visit to the billing portal, and the webhook is what eventually marks
   * the account Pro — a flag written on this side would be one the client
   * granted itself.
   */
  async startProSubscription(): Promise<Profile> {
    const response = await apiFetch("/api/pro", { method: "POST" });

    if (!response.ok) {
      const { error } = await response.json().catch(() => ({ error: null }));
      throw new Error(error ?? "Could not open Pro");
    }

    const { url } = (await response.json()) as { url: string };
    window.location.href = url;

    // The redirect ends this page. Returning the current profile keeps the
    // signature honest for the moment before the browser leaves.
    return this.getProfile();
  }

  /**
   * Hands the host to Stripe's hosted onboarding.
   *
   * The account is created server-side by the route, which also holds the
   * secret key; this only asks for the link and follows it. Nothing here marks
   * the host as connected — that is the `account.updated` webhook's job, and
   * only once Stripe says the account can actually receive money.
   */
  async connectPayouts(): Promise<Profile> {
    const response = await apiFetch("/api/connect/onboard", { method: "POST" });
    if (!response.ok) {
      const { error } = await response.json().catch(() => ({ error: null }));
      throw new Error(error ?? "Could not start payout setup");
    }

    const { url } = (await response.json()) as { url: string };
    window.location.href = url;

    // The redirect ends this page, so nothing after it runs. Returning the
    // current profile keeps the signature honest for the brief moment before
    // the browser leaves.
    return this.getProfile();
  }

  /**
   * The same tab, like every other trip to Stripe from here.
   *
   * This opened a blank tab first — the trick that keeps a popup blocker quiet
   * while a request is in flight — and set its location once the link arrived.
   * With `noopener` that cannot work: the browser withholds the handle to the
   * new window precisely so the opened page cannot reach back through it, and
   * the assignment lands on nothing. What a host got was a second tab reading
   * about:blank, permanently, with no error anywhere because the caller threw
   * the promise away.
   *
   * There is no popup to protect. The link carries a return_url back to
   * /host/payouts/done, so Stripe brings them home — the same way onboarding
   * has always worked, a few lines up.
   */
  async openPayoutDashboard(): Promise<void> {
    const response = await apiFetch("/api/connect/dashboard", { method: "POST" });
    if (!response.ok) {
      const { error } = await response.json().catch(() => ({ error: null }));
      throw new Error(error ?? "Could not open your payout account");
    }

    const { url } = (await response.json()) as { url: string };
    // A 200 carrying no link is still a failure, and silence here is what put
    // somebody on a blank page in the first place.
    if (!url) throw new Error("Stripe did not return a link to open");

    window.location.href = url;
  }

  async signOut(): Promise<void> {
    const { error } = await this.db.auth.signOut();
    if (error) throw asError(error);
  }

  /* ---------------- discovery ---------------- */

  private publicUrl(bucket: string, path: string): string {
    return this.db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  async listPublicSpaces(): Promise<PublicSpace[]> {
    const { data: spaces, error } = await this.db.from("spaces_public").select("*");
    if (error) throw asError(error);
    if (!spaces?.length) return [];

    const ids = spaces.map((s: SpaceRow) => s.id);

    // Two extra round trips rather than a nested select, because availability
    // and media come from their own views with their own visibility rules.
    const [{ data: blocks }, { data: media }, { data: ratings }] = await Promise.all([
      this.db.from("availability_public").select("*").in("space_id", ids),
      this.db.from("space_media_public").select("*").in("space_id", ids).order("position"),
      this.db.from("space_ratings").select("*").in("space_id", ids),
    ]);

    const ratingFor = new Map(
      (ratings ?? []).map((r: { space_id: string; review_count: number; average_rating: string }) => [
        r.space_id,
        // numeric arrives as a string from PostgREST, the same as map_x.
        { count: r.review_count, average: Number(r.average_rating) },
      ]),
    );

    return spaces.map((row: SpaceRow) =>
      this.toPublicSpace(
        row,
        (blocks ?? []).filter((b: AvailabilityRow) => b.space_id === row.id),
        (media ?? []).filter((m: MediaRow) => m.space_id === row.id),
        ratingFor.get(row.id),
      ),
    );
  }

  async getPublicSpace(id: string): Promise<PublicSpace | null> {
    const { data, error } = await this.db
      .from("spaces_public")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw asError(error);
    if (!data) return null;

    const [{ data: blocks }, { data: media }] = await Promise.all([
      this.db.from("availability_public").select("*").eq("space_id", id),
      this.db.from("space_media_public").select("*").eq("space_id", id).order("position"),
    ]);

    return this.toPublicSpace(data, blocks ?? [], media ?? []);
  }

  private toPublicSpace(
    row: SpaceRow,
    blocks: AvailabilityRow[],
    media: MediaRow[],
    rating?: { count: number; average: number },
  ): PublicSpace {
    return {
      id: row.id,
      hostId: row.host_id,
      name: row.name,
      category: row.category,
      hourlyRateCents: row.hourly_rate_cents,
      capacity: row.capacity,
      accessType: row.access_type,
      accessible: row.accessible,
      restroom: (row.restroom as PublicSpace["restroom"]) ?? null,
      bufferMinutes: row.buffer_minutes,
      // Older rows predate the column; the fallback is the same one the
      // migration used to seed them, not a guess made here.
      timeZone: row.timezone || FALLBACK_ZONE,
      parking: {
        options: row.parking ?? [],
        limitMinutes: row.parking_limit_minutes ?? null,
      },
      floorAreaSqft: row.floor_area_sqft ?? null,
      addressLine: row.address_line ?? null,
      lat: row.lat ?? null,
      lng: row.lng ?? null,
      amenities: row.amenities ?? [],
      requirements: row.requirements ?? [],
      houseRules: row.house_rules ?? "",
      description: row.description ?? "",
      media: media.map((m) => ({
        id: m.id,
        url: this.publicUrl("space-media", m.storage_path),
        kind: m.kind,
      })),
      availability: blocks.map((b) => ({
        weekday: b.weekday,
        startMinute: b.start_minute,
        endMinute: b.end_minute,
      })),
      // Position on the illustration, not a location. The real coordinates are
      // absent from this view by design.
      mapX: Number(row.map_x ?? 50),
      mapY: Number(row.map_y ?? 50),
      area: row.area ?? null,
      // Stored rather than parsed out of `area` — see 0043.
      city: (row.city as string | null) ?? null,
      state: (row.state as string | null) ?? null,
      suitableFor: knownSpaceTypes((row.suitable_for as string[] | null) ?? []),
      allowedUses: knownUses((row.allowed_uses as string[] | null) ?? []),
      bookingMode: row.booking_mode === "request" ? "request" : "instant",
      // Defaulted rather than left null: a listing with no answer here is a
      // private room, which is what every one of them was before the column
      // existed.
      roomSetup: isRoomSetupKey(row.room_setup) ? row.room_setup : "private_room",
      access: {
        entrance: (row.entrance_access as AccessDetails["entrance"]) ?? null,
        floor: (row.floor_access as AccessDetails["floor"]) ?? null,
        doorwayInches: row.doorway_inches ?? null,
        restroom: (row.restroom_access as AccessDetails["restroom"]) ?? null,
      },
      distanceLabel: "nearby",
      reviewCount: rating?.count ?? 0,
      averageRating: rating?.average ?? null,
    };
  }

  async getSpaceAccessDetails(spaceId: string): Promise<SpaceAccessDetails | null> {
    // The function performs its own booking check; an empty result means "you
    // are not entitled", not "this space has no address".
    const { data, error } = await this.db.rpc("space_access_details", { p_space_id: spaceId });
    if (error) throw asError(error);

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;

    return {
      addressLine: row.address_line,
      entryInstructions: row.entry_instructions,
      accessType: row.access_type,
      lat: row.lat ?? null,
      lng: row.lng ?? null,
    };
  }

  /* ---------------- bookings ---------------- */

  async listMyBookings(): Promise<Booking[]> {
    /**
     * Mine as in "I booked it", which is what the name says and what the
     * query did not do.
     *
     * The view runs as the caller, and a host's row policy on `bookings`
     * lets them read every booking on their own spaces — correctly, that is
     * how their calendar works. Without this filter those came back here too,
     * and the app treated a session somebody else had booked in the host's
     * room as a session the host had booked: it appeared in their own
     * bookings list, and the message thread greeted the studio owner with
     * "message the studio".
     *
     * The access code was never exposed by this — the view withholds it
     * unless the reader is the practitioner — but everything around it was
     * being read from the wrong side.
     */
    const me = await this.userId();

    const { data, error } = await this.db
      .from("bookings_with_access_code")
      .select("*")
      .eq("practitioner_id", me)
      .order("starts_at", { ascending: false });
    if (error) throw asError(error);
    if (!data?.length) return [];

    /*
     * A checkout somebody walked away from is not a booking they had.
     *
     * Releasing an abandoned hour writes it as a cancellation, which is the
     * only status the schema has for it, and it was then appearing in their
     * own history as "Cancelled" — a session they never paid for and never
     * held, listed as one they gave up. Same line as everywhere else: money
     * arrived, or it never happened.
     */
    /*
     * The `|| status === "upcoming"` that used to be on this line let the
     * whole rule through anyway.
     *
     * An abandoned checkout is `upcoming` with no `captured_at` for the thirty
     * minutes before the reaper reaches it. So a closed card form showed up
     * here as a session, and under Book again as "Last used" — a room somebody
     * had never paid for and never stood in, offered back to them as a habit.
     *
     * The cost of running the rule properly is a second or two: a booking paid
     * for right now stays invisible until `payment_intent.succeeded` lands.
     * That is the right direction to be wrong in — briefly missing something
     * real beats indefinitely showing something that never was.
     */
    /*
     * Or held, which is the same evidence for a request.
     *
     * A request holds the card rather than charging it, so `captured_at` stays
     * null until the host approves — and filtering on it alone made a guest's
     * own request vanish the moment they paid for it. They would have had no
     * way to tell whether it had been sent, and no way to cancel it.
     *
     * `authorized_at` is the equivalent line for that case: a card was entered
     * and the money is held. An abandoned checkout has neither, so it is still
     * excluded, which is what this filter was always for.
     */
    const real = data.filter((row) => isHeldBooking(row as HeldBookingRow));
    if (!real.length) return [];

    // The view carries no space name, and a practitioner cannot read `spaces`
    // directly, so the label comes from the public catalogue.
    const spaces = await this.listPublicSpaces();
    const byId = new Map(spaces.map((s) => [s.id, s]));

    return real.map((row) => mapBookingRow(row, byId));
  }

  /**
   * One booking by its id, the just-created one included.
   *
   * `listMyBookings` deliberately hides an in-flight checkout hold — captured_at
   * null, approval "not_required" — because it has no place in a list of real
   * sessions. But the moment right after creating one, the caller needs exactly
   * that row back so the payment sheet can open against it. This reads it
   * directly by id, scoped to the signed-in practitioner so it is still only
   * ever their own booking, and applies no held-visibility filter. It invents
   * nothing: every field is the server's, read back from the view.
   */
  async getBookingById(bookingId: string): Promise<Booking | null> {
    const me = await this.userId();

    const { data, error } = await this.db
      .from("bookings_with_access_code")
      .select("*")
      .eq("id", bookingId)
      .eq("practitioner_id", me)
      .maybeSingle();
    if (error) throw asError(error);
    if (!data) return null;

    const spaces = await this.listPublicSpaces();
    return mapBookingRow(data, new Map(spaces.map((s) => [s.id, s])));
  }

  /**
   * Booking goes through the server, and that is the security boundary.
   *
   * The request carries a space and a start time and nothing else. Everything
   * that decides a price — the host's rate, whether the slot is instant,
   * whether this practitioner is Pro, how much credit they hold — is read
   * server-side from rows the client cannot write. A client that computed its
   * own total could simply send a smaller one.
   *
   * It is also the only place that can write the booking row, its ledger entry
   * and a Stripe PaymentIntent as one unit. A practitioner has no insert
   * rights on `bookings` by design, so this cannot be done from here even if
   * it were safe to.
   */
  async createBooking(input: CreateBookingInput): Promise<CreatedBooking> {
    const response = await apiFetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spaceId: input.spaceId,
        startsAt: input.startsAt.toISOString(),
        purpose: input.declared.purpose,
        purposeNote: input.declared.purposeNote ?? null,
        attendees: input.declared.attendees,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      bookingId?: string;
      clientSecret?: string;
      error?: string;
    };

    if (!response.ok || !payload.bookingId) {
      // The route's own message says why — the slot was taken, the host cannot
      // be paid, the time is in the past. Those are worth showing verbatim.
      throw new Error(payload.error ?? `Booking failed (${response.status})`);
    }

    // Read the row back by id rather than through listMyBookings: a booking
    // still awaiting its card is a hold that list deliberately hides, so routing
    // the just-created one through it would drop the very row the payment sheet
    // needs. This reads the database's own row directly — no second, invented
    // version — so the sheet opens against real server state.
    const booking = await this.getBookingById(payload.bookingId);
    if (!booking) throw new Error("Booking was created but could not be read back");

    return { booking, clientSecret: payload.clientSecret ?? null };
  }

  /**
   * Cancelling is a Stripe operation before it is a database one — the hold is
   * voided or captured, credit is issued or restored — so it lives behind the
   * same route for the same reason.
   */
  async cancelBooking(id: string, actor: "practitioner" | "host"): Promise<Booking> {
    const response = await apiFetch(`/api/bookings/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? `Cancellation failed (${response.status})`);
    }

    const booking = (await this.listMyBookings()).find((b) => b.id === id);
    if (!booking) throw new Error("Booking was cancelled but could not be read back");
    return booking;
  }

  /**
   * Reviews are written through a server route for the same reason bookings
   * are: eligibility depends on facts a client can be made to lie about, and
   * `reviews` has no insert policy at all.
   */
  async submitReview(input: ReviewInput): Promise<void> {
    const response = await apiFetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? `Could not save that review (${response.status})`);
    }
  }

  /* ---------------- messages ---------------- */

  /**
   * Read straight from the view, because reading is a policy the database can
   * answer on its own: either you are on the booking or you are not. Sending
   * is different — see below.
   */
  async listMessages(bookingId: string): Promise<Message[]> {
    const { data, error } = await this.db
      .from("messages_visible")
      .select("*")
      .eq("booking_id", bookingId)
      .order("created_at");

    if (error) throw asError(error);

    return (data ?? []).map((row: MessageRow) => ({
      id: row.id,
      bookingId: row.booking_id,
      senderId: row.sender_id,
      body: row.body,
      createdAt: new Date(row.created_at),
      redactedKinds: row.redacted_kinds ?? [],
    }));
  }

  /**
   * Sent through the server, because the masking has to happen somewhere a
   * client cannot skip. A client that could insert its own row could insert an
   * unmasked one, and the whole point is that a phone number never reaches the
   * other side.
   */
  async listNotifications(): Promise<NotificationEntry[]> {
    /*
     * The view, not the table.
     *
     * `notifications` carries the queue's own working — attempts, the last
     * provider error, the dedupe key — and none of it is the recipient's
     * business. The grant behind the view is column-level for the same
     * reason: a policy alone would let a client skip the view and read them.
     */
    const { data, error } = await this.db
      .from("my_notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw asError(error);

    return (data ?? []).map((row) => ({
      id: row.id as string,
      kind: row.kind as string,
      channel: row.channel as string,
      state: row.state as NotificationEntry["state"],
      sentAt: row.sent_at ? new Date(row.sent_at as string) : null,
      createdAt: new Date(row.created_at as string),
      bookingId: (row.booking_id as string) ?? null,
    }));
  }

  async sendMessage(bookingId: string, body: string): Promise<{ notice: string | null }> {
    const response = await apiFetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId, body }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      notice?: string | null;
      error?: string;
    };

    if (!response.ok) throw new Error(payload.error ?? `Could not send (${response.status})`);
    return { notice: payload.notice ?? null };
  }

  /* ---------------- standing ---------------- */

  /**
   * The view filters itself to the caller, so this reads one row or none.
   * None means nothing has happened yet, which is zero rather than an error.
   */
  /**
   * Completed, paid, arm's-length sessions. Drives the badges and nothing else.
   *
   * The view filters itself to the caller, so this reads one row or none. None
   * means nothing has happened yet, which is zero rather than an error.
   */
  async getSessionCount(): Promise<number> {
    const { data, error } = await this.db.from("session_counts").select("sessions").maybeSingle();
    if (error) throw asError(error);
    return data?.sessions ?? 0;
  }

  /* ---------------- credit ---------------- */

  /**
   * Cancellations on both sides of this user's bookings.
   *
   * RLS already scopes it: a practitioner sees their own bookings, a host sees
   * those on their spaces. So this returns what they are entitled to and
   * `standingFor` picks out the side being asked about.
   *
   * Only ones that cancelled a real session. A checkout somebody walked away
   * from is released as a practitioner cancellation — that is the only status
   * the schema has for it — and counting those would let six closed tabs
   * suspend an account that never let anybody down. `captured_at` is the line:
   * money arrived, so an hour was genuinely taken and then given back.
   */
  async listCancellationHistory(): Promise<CancellationEvent[]> {
    const { data, error } = await this.db
      .from("bookings")
      .select("starts_at, cancelled_at, cancelled_by, captured_at")
      .not("cancelled_at", "is", null);
    if (error) throw asError(error);

    // The abandoned-checkout exclusion lives in toCancellationEvents, shared
    // with the server booking gate and the admin watchlist, so the card and the
    // enforcement can never count different things. A released hold has no
    // captured_at and drops out there; standingFor keeps only the caller's side.
    return toCancellationEvents(
      (data ?? []).map((row) => ({
        cancelledBy: row.cancelled_by,
        capturedAt: row.captured_at,
        cancelledAt: row.cancelled_at,
        sessionStart: row.starts_at,
      })),
    );
  }

  /* ---------------- hosting ---------------- */

  async listMySpaces(): Promise<HostSpace[]> {
    const hostId = await this.userId();

    // The base table here, not spaces_public: a host must see their own
    // pending listings and their own address.
    const { data: spaces, error } = await this.db
      .from("spaces")
      .select("*")
      .eq("host_id", hostId)
      .order("created_at");
    if (error) throw asError(error);
    if (!spaces?.length) return [];

    const ids = spaces.map((s: SpaceRow) => s.id);
    const [{ data: blocks }, { data: media }] = await Promise.all([
      this.db.from("availability").select("*").in("space_id", ids),
      this.db.from("space_media").select("*").in("space_id", ids).order("position"),
    ]);

    return spaces.map((row: SpaceRow): HostSpace => {
      const base = this.toPublicSpace(
        row,
        (blocks ?? []).filter((b: AvailabilityRow) => b.space_id === row.id),
        (media ?? []).filter((m: MediaRow) => m.space_id === row.id),
      );
      return {
        ...base,
        status: row.status ?? "pending",
        addressLine: row.address_line ?? "",
        lat: row.lat ?? null,
        lng: row.lng ?? null,
        entryInstructions: row.entry_instructions ?? "",
        subleaseDocName: row.sublease_doc_path ?? null,
        insuranceDocName: row.insurance_doc_path ?? null,
        subleaseReview: {
          state: (row.sublease_doc_state as DocReviewState) ?? "pending",
          reviewedAt: row.sublease_doc_reviewed_at
            ? new Date(row.sublease_doc_reviewed_at as string)
            : null,
        },
        insuranceReview: {
          state: (row.insurance_doc_state as DocReviewState) ?? "pending",
          reviewedAt: row.insurance_doc_reviewed_at
            ? new Date(row.insurance_doc_reviewed_at as string)
            : null,
        },
        reviewNote: (row.doc_review_note as string) ?? null,
        area: null,
        access: {
          entrance: (row.entrance_access as AccessDetails["entrance"]) ?? null,
          floor: (row.floor_access as AccessDetails["floor"]) ?? null,
          doorwayInches: row.doorway_inches ?? null,
          restroom: (row.restroom_access as AccessDetails["restroom"]) ?? null,
        },
        distanceLabel: "your space",
        reviewCount: 0,
        averageRating: null,
      };
    });
  }

  /**
   * What people wrote about a room.
   *
   * Straight from `public_reviews`, which is where the release rule lives —
   * both sides wrote, or fourteen days passed. Filtering here instead would be
   * a second copy of that rule in a language the database cannot check.
   */
  async listSpaceReviews(spaceId: string): Promise<PublicReview[]> {
    const { data, error } = await this.db
      .from("public_reviews")
      .select("id, overall, comment, role, created_at")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw asError(error);

    return (data ?? []).map((row) => ({
      id: row.id as string,
      overall: row.overall as number,
      comment: (row.comment as string) || null,
      role: row.role as PublicReview["role"],
      createdAt: new Date(row.created_at as string),
    }));
  }

  /**
   * Everything either side has said about a session that is still unsettled.
   *
   * Two reads rather than one query, because they are two tables with two row
   * policies and joining them in SQL would mean a view that has to be right
   * about both. The lists are short by nature — a marketplace with a long one
   * has a different problem than a screen can fix.
   */
  async listOpenDisputes(): Promise<OpenDispute[]> {
    const me = await this.userId();

    const [refunds, claims] = await Promise.all([
      this.db
        .from("refund_requests")
        .select(
          "id, reason, detail, state, practitioner_id, outcome, bookings!inner(id, starts_at, total_cents, spaces!inner(name, timezone))",
        )
        .order("created_at", { ascending: false }),
      this.db
        .from("studio_claims")
        .select(
          "id, kind, detail, state, host_id, charged_cents, minutes_over, claimed_cents, bookings!inner(id, starts_at, spaces!inner(name, timezone, hourly_rate_cents))",
        )
        .order("created_at", { ascending: false }),
    ]);

    if (refunds.error) throw asError(refunds.error);
    if (claims.error) throw asError(claims.error);

    const fromRefunds: OpenDispute[] = (refunds.data ?? []).map((row) => {
      const booking = (row as unknown as { bookings: RefundBookingRow }).bookings;
      return {
        id: row.id as string,
        kind: "refund" as const,
        bookingId: booking.id,
        spaceName: booking.spaces.name,
        sessionStart: new Date(booking.starts_at),
        timeZone: booking.spaces.timezone,
        reason: questionFor(row.reason as RefundReason).label,
        detail: row.detail as string,
        amountCents: booking.total_cents,
        // The host answers a refund request; the practitioner made it.
        awaitingYou: row.state === "awaiting_host" && row.practitioner_id !== me,
        outcome: (row.outcome as string) ?? null,
      };
    });

    const fromClaims: OpenDispute[] = (claims.data ?? []).map((row) => {
      const booking = (row as unknown as { bookings: ClaimBookingRow }).bookings;
      const type = claimType(row.kind as ClaimKind);
      return {
        id: row.id as string,
        kind: "claim" as const,
        bookingId: booking.id,
        spaceName: booking.spaces.name,
        sessionStart: new Date(booking.starts_at),
        timeZone: booking.spaces.timezone,
        reason: type.label,
        detail: row.detail as string,
        amountCents:
          (row.charged_cents as number) ??
          type.fixedCents ??
          (row.kind === "overstay"
            ? overstayCents((row.minutes_over as number) ?? 0, booking.spaces.hourly_rate_cents)
            : ((row.claimed_cents as number) ?? null)),
        // The practitioner answers a claim; the studio made it.
        awaitingYou: row.state === "awaiting_practitioner" && row.host_id !== me,
        outcome: ["upheld", "rejected", "uncollectable"].includes(row.state as string)
          ? (row.state as string)
          : null,
      };
    });

    return [...fromRefunds, ...fromClaims].sort(
      (a, b) => Number(b.awaitingYou) - Number(a.awaitingYou),
    );
  }

  async editSpace(spaceId: string, edit: SpaceEdit): Promise<HostSpace> {
    const hostId = await this.userId();

    const patch: Record<string, unknown> = {};
    if (edit.name !== undefined) patch.name = edit.name;
    if (edit.hourlyRateCents !== undefined) patch.hourly_rate_cents = edit.hourlyRateCents;
    if (edit.capacity !== undefined) patch.capacity = edit.capacity;
    if (edit.accessType !== undefined) patch.access_type = edit.accessType;
    if (edit.entryInstructions !== undefined) patch.entry_instructions = edit.entryInstructions;
    if (edit.description !== undefined) patch.description = edit.description;
    if (edit.bufferMinutes !== undefined) patch.buffer_minutes = edit.bufferMinutes;
    if (edit.accessible !== undefined) patch.accessible = edit.accessible;
    if (edit.restroom !== undefined) patch.restroom = edit.restroom;
    if (edit.entranceAccess !== undefined) patch.entrance_access = edit.entranceAccess;
    if (edit.floorAccess !== undefined) patch.floor_access = edit.floorAccess;
    if (edit.doorwayInches !== undefined) patch.doorway_inches = edit.doorwayInches;
    if (edit.restroomAccess !== undefined) patch.restroom_access = edit.restroomAccess;
    if (edit.category !== undefined) patch.category = edit.category;
    if (edit.addressLine !== undefined) patch.address_line = edit.addressLine;
    if (edit.lat !== undefined) patch.lat = edit.lat;
    // Moves with the address too. A room that changed town and kept its old
    // one sits on the wrong city page indefinitely, and nothing on the listing
    // itself looks wrong — the address reads correctly, the map is right, and
    // only the page it is filed under is a lie.
    if (edit.city !== undefined) patch.city = edit.city;
    if (edit.state !== undefined) patch.state = edit.state;
    if (edit.postalCode !== undefined) patch.postal_code = edit.postalCode;
    // Not part of the move, and not locked by bookings — see SpaceEdit.
    if (edit.suitableFor !== undefined) patch.suitable_for = knownSpaceTypes(edit.suitableFor);
    if (edit.roomSetup !== undefined) patch.room_setup = edit.roomSetup;
    // Moves with the address. A room that crossed a zone boundary and kept its
    // old zone would quietly shift every future booking by an hour.
    if (edit.timeZone !== undefined) patch.timezone = edit.timeZone;
    if (edit.floorAreaSqft !== undefined) patch.floor_area_sqft = edit.floorAreaSqft;
    if (edit.parking !== undefined) {
      patch.parking = edit.parking.options;
      patch.parking_limit_minutes = edit.parking.limitMinutes;
    }
    if (edit.lng !== undefined) patch.lng = edit.lng;
    // The pin on the browse map is derived from the coordinates, so it moves
    // with them. Writable since 0037 — before that the column was granted at
    // insert and never after, and this update failed on the one path that
    // needed it.
    if (edit.mapX !== undefined) patch.map_x = edit.mapX;
    if (edit.mapY !== undefined) patch.map_y = edit.mapY;

    if (Object.keys(patch).length === 0) {
      const [unchanged] = (await this.listMySpaces()).filter((s) => s.id === spaceId);
      return unchanged;
    }

    /**
     * The host id is in the filter as well as the policy.
     *
     * Belt and braces on the one call that can rewrite a live listing: the
     * policy is what stops it, and this is what makes a mistake here fail
     * loudly rather than quietly matching nothing.
     */
    const { error } = await this.db
      .from("spaces")
      .update(patch)
      .eq("id", spaceId)
      .eq("host_id", hostId);

    // The trigger in 0019 raises when a booked space is moved. Its message is
    // written for the host and says how many sessions are in the way, so it is
    // passed through rather than replaced with something vaguer.
    if (error) throw new Error(error.message);

    const [updated] = (await this.listMySpaces()).filter((s) => s.id === spaceId);
    return updated;
  }

  async addSpaceMedia(
    spaceId: string,
    files: { file: File; kind: MediaKind }[],
  ): Promise<HostSpace> {
    const hostId = await this.userId();

    for (const item of files) {
      const reason = rejectionReason(item.file, item.kind === "video" ? "video" : "image");
      if (reason) throw new Error(reason);
    }

    // Appended after whatever is already there, so adding a photo does not
    // reshuffle the order a host chose for the ones they had.
    const { data: existing } = await this.db
      .from("space_media")
      .select("position")
      .eq("space_id", spaceId)
      .order("position", { ascending: false })
      .limit(1);

    let position = ((existing?.[0]?.position as number) ?? -1) + 1;

    for (const item of files) {
      const path = spaceMediaPath(hostId, spaceId, item.file.type, crypto.randomUUID());

      const { error: uploadError } = await this.db.storage
        .from("space-media")
        .upload(path, item.file, { contentType: item.file.type, upsert: false });
      if (uploadError) throw asError(uploadError);

      // Uploaded first, recorded second, so a row always points at bytes that
      // are already there.
      const { error } = await this.db
        .from("space_media")
        .insert({ space_id: spaceId, storage_path: path, kind: item.kind, position });
      if (error) throw asError(error);

      position += 1;
    }

    const [updated] = (await this.listMySpaces()).filter((s) => s.id === spaceId);
    return updated;
  }

  async removeSpaceMedia(spaceId: string, mediaId: string): Promise<HostSpace> {
    const { data: row, error: readError } = await this.db
      .from("space_media")
      .select("storage_path")
      .eq("id", mediaId)
      .eq("space_id", spaceId)
      .maybeSingle();
    if (readError) throw asError(readError);
    if (!row) throw new Error("That photo is no longer on this listing.");

    const { error } = await this.db
      .from("space_media")
      .delete()
      .eq("id", mediaId)
      .eq("space_id", spaceId);
    if (error) throw asError(error);

    /*
     * The row goes first, the file second.
     *
     * If the storage delete fails the listing is already correct and an
     * orphaned object is a cleanup job. The other order leaves a row pointing
     * at a file that is gone, which is a broken image on somebody's screen.
     */
    await this.db.storage.from("space-media").remove([row.storage_path as string]);

    const [updated] = (await this.listMySpaces()).filter((s) => s.id === spaceId);
    return updated;
  }

  async setSpaceListed(spaceId: string, listed: boolean): Promise<HostSpace> {
    const hostId = await this.userId();

    const { error } = await this.db
      .from("spaces")
      .update({ status: listed ? "pending" : "delisted" })
      .eq("id", spaceId)
      .eq("host_id", hostId);
    if (error) throw asError(error);

    const [updated] = (await this.listMySpaces()).filter((s) => s.id === spaceId);
    return updated;
  }

  async createSpace(input: NewSpaceInput): Promise<HostSpace> {
    const hostId = await this.userId();

    const { data, error } = await this.db
      .from("spaces")
      .insert({
        host_id: hostId,
        name: input.name,
        category: input.category,
        hourly_rate_cents: input.hourlyRateCents,
        capacity: input.capacity,
        access_type: input.accessType,
        entry_instructions: input.entryInstructions,
        address_line: input.addressLine,
        // Private, and only ever read back through space_access_details.
        lat: input.lat,
        lng: input.lng,
        // Public, and the axes every city page is built on — see 0043. Null
        // where the geocoder did not say: a room with no town appears on no
        // city page, which is recoverable, rather than on the wrong one.
        city: input.city,
        state: input.state,
        postal_code: input.postalCode,
        // Filtered against the same list the database constrains, so a stale
        // tab posting a renamed use loses the use rather than the listing.
        suitable_for: knownSpaceTypes(input.suitableFor),
        room_setup: input.roomSetup,
        // The coarse, public derivation of lat/lng — see 0008.
        map_x: input.mapX,
        map_y: input.mapY,
        // The four the listing reads. `accessible` is deliberately left null:
        // 0026 kept the old boolean and stopped writing it, and guessing one
        // from the other in either direction invents an accessibility claim.
        entrance_access: input.access.entrance,
        floor_access: input.access.floor,
        doorway_inches: input.access.doorwayInches,
        restroom_access: input.access.restroom,
        restroom: input.restroom?.toLowerCase() ?? null,
        buffer_minutes: input.bufferMinutes,
        timezone: input.timeZone,
        floor_area_sqft: input.floorAreaSqft,
        parking: input.parking.options,
        parking_limit_minutes: input.parking.limitMinutes,
        description: input.description,
        amenities: input.amenities,
        requirements: input.requirements,
        house_rules: input.houseRules,
        // Filled in below, once the files are actually somewhere.
        sublease_doc_path: null,
        insurance_doc_path: null,
        legal_ack_at: new Date().toISOString(),
        // status defaults to 'pending'; nothing reaches Discover unreviewed.
      })
      .select()
      .single();
    if (error) throw asError(error);

    /**
     * Files go up after the row exists, and the row is removed if they fail.
     *
     * The order is forced: every storage policy for these buckets asks whether
     * the first path segment is a space this host owns, which cannot be true
     * before the space exists. That leaves a window where a listing exists
     * with no photo and no document — a listing that can never be reviewed and
     * would sit in the queue looking like someone else's problem. So a failure
     * here takes the row with it.
     */
    try {
      await this.uploadSpaceFiles(data.id, hostId, input);

      if (input.availability.length > 0) {
        const { error: blockError } = await this.db.from("availability").insert(
          input.availability.map((b) => ({
            space_id: data.id,
            weekday: b.weekday,
            start_minute: b.startMinute,
            end_minute: b.endMinute,
          })),
        );
        if (blockError) throw blockError;
      }
    } catch (failure) {
      // Best effort: if this also fails the listing is orphaned, which is
      // recoverable by staff, whereas leaving it silently is not.
      await this.db.from("spaces").delete().eq("id", data.id);
      throw failure;
    }

    const spaces = await this.listMySpaces();
    const created = spaces.find((s) => s.id === data.id);
    if (!created) throw new Error("Listing was created but could not be read back");
    return created;
  }

  /**
   * Puts a listing's photos and paperwork where the storage policies expect
   * them, and records where that was.
   *
   * Every file is validated again here rather than trusting the form. The form
   * is a convenience for the person filling it in; this is the last point
   * before bytes reach a bucket, and the only one that is not a UI.
   */
  private async uploadSpaceFiles(
    spaceId: string,
    hostId: string,
    input: NewSpaceInput,
  ): Promise<void> {
    const mediaRows: { space_id: string; storage_path: string; kind: MediaKind; position: number }[] =
      [];

    for (const [index, item] of input.media.entries()) {
      const reason = rejectionReason(item.file, item.kind);
      if (reason) throw new Error(reason);

      const path = spaceMediaPath(hostId, spaceId, item.file.type, crypto.randomUUID());
      const { error } = await this.db.storage.from("space-media").upload(path, item.file, {
        contentType: item.file.type,
        // Never overwrite. A generated name should not collide, and if it
        // somehow did, replacing another listing's photo is the wrong repair.
        upsert: false,
      });
      if (error) throw asError(error);

      mediaRows.push({ space_id: spaceId, storage_path: path, kind: item.kind, position: index });
    }

    if (mediaRows.length > 0) {
      const { error } = await this.db.from("space_media").insert(mediaRows);
      if (error) throw asError(error);
    }

    const subleaseReason = rejectionReason(input.subleaseDoc, "document");
    if (subleaseReason) throw new Error(subleaseReason);

    const subleasePath = spaceDocPath(hostId, spaceId, input.subleaseDoc.type, crypto.randomUUID());
    const { error: subleaseError } = await this.db.storage
      .from("verification-docs")
      .upload(subleasePath, input.subleaseDoc, {
        contentType: input.subleaseDoc.type,
        upsert: false,
      });
    if (subleaseError) throw subleaseError;

    let insurancePath: string | null = null;
    if (input.insuranceDoc) {
      const insuranceReason = rejectionReason(input.insuranceDoc, "document");
      if (insuranceReason) throw new Error(insuranceReason);

      insurancePath = spaceDocPath(hostId, spaceId, input.insuranceDoc.type, crypto.randomUUID());
      const { error } = await this.db.storage
        .from("verification-docs")
        .upload(insurancePath, input.insuranceDoc, {
          contentType: input.insuranceDoc.type,
          upsert: false,
        });
      if (error) throw asError(error);
    }

    // Written last, so a path in the row always points at a file that is
    // already there — never the other way round.
    const { error: pathError } = await this.db
      .from("spaces")
      .update({ sublease_doc_path: subleasePath, insurance_doc_path: insurancePath })
      .eq("id", spaceId)
      .eq("host_id", hostId);
    if (pathError) throw pathError;
  }

  async updateSpaceAvailability(
    spaceId: string,
    blocks: AvailabilityBlock[],
  ): Promise<HostSpace> {
    // Replace rather than diff. The template is small, and a partial update
    // that failed halfway would leave hours open that the host had closed.
    const { error: clearError } = await this.db
      .from("availability")
      .delete()
      .eq("space_id", spaceId);
    if (clearError) throw clearError;

    if (blocks.length > 0) {
      const { error } = await this.db.from("availability").insert(
        blocks.map((b) => ({
          space_id: spaceId,
          weekday: b.weekday,
          start_minute: b.startMinute,
          end_minute: b.endMinute,
        })),
      );
      if (error) throw asError(error);
    }

    const spaces = await this.listMySpaces();
    const updated = spaces.find((s) => s.id === spaceId);
    if (!updated) throw new Error(`No such space: ${spaceId}`);
    return updated;
  }

  async listHostBookings(): Promise<HostBooking[]> {
    const { data, error } = await this.db.rpc("host_bookings");
    if (error) throw asError(error);

    return (data ?? []).map(
      (row: {
        booking_id: string;
        space_id: string;
        starts_at: string;
        ends_at: string;
        status: BookingStatus;
        host_paid_at: string | null;
        net_cents: number;
        practitioner_name: string | null;
      }): HostBooking => ({
        id: row.booking_id,
        spaceId: row.space_id,
        practitionerName: row.practitioner_name ?? "A practitioner",
        practitionerCraft: "",
        startsAt: new Date(row.starts_at),
        endsAt: new Date(row.ends_at),
        status: row.status,
        netCents: row.net_cents,
        hostPaidAt: row.host_paid_at ? new Date(row.host_paid_at) : null,
      }),
    );
  }

  async listBookingRequests(): Promise<BookingRequest[]> {
    const { data, error } = await this.db.rpc("host_requests");
    if (error) throw asError(error);

    return (data ?? []).map(
      (row: {
        booking_id: string;
        space_id: string;
        space_name: string;
        starts_at: string;
        ends_at: string;
        requested_at: string;
        net_cents: number;
        practitioner_name: string | null;
        purpose: string | null;
        purpose_note: string | null;
        attendee_count: number | null;
      }): BookingRequest => ({
        id: row.booking_id,
        spaceId: row.space_id,
        spaceName: row.space_name,
        practitionerName: row.practitioner_name ?? "A practitioner",
        startsAt: new Date(row.starts_at),
        endsAt: new Date(row.ends_at),
        requestedAt: new Date(row.requested_at),
        netCents: row.net_cents,
        purpose: row.purpose,
        purposeNote: row.purpose_note,
        attendeeCount: row.attendee_count,
      }),
    );
  }

  /**
   * Through the server, because approving is a capture.
   *
   * The host has update rights on exactly three approval columns (0049), which
   * is enough to write the answer and not enough to move the money — and the
   * money is the point: an approval that wrote `approved` without capturing
   * the hold would confirm a session nobody had paid for, and a decline that
   * did not release it would leave a guest's card held over a booking that no
   * longer exists.
   */
  async answerBookingRequest(
    bookingId: string,
    decision: "approve" | "decline",
    note?: string,
  ): Promise<void> {
    const response = await apiFetch(
      `/api/bookings/${encodeURIComponent(bookingId)}/approval`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note }),
      },
    );

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error ?? `Could not answer that request (${response.status})`);
    }
  }

  async approveSpace(_spaceId: string): Promise<HostSpace> {
    // Review is a manual, staff-side process by design — the brief defers the
    // admin panel deliberately. A host approving their own listing would defeat
    // the point of reviewing sublease documents at all.
    throw new Error("Listings are reviewed by staff, not from the app.");
  }

  async simulateInboundBooking(): Promise<null> {
    return null;
  }
}


/** The joined shapes the dispute lists read back, named so the casts are honest. */
interface RefundBookingRow {
  id: string;
  starts_at: string;
  total_cents: number;
  spaces: { name: string; timezone: string };
}

interface ClaimBookingRow {
  id: string;
  starts_at: string;
  spaces: { name: string; timezone: string; hourly_rate_cents: number };
}
