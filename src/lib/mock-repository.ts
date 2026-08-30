/**
 * In-memory Repository, for building and reviewing screens before Supabase is
 * connected. Every rule the real backend will enforce is enforced here too —
 * pricing goes through `quote()`, cancellations through `resolveCancellation()`,
 * and the credit balance is always a sum over the ledger, never a stored number.
 *
 * Two deliberate choices about seed data, following the note the prototype left
 * itself after seeding fake data made a brand-new host believe they already had
 * an active listing:
 *
 *   Other people's listings are seeded, because a marketplace with nothing in
 *   it cannot be reviewed and a real practitioner would see other hosts' rooms.
 *
 *   The current user starts with nothing — no spaces, no bookings, no credit,
 *   not Pro. Their empty states are real states, and the numbers on the host
 *   dashboard and Earnings screen stay honest until something actually happens.
 */

import {
  type AvailabilityBlock,
  normalize,
  slotStartsForDate,
} from "./availability";
import type {
  Booking,
  BookingMoneyRecord,
  CreatedBooking,
  BookingRequest,
  HostBooking,
  HostSpace,
  Message,
  NewSpaceInput,
  OpenDispute,
  PublicReview,
  Profile,
  PublicSpace,
  ReferralSummary,
  SpaceAccessDetails,
} from "./domain";
import {
  bookingMoneyFromQuote,
  isInstantSlot,
  quote,
  resolveCancellation,
} from "./money";
import { explainRedaction, redact } from "./message-redaction";
import { toCancellationEvents, type CancellationEvent } from "./reliability";
import type { CreateBookingInput, Repository } from "./repository";
import type { AccessDetails } from "./access-details";
import type { MediaKind, SpaceEdit } from "./domain";
import type { NotificationEntry } from "./notify/history";
import { knownUses } from "./booking-use";
import { FOUNDING_HOST_LIMIT } from "./founding";
import { knownSpaceTypes } from "./space-types";
import { type CategoryKey, type RoomSetupKey, roomTypeFor } from "./taxonomy";
import { SESSION_MINUTES } from "./session";
import { FALLBACK_ZONE, addDays, civilIn } from "./timezone";
import { rejectionReason } from "./uploads";

const ME = "me";
const ACCESS_CODE_LEAD_MS = 30 * 60 * 1000;

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Four digits, from the platform's CSPRNG rather than Math.random. */
function generateAccessCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 10_000).padStart(4, "0");
}

/** Weekday blocks, as a convenience for the seed data below. */
const block = (weekday: number, startHour: number, endHour: number): AvailabilityBlock => ({
  weekday,
  startMinute: startHour * 60,
  endMinute: endHour * 60,
});

const WEEKDAYS_ALL = [0, 1, 2, 3, 4, 5, 6];
const everyDay = (startHour: number, endHour: number) =>
  WEEKDAYS_ALL.map((d) => block(d, startHour, endHour));

interface SeedSpace {
  name: string;
  category: CategoryKey;
  /** What the room is bookable for — slugs from lib/space-types. */
  suitableFor: string[];
  /** Private room, a room in a shared studio, or the whole place. */
  roomSetup: RoomSetupKey;
  /**
   * The host's rate — what they receive. The prototype stored the all-in
   * price here and divided it back out by 1.2, which shorted the host and
   * produced an 18.4% fee instead of 20%.
   */
  hourlyRateCents: number;
  capacity: number;
  description: string;
  amenities: string[];
  requirements: string[];
  houseRules: string;
  accessible: boolean;
  restroom: PublicSpace["restroom"];
  bufferMinutes: number;
  mapX: number;
  mapY: number;
  area: string | null;
  addressLine: string | null;
  lat: number | null;
  lng: number | null;
  access: AccessDetails;
  distanceLabel: string;
  availability: AvailabilityBlock[];
}

