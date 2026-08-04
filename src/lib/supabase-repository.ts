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
import type {
  Booking,
  BookingStatus,
  CreditEntry,
  HostBooking,
  HostSpace,
  NewSpaceInput,
  Profile,
  PublicSpace,
  SpaceAccessDetails,
} from "./domain";
import type { CreateBookingInput, Repository } from "./repository";
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
  lat?: number | null;
  lng?: number | null;
}

interface AvailabilityRow {
  space_id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
}

interface MediaRow {
  id: string;
  space_id: string;
  storage_path: string;
  kind: "image" | "video";
}

const NOT_YET_WIRED =
  "Booking writes need a server route that is atomic with Stripe. Not available until the payments milestone.";

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
    // isPro and stripeConnected are absent on purpose: both are set by webhooks
    // after money or verification actually clears, never by the client asking.

    const { error } = await this.db.from("profiles").upsert(row);
    if (error) throw error;
    return this.getProfile();
  }

  async startProSubscription(): Promise<Profile> {
    throw new Error("Pro subscriptions need Stripe. Not available until the payments milestone.");
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
    const [{ data: blocks }, { data: media }] = await Promise.all([
      this.db.from("availability_public").select("*").in("space_id", ids),
      this.db.from("space_media_public").select("*").in("space_id", ids).order("position"),
    ]);

    return spaces.map((row: SpaceRow) =>
      this.toPublicSpace(
        row,
        (blocks ?? []).filter((b: AvailabilityRow) => b.space_id === row.id),
        (media ?? []).filter((m: MediaRow) => m.space_id === row.id),
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
      mapX: 50,
      mapY: 50,
      distanceLabel: "nearby",
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
        creditAppliedCents: row.credit_applied_cents,
        totalCents: row.total_cents,
        platformCents: row.platform_cents,
        revealedAccessCode: row.revealed_access_code ?? null,
        accessCodeRevealedAt: new Date(row.access_code_revealed_at),
      };
    });
  }

  async createBooking(_input: CreateBookingInput): Promise<Booking> {
    throw new Error(NOT_YET_WIRED);
  }

  async cancelBooking(_id: string, _actor: "practitioner" | "host"): Promise<Booking> {
    throw new Error(NOT_YET_WIRED);
  }

  /* ---------------- credit ---------------- */

  async getCreditBalanceCents(): Promise<number> {
    const { data, error } = await this.db
      .from("credit_balances")
      .select("balance_cents")
      .maybeSingle();
    if (error) throw error;
    return data?.balance_cents ?? 0;
  }

  async listCreditEntries(): Promise<CreditEntry[]> {
    const { data, error } = await this.db
      .from("credit_ledger")
      .select("id, delta_cents, note, reason, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;

    return (data ?? []).map((row) => ({
      id: row.id,
      deltaCents: row.delta_cents,
      reason: row.note ?? humanReason(row.reason),
      createdAt: new Date(row.created_at),
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
        entryInstructions: row.entry_instructions ?? "",
        subleaseDocName: row.sublease_doc_path ?? null,
        insuranceDocName: row.insurance_doc_path ?? null,
        distanceLabel: "your space",
      };
    });
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
        accessible: input.accessible,
        restroom: input.restroom?.toLowerCase() ?? null,
        buffer_minutes: input.bufferMinutes,
        amenities: input.amenities,
        requirements: input.requirements,
        house_rules: input.houseRules,
        sublease_doc_path: input.subleaseDocName,
        insurance_doc_path: input.insuranceDocName,
        legal_ack_at: new Date().toISOString(),
        // status defaults to 'pending'; nothing reaches Discover unreviewed.
      })
      .select()
      .single();
    if (error) throw error;

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

    const spaces = await this.listMySpaces();
    const created = spaces.find((s) => s.id === data.id);
    if (!created) throw new Error("Listing was created but could not be read back");
    return created;
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

function humanReason(reason: string): string {
  switch (reason) {
    case "host_cancellation":
      return "A host cancelled on you";
    case "booking_redemption":
      return "Applied to a booking";
    case "goodwill_restore":
      return "Credit returned";
    default:
      return reason;
  }
}
