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
 *       address and entry instructions, released only once a booking exists
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

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AvailabilityBlock } from "./availability";
import {
  rejectionReason,
  spaceDocPath,
  avatarPath,
  spaceMediaPath,
} from "./uploads";
import type {
  Booking,
  BookingStatus,
  CreatedBooking,
  DocReviewState,
  HostBooking,
  HostSpace,
  MediaKind,
  Message,
  NewSpaceInput,
  Profile,
  PublicSpace,
  SpaceAccessDetails,
  SpaceEdit,
} from "./domain";
import type { CancellationEvent } from "./reliability";
import type { CreateBookingInput, Repository, ReviewInput } from "./repository";
import { type CategoryKey, roomTypeFor } from "./taxonomy";

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
  status?: "pending" | "active" | "delisted";
  description?: string;
  amenities?: string[];
  requirements?: string[];
  house_rules?: string;
  address_line?: string;
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
    if (error) throw error;

    // A profile row is created on first sign-in, but a session can outlive a
    // failed insert, so absence is treated as "defaults" rather than an error.
    return {
      id: user.id,
      email: user.email ?? null,
      displayName: data?.display_name ?? null,
      avatarUrl: data?.avatar_path ? this.publicUrl("avatars", data.avatar_path) : null,
      isPro: data?.is_pro ?? false,
      insuranceDocName: data?.insurance_doc_path ?? null,
      payoutSchedule: data?.payout_schedule ?? "standard",
      stripeConnected: data?.stripe_connect_charges_enabled ?? false,
      notifyBookings: data?.notify_bookings ?? true,
      notifyPayouts: data?.notify_payouts ?? true,
      notifyOffers: data?.notify_offers ?? false,
      accountType: data?.account_type ?? null,
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
    if (patch.accountType !== undefined) row.account_type = patch.accountType;

    // isPro and stripeConnected are absent on purpose: both are set by webhooks
    // after money or verification actually clears, never by the client asking.

    const { error } = await this.db.from("profiles").upsert(row);
    if (error) throw error;
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
    if (uploadError) throw uploadError;

    const { error } = await this.db.from("profiles").upsert({ id, avatar_path: path });
    if (error) throw error;

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
    const response = await fetch("/api/pro", { method: "POST" });

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
    const response = await fetch("/api/connect/onboard", { method: "POST" });
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

  async signOut(): Promise<void> {
    const { error } = await this.db.auth.signOut();
    if (error) throw error;
  }

  /* ---------------- discovery ---------------- */

  private publicUrl(bucket: string, path: string): string {
    return this.db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  async listPublicSpaces(): Promise<PublicSpace[]> {
    const { data: spaces, error } = await this.db.from("spaces_public").select("*");
    if (error) throw error;
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
    if (error) throw error;
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
      distanceLabel: "nearby",
      reviewCount: rating?.count ?? 0,
      averageRating: rating?.average ?? null,
    };
  }

  async getSpaceAccessDetails(spaceId: string): Promise<SpaceAccessDetails | null> {
    // The function performs its own booking check; an empty result means "you
    // are not entitled", not "this space has no address".
    const { data, error } = await this.db.rpc("space_access_details", { p_space_id: spaceId });
    if (error) throw error;

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
    const { data, error } = await this.db
      .from("bookings_with_access_code")
      .select("*")
      .order("starts_at", { ascending: false });
    if (error) throw error;
    if (!data?.length) return [];

    // The view carries no space name, and a practitioner cannot read `spaces`
    // directly, so the label comes from the public catalogue.
    const spaces = await this.listPublicSpaces();
    const byId = new Map(spaces.map((s) => [s.id, s]));

    return data.map((row): Booking => {
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
      };
    });
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
    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spaceId: input.spaceId,
        startsAt: input.startsAt.toISOString(),
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

    // Read back rather than assembled from the response: the row the database
    // holds is the one every other screen will show, and building a second
    // version here is how two truths appear.
    const booking = (await this.listMyBookings()).find((b) => b.id === payload.bookingId);
    if (!booking) throw new Error("Booking was created but could not be read back");

    return { booking, clientSecret: payload.clientSecret ?? null };
  }

  /**
   * Cancelling is a Stripe operation before it is a database one — the hold is
   * voided or captured, credit is issued or restored — so it lives behind the
   * same route for the same reason.
   */
  async cancelBooking(id: string, actor: "practitioner" | "host"): Promise<Booking> {
    const response = await fetch(`/api/bookings/${encodeURIComponent(id)}/cancel`, {
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
    const response = await fetch("/api/reviews", {
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

    if (error) throw error;

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
  async sendMessage(bookingId: string, body: string): Promise<{ notice: string | null }> {
    const response = await fetch("/api/messages", {
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
    if (error) throw error;
    return data?.sessions ?? 0;
  }

  /* ---------------- credit ---------------- */

  /**
   * Cancellations on both sides of this user's bookings.
   *
   * RLS already scopes it: a practitioner sees their own bookings, a host sees
   * those on their spaces. So this returns what they are entitled to and
   * `standingFor` picks out the side being asked about.
   */
  async listCancellationHistory(): Promise<CancellationEvent[]> {
    const { data, error } = await this.db
      .from("bookings")
      .select("starts_at, cancelled_at, cancelled_by")
      .not("cancelled_at", "is", null);
    if (error) throw error;

    return (data ?? [])
      .filter((row) => row.cancelled_by === "host" || row.cancelled_by === "practitioner")
      .map((row) => ({
        at: new Date(row.cancelled_at),
        sessionStart: new Date(row.starts_at),
        by: row.cancelled_by as "host" | "practitioner",
      }));
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
    if (error) throw error;
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
        distanceLabel: "your space",
        reviewCount: 0,
        averageRating: null,
      };
    });
  }

  async editSpace(spaceId: string, edit: SpaceEdit): Promise<HostSpace> {
    const hostId = await this.userId();

    const patch: Record<string, unknown> = {};
    if (edit.name !== undefined) patch.name = edit.name;
    if (edit.hourlyRateCents !== undefined) patch.hourly_rate_cents = edit.hourlyRateCents;
    if (edit.capacity !== undefined) patch.capacity = edit.capacity;
    if (edit.accessType !== undefined) patch.access_type = edit.accessType;
    if (edit.entryInstructions !== undefined) patch.entry_instructions = edit.entryInstructions;
    if (edit.bufferMinutes !== undefined) patch.buffer_minutes = edit.bufferMinutes;
    if (edit.accessible !== undefined) patch.accessible = edit.accessible;
    if (edit.restroom !== undefined) patch.restroom = edit.restroom;
    if (edit.category !== undefined) patch.category = edit.category;
    if (edit.addressLine !== undefined) patch.address_line = edit.addressLine;
    if (edit.lat !== undefined) patch.lat = edit.lat;
    if (edit.lng !== undefined) patch.lng = edit.lng;

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
        // The coarse, public derivation of the two above — see 0008.
        map_x: input.mapX,
        map_y: input.mapY,
        accessible: input.accessible,
        restroom: input.restroom?.toLowerCase() ?? null,
        buffer_minutes: input.bufferMinutes,
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
    if (error) throw error;

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
      if (error) throw error;

      mediaRows.push({ space_id: spaceId, storage_path: path, kind: item.kind, position: index });
    }

    if (mediaRows.length > 0) {
      const { error } = await this.db.from("space_media").insert(mediaRows);
      if (error) throw error;
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
      if (error) throw error;
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
      if (error) throw error;
    }

    const spaces = await this.listMySpaces();
    const updated = spaces.find((s) => s.id === spaceId);
    if (!updated) throw new Error(`No such space: ${spaceId}`);
    return updated;
  }

  async listHostBookings(): Promise<HostBooking[]> {
    const { data, error } = await this.db.rpc("host_bookings");
    if (error) throw error;

    return (data ?? []).map(
      (row: {
        booking_id: string;
        space_id: string;
        starts_at: string;
        ends_at: string;
        status: BookingStatus;
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
      }),
    );
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