const SEED_SPACES: SeedSpace[] = [
  {
    name: "Willow",
    roomSetup: "whole_studio",
    suitableFor: ["pilates-studio", "movement-studio"],
    category: "physical",
    hourlyRateCents: 4500,
    capacity: 3,
    description:
      "A quiet reformer studio above a garden courtyard. Mirrors on one wall, ivy on the other.",
    amenities: ["mirrors", "sound_system", "natural_light", "storage", "reformers", "mats"],
    requirements: ["grip_socks", "indoor_shoes", "no_food_drink"],
    houseRules: "Reformer springs are colour-coded by resistance — please reset them to red before you leave.",
    accessible: true,
    restroom: "Shared",
    bufferMinutes: 15,
    mapX: 38,
    mapY: 28,
    area: "San Mateo, CA",
    addressLine: "1200 Howard Ave",
    lat: 37.563,
    access: { entrance: "step_free", floor: "ground_floor", doorwayInches: 36, restroom: "accessible" },
    lng: -122.3255,
    distanceLabel: "0.8 mi",
    availability: everyDay(7, 21),
  },
  {
    name: "The Annex",
    roomSetup: "private_room",
    suitableFor: ["consultation-room"],
    category: "social",
    hourlyRateCents: 2200,
    capacity: 3,
    description:
      "Two armchairs, a low table, and real privacy. A neutral, calm room for 1:1 coaching.",
    amenities: ["soundproofed", "climate_control", "natural_light", "seating", "waiting_area"],
    requirements: ["quiet_building"],
    houseRules: "",
    accessible: false,
    restroom: "Shared",
    bufferMinutes: 0,
    mapX: 64,
    mapY: 20,
    area: "San Mateo, CA",
    addressLine: "801 Laurel St",
    lat: 37.5545,
    access: { entrance: "one_step", floor: "lift", doorwayInches: 30, restroom: "standard" },
    lng: -122.312,
    distanceLabel: "1.0 mi",
    availability: everyDay(9, 19),
  },
  {
    name: "Still Room",
    roomSetup: "private_room",
    suitableFor: ["meditation-room", "reiki-room"],
    category: "spirit",
    hourlyRateCents: 2600,
    capacity: 6,
    description:
      "Soundproofed, cushioned, and candle-lit on request. Hosts meditation, breathwork, and reiki.",
    amenities: ["soundproofed", "climate_control", "storage", "cushions", "props"],
    requirements: ["indoor_shoes", "no_open_flame", "quiet_building"],
    houseRules: "Cushions and bolsters live in the cupboard by the door. Please stack them back the way you found them.",
    accessible: true,
    restroom: "Private",
    bufferMinutes: 15,
    mapX: 72,
    mapY: 52,
    area: "San Mateo, CA",
    addressLine: "2300 Broadway",
    lat: 37.548,
    access: { entrance: "step_free", floor: "lift", doorwayInches: 34, restroom: "standard" },
    lng: -122.339,
    distanceLabel: "1.2 mi",
    availability: everyDay(6, 22),
  },
  {
    name: "Sage House",
    roomSetup: "private_room",
    suitableFor: ["massage-room", "treatment-room", "acupuncture-room"],
    category: "traditional",
    hourlyRateCents: 3500,
    capacity: 2,
    description: "Heated table, linen service, herb storage, and its own entrance.",
    amenities: ["sink", "climate_control", "private_entrance", "treatment_table", "linens", "changing_area"],
    requirements: ["own_linens", "no_scents", "wipe_down"],
    houseRules: "",
    accessible: false,
    restroom: "Private",
    bufferMinutes: 30,
    mapX: 46,
    mapY: 64,
    area: "San Mateo, CA",
    addressLine: "55 E 4th Ave",
    lat: 37.5702,
    access: { entrance: "steps", floor: "stairs_only", doorwayInches: null, restroom: "none" },
    lng: -122.3011,
    distanceLabel: "1.5 mi",
    availability: everyDay(8, 18),
  },
  {
    name: "Meridian",
    roomSetup: "whole_studio",
    suitableFor: ["yoga-studio", "movement-studio"],
    category: "physical",
    hourlyRateCents: 3000,
    capacity: 8,
    description:
      "Sprung floor, wall of mirrors, and a sound system that fills the room without shouting.",
    amenities: ["mirrors", "sound_system", "storage", "mats", "props"],
    requirements: ["grip_socks", "no_outside_equipment", "take_rubbish"],
    houseRules: "",
    accessible: true,
    restroom: "Shared",
    bufferMinutes: 30,
    mapX: 22,
    mapY: 56,
    area: "San Mateo, CA",
    addressLine: "410 Industrial Rd",
    lat: 37.5391,
    access: { entrance: null, floor: null, doorwayInches: null, restroom: null },
    lng: -122.3204,
    distanceLabel: "1.6 mi",
    availability: everyDay(6, 21),
  },
  {
    name: "Hearth",
    roomSetup: "private_room",
    suitableFor: ["meditation-room"],
    category: "spirit",
    hourlyRateCents: 2400,
    capacity: 4,
    description:
      "West-facing room that turns amber at sunset. Cushions and props included, silence guaranteed.",
    amenities: ["Natural light", "Storage"],
    requirements: ["own_mat", "no_amplified_music", "stairs_only"],
    houseRules: "Third floor, and the lift has been out since spring.",
    accessible: false,
    restroom: "None",
    bufferMinutes: 15,
    mapX: 56,
    mapY: 80,
    area: "San Mateo, CA",
    addressLine: "900 Veterans Blvd",
    lat: 37.5588,
    access: { entrance: "step_free", floor: "ground_floor", doorwayInches: null, restroom: "standard" },
    lng: -122.2938,
    distanceLabel: "2.1 mi",
    availability: everyDay(10, 20),
  },
];

/** Private fields for the seeded spaces, kept apart from the public projection. */
const SEED_PRIVATE: Record<string, SpaceAccessDetails> = {};

export class MockRepository implements Repository {
  private profile: Profile = {
    id: ME,
    displayName: null,
    avatarUrl: null,
    email: null,
    isPro: false,
    insuranceDocName: null,
    insuranceReview: { state: "pending", reviewedAt: null },
    insuranceEffectiveDate: null,
    insuranceExpiresAt: null,
    insuranceInsurer: null,
    insurancePolicyNumber: null,
    insuranceReviewNote: null,
    payoutSchedule: "standard",
    payoutSetup: "not_started",
    notifyBookings: true,
    notifyPayouts: true,
    notifyOffers: false,
    emergencyContact: { name: null, phone: null, relationship: null },
    accountType: null,
    identityVerifiedAt: null,
    profession: null,
    credentialDocName: null,
    credentialType: null,
    credentialNumber: null,
    credentialJurisdiction: null,
    credentialReview: { state: null, reviewedAt: null },
    credentialReviewNote: null,
    searchPostcode: null,
    termsVersion: null,
    termsAcceptedAt: null,
    hostTermsVersion: null,
    hostTermsAcceptedAt: null,
    milestonesSeen: [],
    foundingHostAt: null,
    foundingNumber: null,
  };

  private publicSpaces: PublicSpace[] = [];
  private mySpaces: HostSpace[] = [];
  private bookings: Booking[] = [];

  /*
   * Written as bookings are made, so the fake behaves like the real one: a
   * history that only ever appears empty would hide every fault in the screen
   * that reads it.
   */
  private notifications: NotificationEntry[] = [];
  private hostBookings: HostBooking[] = [];

  constructor() {
    this.publicSpaces = SEED_SPACES.map((seed, index) => {
      const spaceId = `seed_${index}`;
      SEED_PRIVATE[spaceId] = {
        addressLine: `${10 + index * 7} Alder Lane`,
        entryInstructions:
          "Keypad is on the right-hand door frame. Press # after the code.",
        accessType: "keypad",
        // Spread around the peninsula so the post-booking map has somewhere
        // real to centre on rather than the middle of the Atlantic, which is
        // what a default of zero looks like.
        lat: 37.5485 + index * 0.011,
        lng: -122.3122 - index * 0.014,
      };
      return {
        id: spaceId,
        hostId: `host_${index}`,
        name: seed.name,
        category: seed.category,
        hourlyRateCents: seed.hourlyRateCents,
        capacity: seed.capacity,
        accessType: "keypad",
        accessible: seed.accessible,
        restroom: seed.restroom,
        bufferMinutes: seed.bufferMinutes,
        // Matches the peninsula coordinates above; seed data with a zone from
        // somewhere else would make every demo slot an hour it is not.
        timeZone: FALLBACK_ZONE,
        parking: { options: ["street", "free"], limitMinutes: 120 },
        floorAreaSqft: 480,
        amenities: seed.amenities,
        requirements: seed.requirements,
        houseRules: seed.houseRules,
        description: seed.description,
        media: [],
        availability: seed.availability,
        mapX: seed.mapX,
        mapY: seed.mapY,
        area: seed.area,
        // Every seed room is in the same town; the real repository reads
        // these from columns the geocoder filled — see 0043.
        city: "San Mateo",
        state: "CA",
        suitableFor: seed.suitableFor,
        allowedUses: [],
        bookingMode: "instant" as const,
        roomSetup: seed.roomSetup,
        // The coarse point only, matching spaces_public. The exact address and
        // lat/lng live in SEED_PRIVATE and come back through the access flow.
        approxLat: seed.lat,
        approxLng: seed.lng,
        access: seed.access,
        distanceLabel: seed.distanceLabel,
      reviewCount: 0,
      averageRating: null,
      // A little seeded texture: the first two seed hosts founded, and a
      // couple carry a session milestone, so the practitioner-facing badges
      // have something to draw in the demo.
      hostFoundingHost: index < 2,
      hostSessionMilestone: index === 0 ? 100 : index === 1 ? 10 : 0,
      };
    });
  }

  /* ---------------- profile ---------------- */

  async getProfile(): Promise<Profile> {
    return { ...this.profile };
  }

  async updateProfile(patch: Partial<Profile>): Promise<Profile> {
    this.profile = { ...this.profile, ...patch, id: ME };
    /*
     * The database stamps the moment when a version is accepted; the mock does
     * the same so the demo shows an accepted date and hasAcceptedHostTerms sees
     * a consistent record, the way a real profile read would.
     */
    if (patch.hostTermsVersion != null && this.profile.hostTermsAcceptedAt === null) {
      this.profile = { ...this.profile, hostTermsAcceptedAt: new Date() };
    }
    return { ...this.profile };
  }

  async uploadAvatar(file: File): Promise<Profile> {
    const reason = rejectionReason(file, "image");
    if (reason) throw new Error(reason);

    // No bucket here, so the name stands in for the stored object. What
    // matters for the fake is that it survives the call, which a blob does not.
    this.profile = { ...this.profile, avatarUrl: `mock://avatars/${file.name}` };
    return { ...this.profile };
  }

  async uploadInsuranceCertificate(file: File): Promise<Profile> {
    const reason = rejectionReason(file, "document");
    if (reason) throw new Error(reason);

    // No bucket here, so the name stands in for the stored file. A new
    // certificate returns to pending review, exactly as the real repository
    // resets it — the state the onboarding screen and admin queue read.
    this.profile = {
      ...this.profile,
      insuranceDocName: file.name,
      insuranceReview: { state: "pending", reviewedAt: null },
      insuranceReviewNote: null,
    };
    return { ...this.profile };
  }

  async uploadCredentialCertificate(
    file: File,
    details: {
      credentialType: string | null;
      credentialNumber: string | null;
      credentialJurisdiction: string | null;
    },
  ): Promise<Profile> {
    const reason = rejectionReason(file, "document");
    if (reason) throw new Error(reason);

    // Mirrors the real repository: a new document returns review to pending and
    // records what the practitioner typed. Only staff move it past pending.
    this.profile = {
      ...this.profile,
      credentialDocName: file.name,
      credentialType: details.credentialType,
      credentialNumber: details.credentialNumber,
      credentialJurisdiction: details.credentialJurisdiction,
      credentialReview: { state: "pending", reviewedAt: null },
      credentialReviewNote: null,
    };
    return { ...this.profile };
  }

  async startProSubscription(): Promise<Profile> {
    this.profile = { ...this.profile, isPro: true };
    return { ...this.profile };
  }

  /**
   * Stands in for Stripe Identity. The demo has no hosted flow to send anyone
   * to, so it simply marks them verified — the state the real webhook would
   * write after Stripe confirmed a document and a selfie.
   */
  async startIdentityVerification(): Promise<Profile> {
    this.profile = { ...this.profile, identityVerifiedAt: new Date() };
    return { ...this.profile };
  }

  /**
   * Stands in for Stripe Express onboarding.
   *
   * The real route creates an Express account and hands the host to Stripe's
   * hosted form; this flag is then set only by the `account.updated` webhook,
   * once Stripe reports both charges and payouts genuinely enabled. Someone
   * who abandons the form halfway must not come back looking connected, or
   * their listing takes bookings for money that can never reach them.
   */
  async connectPayouts(): Promise<Profile> {
    this.profile = { ...this.profile, payoutSetup: "ready" };
    return { ...this.profile };
  }

  async openPayoutDashboard(): Promise<void> {
    // There is no Stripe here to open, and no window to send anywhere.
  }

  async signOut(): Promise<void> {
    // Nothing is persisted here, so there is no token to discard. The real
    // implementation calls supabase.auth.signOut().
  }

  /* ---------------- discovery ---------------- */

  async listPublicSpaces(): Promise<PublicSpace[]> {
    // Active listings only, matching spaces_public. A host's own pending
    // space must not appear here just because they created it.
    const mineActive = this.mySpaces.filter((s) => s.status === "active");
    return [...this.publicSpaces, ...mineActive];
  }

  async getPublicSpace(spaceId: string): Promise<PublicSpace | null> {
    const all = await this.listPublicSpaces();
    return all.find((s) => s.id === spaceId) ?? null;
  }

  async getSpaceAccessDetails(spaceId: string): Promise<SpaceAccessDetails | null> {
    // The authorization check the security definer function performs: only a
    // practitioner holding a live booking on this space may see the address.
    const entitled = this.bookings.some(
      (b) =>
        b.spaceId === spaceId &&
        b.practitionerId === ME &&
        (b.status === "upcoming" || b.status === "completed"),
    );
    if (!entitled) return null;

    const mine = this.mySpaces.find((s) => s.id === spaceId);
    if (mine) {
      return {
        addressLine: mine.addressLine,
        entryInstructions: mine.entryInstructions,
        accessType: mine.accessType,
        lat: mine.lat,
        lng: mine.lng,
      };
    }
    return SEED_PRIVATE[spaceId] ?? null;
  }

  /* ---------------- bookings ---------------- */

  async listMyBookings(): Promise<Booking[]> {
    return this.bookings
      .map((b) => this.withRevealedCode(b))
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  }

  /**
   * The access code exists from the moment of booking but is withheld until
   * its reveal time — the same shape as the real system, where a scheduled job
   * flips the flag and the API stops filtering the value out.
   */
  private withRevealedCode(booking: Booking): Booking {
    const revealed = Date.now() >= booking.accessCodeRevealedAt.getTime();
    return { ...booking, revealedAccessCode: revealed ? booking.revealedAccessCode : null };
  }

  async createBooking({ spaceId, startsAt }: CreateBookingInput): Promise<CreatedBooking> {
    const space = await this.getPublicSpace(spaceId);
    if (!space) throw new Error(`no such space: ${spaceId}`);

    const now = new Date();
    const isInstant = isInstantSlot(startsAt, now);

    const priced = quote({
      hostRateCents: space.hourlyRateCents,
      isInstant,
      isPro: this.profile.isPro,
    });
    const money: BookingMoneyRecord = bookingMoneyFromQuote(priced);

    const endsAt = new Date(startsAt.getTime() + SESSION_MINUTES * 60 * 1000);
    const booking: Booking = {
      id: id("bk"),
      spaceId,
      spaceName: space.name,
      roomType: roomTypeFor(space.category),
      category: space.category,
      practitionerId: ME,
      startsAt,
      endsAt,
      timeZone: space.timeZone,
      status: "upcoming",
      /*
       * The demo never waits on anybody. The mock has no second person in it
       * to press approve, so a request made here would sit pending forever and
       * the only thing it would demonstrate is a dead end.
       */
      approvalState: "not_required",
      isInstant,
      wasPro: this.profile.isPro,
      revealedAccessCode: generateAccessCode(),
      accessCodeRevealedAt: new Date(startsAt.getTime() - ACCESS_CODE_LEAD_MS),
      ...money,
    };

    this.bookings.unshift(booking);

    /*
     * The same two messages the real app sends on a booking. One delivered and
     * one still queued, so the screen that reads this is exercised in more
     * than its happy state.
     */
    this.notifications.unshift(
      {
        id: id("notif"),
        kind: "booking_confirmed",
        channel: "email",
        state: "sent",
        sentAt: new Date(),
        createdAt: new Date(),
        bookingId: booking.id,
      },
      {
        id: id("notif"),
        kind: "access_code_ready",
        channel: "email",
        state: "queued",
        sentAt: null,
        createdAt: new Date(),
        bookingId: booking.id,
      },
    );
    // No card, so nothing to confirm — the caller goes straight to the
    // confirmation screen and the payment step never appears.
    return { booking: this.withRevealedCode(booking), clientSecret: null };
  }

  async cancelBooking(bookingId: string, actor: "practitioner" | "host"): Promise<Booking> {
    const booking = this.bookings.find((b) => b.id === bookingId);
    if (!booking) throw new Error(`no such booking: ${bookingId}`);

    // Resolved for its side effects on the real path — the hold is voided or
    // captured there. Here there is no card, so the outcome is only the reason
    // the status changes.
    resolveCancellation(booking, actor, booking.startsAt, new Date(), booking.wasPro);

    booking.status = actor === "host" ? "cancelled_by_host" : "cancelled_by_practitioner";
    return this.withRevealedCode(booking);
  }

  /**
   * Accepted and discarded.
   *
   * The mock exists so every screen can be walked without an account, and the
   * review form is part of that walk. Storing one would mean also modelling
   * the blind period and the escalation queue, which are the rules the real
   * path exists to enforce — a second, quietly different copy of them here is
   * how the two drift.
   */
  async submitReview(): Promise<void> {}

  /* ---------------- messages ---------------- */

  private messages: Message[] = [];

  async listMessages(bookingId: string): Promise<Message[]> {
    return this.messages.filter((m) => m.bookingId === bookingId);
  }

  /**
   * Masks in memory using the same function the route uses.
   *
   * Sharing the function rather than approximating it is the point: a mock
   * that let a phone number through would show a working feature that is not,
   * and the screen being reviewed would be the wrong one.
   */
  async listNotifications(): Promise<NotificationEntry[]> {
    return this.notifications.map((entry) => ({ ...entry }));
  }

  async sendMessage(bookingId: string, body: string): Promise<{ notice: string | null }> {
    const redaction = redact(body);

    this.messages.push({
      id: id("msg"),
      bookingId,
      senderId: ME,
      body: redaction.text,
      createdAt: new Date(),
      redactedKinds: redaction.found,
    });

    return { notice: explainRedaction(redaction.found) };
  }

  // The mock has no second participant, so every message is the demo user's own
  // and nothing is ever unread. Enough for the screen to render its empty state.
  async markMessagesRead(): Promise<number> {
    return 0;
  }

  async unreadMessageCounts(): Promise<Record<string, number>> {
    return {};
  }

  async reportBooking(): Promise<void> {
    // The mock has no staff queue; recording nothing is enough for local flows.
  }

  async blockBookingParty(): Promise<void> {
    // No message channel to sever in the mock.
  }

  /* ---------------- standing ---------------- */

  async getSessionCount(): Promise<number> {
    return this.bookings.filter((b) => b.status === "completed").length;
  }

  async requestSpace(): Promise<void> {
    // The demo has no backend; a space request simply succeeds so the empty
    // state's flow can be seen end to end.
    return;
  }

  async foundingHostsRemaining(): Promise<number> {
    // The demo has no other hosts going live, so the fifty stand almost whole.
    // The two seed founders above are other accounts, not this one, so this is
    // a plausible number rather than a manufactured countdown.
    return FOUNDING_HOST_LIMIT - 2;
  }

  /* ---------------- referrals ---------------- */

  async myReferralCode(): Promise<string> {
    // Stable for the session, opaque, and not the user id — the same shape the
    // real code has, so the share UI has something real to render.
    return "MS7F2K9Q";
  }

  async listReferrals(): Promise<ReferralSummary[]> {
    // A little seeded texture across the three statuses so the dashboard area
    // shows each state. No referred-host identity here, the same as the server.
    const day = 24 * 60 * 60 * 1000;
    // Only the qualified referral carries a reward — earned, not paid, since no
    // payout runs. The others show $0 / no reward, the same as the server.
    return [
      {
        id: "ref_demo_1",
        status: "qualified",
        joinedAt: new Date(Date.now() - 40 * day),
        rewardCents: 2500,
        rewardState: "earned",
      },
      {
        id: "ref_demo_2",
        status: "space_live",
        joinedAt: new Date(Date.now() - 12 * day),
        rewardCents: 0,
        rewardState: null,
      },
      {
        id: "ref_demo_3",
        status: "joined",
        joinedAt: new Date(Date.now() - 3 * day),
        rewardCents: 0,
        rewardState: null,
      },
    ];
  }

  async attributeReferral(_code: string): Promise<void> {
    // Nothing to attribute in a single-account demo; the real repo locks the
    // relationship server-side.
  }

  /* ---------------- credit ---------------- */

  async listCancellationHistory(): Promise<CancellationEvent[]> {
    // Built through the same toCancellationEvents rule the real repo uses. The
    // mock has no reaper and no abandoned checkouts, so every cancellation here
    // is a genuine one — and no captured_at/cancelled_at columns, so a non-null
    // stand-in for each keeps them counting through the shared predicate rather
    // than a second, divergent filter.
    return toCancellationEvents(
      this.bookings
        .filter(
          (b) => b.status === "cancelled_by_host" || b.status === "cancelled_by_practitioner",
        )
        .map((b) => ({
          cancelledBy: b.status === "cancelled_by_host" ? "host" : "practitioner",
          capturedAt: b.startsAt,
          cancelledAt: new Date(),
          sessionStart: b.startsAt,
        })),
    );
  }

  /* ---------------- hosting ---------------- */

  async listMySpaces(): Promise<HostSpace[]> {
    return this.mySpaces.map((s) => ({ ...s }));
  }

  async editSpace(spaceId: string, edit: SpaceEdit): Promise<HostSpace> {
    const space = this.mySpaces.find((s) => s.id === spaceId);
    if (!space) throw new Error("No such space");

    /*
     * Coordinates count as a move, the same as the address text does. The
     * trigger in 0019 compares lat and lng too, so a mock that only watched
     * the string would let a nudged pin through here and be refused against
     * the real database.
     */
    const moved =
      (edit.addressLine !== undefined && edit.addressLine !== space.addressLine) ||
      (edit.category !== undefined && edit.category !== space.category) ||
      (edit.lat !== undefined && edit.lat !== space.lat) ||
      (edit.lng !== undefined && edit.lng !== space.lng);

    /*
     * The same refusal the trigger in 0019 raises, in the same words.
     * Somebody has arranged their day around a room at that address, and
     * moving it underneath them is the harm the cancellation policy exists to
     * prevent, done quietly instead of with a notification.
     */
    if (moved) {
      const booked = this.hostBookings.filter(
        (b) => b.spaceId === spaceId && b.status === "upcoming" && b.startsAt > new Date(),
      ).length;

      if (booked > 0) {
        throw new Error(
          `This space has ${booked} upcoming ${booked === 1 ? "session" : "sessions"}. ` +
            "Its address and room type cannot change until those sessions are done or cancelled.",
        );
      }
    }

    Object.assign(space, edit);

    // Filtered the same way the real repository filters it, so a use that has
    // since been renamed is dropped here too rather than only failing against
    // the check constraint in 0043.
    if (edit.suitableFor !== undefined) space.suitableFor = knownSpaceTypes(edit.suitableFor);

    // What was verified is no longer what is listed.
    if (moved) {
      space.status = "pending";
      space.subleaseReview = { state: "pending", reviewedAt: null };
      space.reviewNote = null;
    }

    return { ...space };
  }

  async addSpaceMedia(
    spaceId: string,
    files: { file: File; kind: MediaKind }[],
  ): Promise<HostSpace> {
    const space = this.mySpaces.find((s) => s.id === spaceId);
    if (!space) throw new Error("No such space");

    for (const item of files) {
      const reason = rejectionReason(item.file, item.kind === "video" ? "video" : "image");
      if (reason) throw new Error(reason);
    }

    space.media = [
      ...space.media,
      ...files.map((item) => ({
        id: id("media"),
        url: `mock://space-media/${item.file.name}`,
        cardUrl: `mock://space-media/${item.file.name}`,
        kind: item.kind,
      })),
    ];
    return { ...space };
  }

  async removeSpaceMedia(spaceId: string, mediaId: string): Promise<HostSpace> {
    const space = this.mySpaces.find((s) => s.id === spaceId);
    if (!space) throw new Error("No such space");

    space.media = space.media.filter((m) => m.id !== mediaId);
    return { ...space };
  }

  async setSpaceListed(spaceId: string, listed: boolean): Promise<HostSpace> {
    const space = this.mySpaces.find((s) => s.id === spaceId);
    if (!space) throw new Error("No such space");

    space.status = listed ? "pending" : "delisted";
    return { ...space };
  }

  /**
   * A handful of written reviews, so the panel can be seen working.
   *
   * Deterministic per space rather than random: a demo whose reviews change on
   * every render is a demo nobody trusts.
   */
  async listSpaceReviews(spaceId: string): Promise<PublicReview[]> {
    const seed = spaceId.split("").reduce((n, c) => n + c.charCodeAt(0), 0);
    const written = [
      { overall: 5, comment: "Quiet, clean, and the floor is properly sprung. Easy in and out." },
      { overall: 4, comment: "Good light in the afternoon. Street parking filled up by six." },
      { overall: 5, comment: "Exactly as described. The host answered a question in minutes." },
      { overall: 4, comment: null },
    ];

    return written.slice(0, 2 + (seed % 3)).map((r, i) => ({
      id: `rev_${spaceId}_${i}`,
      overall: r.overall,
      comment: r.comment,
      role: "practitioner" as const,
      createdAt: new Date(Date.now() - (i + 1) * 9 * 24 * 60 * 60 * 1000),
    }));
  }

  /**
   * Nothing waiting, and that is the honest demo.
   *
   * A mock that invents a dispute would show every new account an argument
   * about a session that never happened. The screen's empty state is the state
   * almost everybody is in, and it is worth seeing working.
   */
  async listOpenDisputes(): Promise<OpenDispute[]> {
    return [];
  }

  async createSpace(input: NewSpaceInput): Promise<HostSpace> {
    const space: HostSpace = {
      id: id("sp"),
      hostId: ME,
      name: input.name,
      category: input.category,
      hourlyRateCents: input.hourlyRateCents,
      capacity: input.capacity,
      accessType: input.accessType,
      access: input.access,
      restroom: input.restroom,
      timeZone: input.timeZone,
      parking: input.parking,
      floorAreaSqft: input.floorAreaSqft,
      bufferMinutes: input.bufferMinutes,
      amenities: input.amenities,
      requirements: input.requirements,
      houseRules: input.houseRules,
      description: input.description,
      // The mock has no storage, so a preview URL is the only thing it can
      // show — and it is enough, because the tab that made it is the tab that
      // reads it. Callers release these with releasePickedMedia.
      media: input.media.map((m) => {
        const url = URL.createObjectURL(m.file);
        return { id: id("md"), url, cardUrl: url, kind: m.kind };
      }),
      availability: normalize(input.availability),
      mapX: input.mapX,
      mapY: input.mapY,
      area: null,
      // Kept, so the mock drops nothing the form collects. A field the real
      // repository stores and this one silently discards is a bug that can
      // only ever be found in production.
      city: input.city,
      state: input.state,
      suitableFor: knownSpaceTypes(input.suitableFor),
      allowedUses: knownUses(input.allowedUses ?? []),
      bookingMode: input.bookingMode ?? "request",
      roomSetup: input.roomSetup,
      // The old boolean, still on the type and still written by nothing. See
      // the note on NewSpaceInput.access.
      accessible: null,
      distanceLabel: "your space",
      reviewCount: 0,
      averageRating: null,
      // A host does not browse their own listing on the public map; the coarse
      // point is the public view's field and is left null here.
      approxLat: null,
      approxLng: null,
      // New listings are never live: the brief defers review to a manual
      // process, so nothing reaches Discover until it is approved.
      status: "pending",
      addressLine: input.addressLine,
      lat: input.lat,
      lng: input.lng,
      entryInstructions: input.entryInstructions,
      subleaseDocName: input.subleaseDoc.name,
      insuranceDocName: input.insuranceDoc?.name ?? null,
      // Nobody has looked at either file yet, and saying so is the point.
      subleaseReview: { state: "pending", reviewedAt: null },
      insuranceReview: { state: "pending", reviewedAt: null },
      reviewNote: null,
      // A host's own listing carries no host badge for themselves in the demo.
      hostFoundingHost: false,
      hostSessionMilestone: 0,
    };

    this.mySpaces.push(space);
    return { ...space };
  }

  async updateSpaceAvailability(
    spaceId: string,
    blocks: AvailabilityBlock[],
  ): Promise<HostSpace> {
    const space = this.mySpaces.find((s) => s.id === spaceId);
    if (!space) throw new Error(`no such space: ${spaceId}`);
    space.availability = normalize(blocks);
    return { ...space };
  }

  async listHostBookings(): Promise<HostBooking[]> {
    return [...this.hostBookings].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  /**
   * Always empty, and that is the honest answer here.
   *
   * A request needs somebody on the other side of it. The mock is one person
   * looking at their own data, so seeding a pending request would mean seeding
   * a practitioner who does not exist, waiting on an answer that changes
   * nothing. The queue's empty state is what a new host sees anyway.
   */
  async listBookingRequests(): Promise<BookingRequest[]> {
    return [];
  }

  async answerBookingRequest(): Promise<void> {
    throw new Error("There is nothing to answer in the demo.");
  }

  /**
   * Stands in for the manual review the brief defers to a later phase.
   *
   * Approval only flips the status. It deliberately invents no earnings and no
   * bookings: the prototype's version conjured a month's revenue and a
   * practitioner named Elena out of nothing the instant a listing went live.
   */
  async approveSpace(spaceId: string): Promise<HostSpace> {
    const space = this.mySpaces.find((s) => s.id === spaceId);
    if (!space) throw new Error(`no such space: ${spaceId}`);
    space.status = "active";
    return { ...space };
  }

  /**
   * Prototype-only, and labelled as such wherever it is offered: puts a real
   * booking on one of the host's own open hours so the dashboard and Earnings
   * screens can be reviewed with something in them. It goes through the same
   * pricing path as a practitioner booking, so the host's net is their rate to
   * the cent — not a number chosen to look plausible.
   */
  async simulateInboundBooking(spaceId: string): Promise<HostBooking | null> {
    const space = this.mySpaces.find((s) => s.id === spaceId);
    if (!space || space.status !== "active") return null;

    const startsAt = this.nextOpenSlot(space);
    if (!startsAt) return null;

    const booking: HostBooking = {
      id: id("hb"),
      spaceId,
      practitionerName: "Elena R.",
      practitionerCraft: "Pilates instructor",
      startsAt,
      endsAt: new Date(startsAt.getTime() + SESSION_MINUTES * 60 * 1000),
      status: "upcoming",
      netCents: space.hourlyRateCents,
      // Nothing is settled before the session has happened.
      hostPaidAt: null,
      // A verified, established practitioner, so the dashboard shows the trust
      // summary with something in it.
      identityVerified: true,
      insuranceVerified: true,
      credentialReviewed: true,
      completedSessions: 12,
      goodStanding: true,
    };

    this.hostBookings.push(booking);
    return booking;
  }

  /** The soonest slot the host has actually opened, within the next week. */
  private nextOpenSlot(space: HostSpace): Date | null {
    const now = new Date();
    const today = civilIn(now, space.timeZone);
    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const day = addDays(today, dayOffset);
      const taken = new Set(
        this.hostBookings
          .filter((b) => b.spaceId === space.id)
          .map((b) => b.startsAt.getTime()),
      );
      for (const slot of slotStartsForDate(
        space.availability,
        day,
        space.timeZone,
        space.bufferMinutes,
      )) {
        if (slot.getTime() > now.getTime() && !taken.has(slot.getTime())) return slot;
      }
    }
    return null;
  }
}
