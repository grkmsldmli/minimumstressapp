import type { SupabaseClient } from "@supabase/supabase-js";

import { type Party, THRESHOLDS } from "@/lib/reliability";

/**
 * Everything a person needs to run this, in one read.
 *
 * Two halves, and the order between them is deliberate. First what is waiting
 * for a decision, ranked by who is hurt while nobody looks — a safety report,
 * then a host who cannot list, then a request. Only after that, the numbers.
 * A dashboard that opens on revenue is a dashboard where the unread report
 * stays unread.
 *
 * Read with the service role, which is the only way to see a pending listing's
 * documents or a booking's full money at all. That is also why the route in
 * front of this checks the allowlist first.
 */

export interface PendingListing {
  id: string;
  name: string;
  category: string;
  hourlyRateCents: number;
  addressLine: string | null;
  hostEmail: string | null;
  subleaseDocPath: string | null;
  insuranceDocPath: string | null;
  createdAt: string;
}

export interface OpenEscalation {
  id: string;
  priority: "safety" | "urgent" | "review";
  createdAt: string;
  overall: number;
  comment: string;
  safetyConcern: boolean;
  role: string;
  spaceName: string | null;
}

export interface AccountChangeRequest {
  id: string;
  email: string | null;
  from: string;
  to: string;
  reason: string;
  createdAt: string;
}

/** A host earning money that cannot reach them. */
export interface UnpayableHost {
  id: string;
  email: string | null;
  listings: number;
  /** Sessions already completed with nowhere to send the money. */
  owedSessions: number;
  owedCents: number;
}

export interface DayCount {
  /** ISO date, for the axis. */
  day: string;
  bookings: number;
}

/**
 * A message that never reached anybody.
 *
 * The one failure in this app that looks exactly like success from every side:
 * the booking is real, the row is written, and only the person waiting for a
 * door code knows something is wrong. Nobody was reading the outbox.
 */
export interface FailedNotification {
  id: string;
  kind: string;
  channel: string;
  attempts: number;
  lastError: string | null;
  givenUp: boolean;
  createdAt: string;
}

/** Someone approaching the point where new bookings stop. */
export interface AtRiskAccount {
  id: string;
  email: string | null;
  role: string;
  lateCancellations: number;
  suspended: boolean;
}

/** Anything that happened, whatever kind of thing it was. */
export interface ActivityEntry {
  id: string;
  at: string;
  kind: "signup" | "listing" | "booking" | "cancellation" | "review" | "message";
  text: string;
}

/** One account, with everything an operator would ask about them. */
export interface Person {
  id: string;
  email: string | null;
  accountType: string | null;
  displayName: string | null;
  joinedAt: string | null;
  listings: number;
  sessions: number;
  lateCancellations: number;
  /** Hosts only. Null for a practitioner, who has nothing to be paid into. */
  payoutsReady: boolean | null;
  earnedCents: number;
  spentCents: number;
  /**
   * Who to call if a session goes wrong while it is happening.
   *
   * Staff are the only people allowed to read this and the only people who
   * would ever need to — the counterpart in a booking never sees it, in either
   * direction. Collecting it and then having no way to reach it made the whole
   * field decorative: the one moment it exists for is the one moment nobody
   * could open a database console.
   *
   * Null throughout means the account never filled it in, which is worth
   * seeing on its own. That is the fact somebody discovers at the worst
   * possible time, and it should be visible long before then.
   */
  emergency: { name: string | null; phone: string | null; relationship: string | null };
}

/** Every listing, not only the ones waiting for review. */
export interface ListingRow {
  id: string;
  name: string;
  status: string;
  category: string;
  hourlyRateCents: number;
  hostEmail: string | null;
  addressLine: string | null;
  sessions: number;
  earnedCents: number;
  createdAt: string | null;
}

/**
 * A listing whose paperwork was rejected, or that came back for review.
 *
 * A brand-new listing and one that was live until its host moved it are the
 * same status and not the same job: the second was approved once, has a
 * history, and may have somebody's booking behind it.
 */
export interface ReviewReason {
  id: string;
  name: string;
  hostEmail: string | null;
  /** New, or previously live and sent back by an edit. */
  returning: boolean;
  subleaseState: string;
  insuranceState: string;
  /** Staff's own words on a rejection. */
  note: string | null;
  since: string;
}

/**
 * Why a listing is not getting booked, when nothing is wrong with it.
 *
 * Not a score. Each line is a specific thing missing that a practitioner would
 * have wanted, so an operator can say what to fix rather than that engagement
 * is low.
 */
export interface ListingGap {
  id: string;
  name: string;
  hostEmail: string | null;
  missing: string[];
}

/** Where people stop, on the way from signing up to a session happening. */
export interface FunnelStep {
  label: string;
  count: number;
}

export interface DayMoney {
  day: string;
  platformCents: number;
  grossCents: number;
}

export interface RecentBooking {
  id: string;
  spaceName: string;
  startsAt: string;
  status: string;
  totalCents: number;
  hostRateCents: number;
}

/**
 * A session in the window where somebody is actually in a room.
 *
 * Everything else on this page is a record of what happened. This is the one
 * part that is happening — and the only moment an emergency contact is worth
 * having collected. Both sides are carried, because an incident can start from
 * either: a practitioner alone in a stranger's building, and a host who let a
 * stranger into theirs, have the same need.
 *
 * The address is here for the same reason and no other. It is withheld from
 * practitioners until the 24-hour line and never shown to anyone else, but the
 * one call where it matters is the one where somebody has to say where to go.
 */
export interface LiveSession {
  bookingId: string;
  spaceName: string;
  addressLine: string | null;
  startsAt: string;
  endsAt: string;
  /** "now", or how long until it starts. */
  state: "in progress" | "starting soon" | "just finished";
  practitioner: SessionParty;
  host: SessionParty;
}

export interface SessionParty {
  id: string;
  name: string | null;
  email: string | null;
  emergency: { name: string | null; phone: string | null; relationship: string | null };
}

/**
 * Whether a booking is close enough to now to be worth a phone number, and
 * which side of the hour it is on.
 *
 * The window reaches a little either side of the session itself. Two hours
 * ahead, because somebody travelling to a room they cannot get into is already
 * a problem and calling once the hour has started is late. Two hours behind,
 * because an incident is usually reported after the person is out of the
 * building rather than while they are in it.
 *
 * Cancellations return null. Nobody is in that room, and a list that suggests
 * otherwise is worse than no list — it would send somebody looking for a
 * person who never came.
 *
 * Pure, and exported for that reason: a window whose edges are only exercised
 * against live data is a window whose edges are never exercised.
 */
export const LIVE_LEAD_MS = 2 * 60 * 60 * 1000;
export const LIVE_TRAIL_MS = 2 * 60 * 60 * 1000;

export function sessionState(
  status: string,
  startsAt: Date,
  endsAt: Date,
  now: Date,
): LiveSession["state"] | null {
  if (status !== "upcoming" && status !== "completed") return null;

  if (startsAt.getTime() - now.getTime() > LIVE_LEAD_MS) return null;
  if (now.getTime() - endsAt.getTime() > LIVE_TRAIL_MS) return null;

  if (now < startsAt) return "starting soon";
  return now < endsAt ? "in progress" : "just finished";
}

export interface AdminQueue {
  /* --- work --- */
  /** Sessions in the room right now, or within a few hours either side. */
  liveSessions: LiveSession[];
  escalations: OpenEscalation[];
  pendingListings: PendingListing[];
  accountChangeRequests: AccountChangeRequest[];
  unpayableHosts: UnpayableHost[];

  /* --- the business --- */
  money: {
    /** Our take this calendar month, after the host is paid. */
    platformCents: number;
    /** What hosts earned this month. Theirs, not ours — shown to size the market. */
    hostCents: number;
    /** Everything practitioners paid this month. */
    grossCents: number;
    /** Same three, all time. */
    platformAllTimeCents: number;
  };

  counts: {
    activeListings: number;
    pendingListings: number;
    practitioners: number;
    hosts: number;
    sessionsThisMonth: number;
    upcomingSessions: number;
    /**
     * Sessions that happened but whose host has not been paid.
     *
     * This counted uncaptured payments, which no longer exist — the money is
     * taken at booking. What can still go wrong is the other end: the sweep
     * cannot transfer to a host who has not finished onboarding, so the money
     * sits with us and somebody who let a stranger into their studio is waiting.
     */
    hostsUnpaid: number;
  };

  /** Fourteen days, oldest first, for a bar chart. */
  bookingsByDay: DayCount[];

  recent: RecentBooking[];

  failedNotifications: FailedNotification[];
  atRisk: AtRiskAccount[];
  /** Everyone, so a number on this page can always be turned into a name. */
  people: Person[];
  listings: ListingRow[];
  /** Listings needing a decision, and why each one is here. */
  reviewReasons: ReviewReason[];
  /** Live listings with something obvious missing. */
  listingGaps: ListingGap[];
  /** Signup to session, and where it thins out. */
  funnel: FunnelStep[];
  moneyByDay: DayMoney[];
  /** Accounts that have not accepted the current terms. */
  termsOutstanding: number;
  /** Everything, newest first. The feed an operator actually watches. */
  activity: ActivityEntry[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function loadQueue(admin: SupabaseClient): Promise<AdminQueue> {
  const now = new Date();

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const chartStart = new Date(now.getTime() - 13 * DAY_MS);
  chartStart.setHours(0, 0, 0, 0);

  const [listings, escalations, changes, profiles, spaces, bookings, notifications, media, availability, reviews, messages] =
    await Promise.all([
    admin
      .from("spaces")
      .select(
        "id, name, category, hourly_rate_cents, address_line, sublease_doc_path, insurance_doc_path, created_at, host_id, sublease_doc_state, insurance_doc_state, doc_review_note, updated_at",
      )
      .eq("status", "pending")
      .order("created_at"),

    admin
      .from("review_escalations")
      .select(
        "id, priority, created_at, state, reviews(overall, comment, safety_concern, role, bookings(spaces(name)))",
      )
      .neq("state", "resolved")
      .order("created_at"),

    admin
      .from("account_type_change_requests")
      .select("id, user_id, requested_type, reason, created_at, state")
      .eq("state", "open")
      .order("created_at"),

    admin
      .from("profiles")
      .select(
        "id, account_type, display_name, stripe_connect_charges_enabled, created_at, terms_version, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship",
      ),

    admin
      .from("spaces")
      .select(
        "id, host_id, name, status, created_at, category, hourly_rate_cents, address_line, description, entrance_access, restroom_access, sublease_doc_state, insurance_doc_state, doc_review_note, updated_at",
      ),

    /**
     * Every booking, rather than several filtered queries.
     *
     * The table is small at this stage and the alternative is six round trips
     * that can disagree with each other about what "this month" meant — each
     * one reads at a slightly different instant. One read, one clock.
     */
    admin
      .from("bookings")
      .select(
        "id, space_id, practitioner_id, starts_at, ends_at, status, captured_at, refunded_at, host_paid_at, cancelled_at, total_cents, host_rate_cents, platform_cents",
      )
      .order("starts_at", { ascending: false }),

    /**
     * The outbox, which nothing was reading.
     *
     * A message that failed leaves the app looking entirely healthy: the
     * booking is real, the row is written, and only the person waiting for a
     * door code knows. Both states matter — `dropped_at` is given up on, a
     * null one with attempts is still being retried and may yet arrive.
     */
    admin
      .from("notifications")
      .select("id, kind, channel, attempts, last_error, dropped_at, sent_at, created_at")
      .is("sent_at", null)
      .not("last_error", "is", null)
      .order("created_at", { ascending: false })
      .limit(20),

    admin.from("space_media").select("space_id"),

    admin.from("availability").select("space_id"),

    admin
      .from("reviews")
      .select("id, overall, role, created_at, safety_concern")
      .order("created_at", { ascending: false })
      .limit(15),

    // Count and timing only. What was said is between the two people on the
    // booking, and an operator reading it would be the whole point of the
    // masking undone from the inside.
    admin
      .from("messages")
      .select("id, created_at, booking_id")
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  const spaceName = new Map<string, string>(
    (spaces.data ?? []).map((s) => [s.id as string, s.name as string]),
  );
  const spaceHost = new Map<string, string>(
    (spaces.data ?? []).map((s) => [s.id as string, s.host_id as string]),
  );
  const spaceAddress = new Map<string, string | null>(
    (spaces.data ?? []).map((s) => [s.id as string, (s.address_line as string) ?? null]),
  );
  const profileById = new Map<string, Record<string, unknown>>(
    (profiles.data ?? []).map((row) => [row.id as string, row]),
  );

  const userIds = new Set<string>([
    ...(listings.data ?? []).map((row) => row.host_id as string),
    ...(changes.data ?? []).map((row) => row.user_id as string),
  ]);

  const rows = bookings.data ?? [];
  const paid = rows.filter((b) => b.captured_at !== null);
  const thisMonth = paid.filter((b) => new Date(b.starts_at as string) >= monthStart);

  const sum = (list: typeof rows, field: string) =>
    list.reduce((total, row) => total + ((row[field as keyof typeof row] as number) ?? 0), 0);

  /**
   * Hosts with completed sessions and no way to be paid.
   *
   * The one number on this page that is somebody else's problem becoming ours:
   * they have done the work, the practitioner has been charged, and Stripe is
   * holding money that cannot move. Nobody finds out unless somebody looks.
   */
  const payable = new Map<string, boolean>(
    (profiles.data ?? []).map((p) => [p.id as string, Boolean(p.stripe_connect_charges_enabled)]),
  );

  const unpayable = new Map<string, UnpayableHost>();
  for (const booking of paid) {
    const hostId = spaceHost.get(booking.space_id as string);
    if (!hostId || payable.get(hostId)) continue;

    const entry = unpayable.get(hostId) ?? {
      id: hostId,
      email: null,
      listings: (spaces.data ?? []).filter((s) => s.host_id === hostId).length,
      owedSessions: 0,
      owedCents: 0,
    };
    entry.owedSessions += 1;
    entry.owedCents += (booking.host_rate_cents as number) ?? 0;
    unpayable.set(hostId, entry);
    userIds.add(hostId);
  }

  /**
   * Late cancellations per person, over the window the reliability rules use.
   *
   * Surfaced before somebody is suspended rather than after: a studio two
   * cancellations from losing new bookings is somebody worth a phone call, and
   * the first anybody hears of it otherwise is the complaint.
   */
  const lateWindow = new Date(now.getTime() - 90 * DAY_MS);
  const lateCounts = new Map<string, { count: number; role: string }>();

  for (const booking of rows) {
    if (!String(booking.status).startsWith("cancelled")) continue;
    if (new Date(booking.starts_at as string) < lateWindow) continue;

    const byHost = booking.status === "cancelled_by_host";
    const who = byHost
      ? spaceHost.get(booking.space_id as string)
      : (booking.practitioner_id as string | null);
    if (!who) continue;

    const entry = lateCounts.get(who) ?? { count: 0, role: byHost ? "host" : "practitioner" };
    entry.count += 1;
    lateCounts.set(who, entry);
    userIds.add(who);
  }

  /**
   * Everyone, not only the ids that turned up in a queue.
   *
   * A count on this page is useless if it cannot be turned back into a name —
   * "1 listing" answers nothing an operator actually wants to know. So the
   * lookup covers every account, and the panels below can always say who.
   */
  for (const profile of profiles.data ?? []) userIds.add(profile.id as string);
  const emails = await emailsFor(admin, [...userIds]);

  /**
   * The published thresholds, not a second copy of them.
   *
   * The two sides are held to different bars on purpose — a host cancellation
   * is the one nothing makes right, a practitioner's is already paid for — and
   * a dashboard that invented its own numbers would warn about people the
   * policy considers fine, and stay silent about people it has suspended.
   */
  const atRisk: AtRiskAccount[] = [...lateCounts.entries()]
    .filter(([, entry]) => entry.count >= THRESHOLDS[entry.role as Party].warnAt)
    .map(([id, entry]) => ({
      id,
      email: emails.get(id) ?? null,
      role: entry.role,
      lateCancellations: entry.count,
      suspended: entry.count >= THRESHOLDS[entry.role as Party].suspendAt,
    }))
    .sort((a, b) => b.lateCancellations - a.lateCancellations);

  const { perPerson, perListing } = rollUp(
    paid.map((booking) => ({
      spaceId: booking.space_id as string,
      practitionerId: (booking.practitioner_id as string | null) ?? null,
      hostRateCents: (booking.host_rate_cents as number) ?? 0,
      totalCents: (booking.total_cents as number) ?? 0,
    })),
    spaceHost,
  );

  const listingCounts = new Map<string, number>();
  for (const space of spaces.data ?? []) {
    const hostId = space.host_id as string;
    listingCounts.set(hostId, (listingCounts.get(hostId) ?? 0) + 1);
  }

  const partyFor = (id: string): SessionParty => {
    const row = profileById.get(id);
    return {
      id,
      name: (row?.display_name as string) ?? null,
      email: emails.get(id) ?? null,
      emergency: {
        name: (row?.emergency_contact_name as string) ?? null,
        phone: (row?.emergency_contact_phone as string) ?? null,
        relationship: (row?.emergency_contact_relationship as string) ?? null,
      },
    };
  };

  const liveSessions: LiveSession[] = (bookings.data ?? [])
    .flatMap((booking) => {
      const state = sessionState(
        booking.status as string,
        // The stored end, not an assumed hour — if the session length ever
        // changes, this list should not be the thing that quietly disagrees.
        new Date(booking.starts_at as string),
        new Date(booking.ends_at as string),
        now,
      );
      if (!state) return [];

      const spaceId = booking.space_id as string;
      const startsAt = new Date(booking.starts_at as string);
      const endsAt = new Date(booking.ends_at as string);

      return [{
        bookingId: booking.id as string,
        spaceName: spaceName.get(spaceId) ?? "A room",
        addressLine: spaceAddress.get(spaceId) ?? null,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        state,
        practitioner: partyFor(booking.practitioner_id as string),
        host: partyFor(spaceHost.get(spaceId) ?? ""),
      }];
    })
    // The one in the room now before the one arriving later.
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  /**
   * Why each listing is waiting, rather than only that it is.
   *
   * A brand-new listing and one that was live until its host changed the
   * address are the same status and a different job — the second was approved
   * once, so the question is what changed rather than whether to trust it at
   * all. `updated_at` moving well after `created_at` is what separates them.
   */
  const reviewReasons: ReviewReason[] = (spaces.data ?? [])
    .filter(
      (space) =>
        space.status === "pending" ||
        space.sublease_doc_state === "rejected" ||
        space.insurance_doc_state === "rejected",
    )
    .map((space) => {
      const created = new Date(space.created_at as string).getTime();
      const updated = new Date((space.updated_at as string) ?? space.created_at).getTime();

      return {
        id: space.id as string,
        name: space.name as string,
        hostEmail: emails.get(space.host_id as string) ?? null,
        // An hour, so saving a typo minutes after listing does not read as a
        // listing coming back from being live.
        returning: updated - created > 60 * 60 * 1000,
        subleaseState: (space.sublease_doc_state as string) ?? "pending",
        insuranceState: (space.insurance_doc_state as string) ?? "pending",
        note: (space.doc_review_note as string) ?? null,
        since: (space.updated_at as string) ?? (space.created_at as string),
      };
    })
    .sort((a, b) => a.since.localeCompare(b.since));

  /**
   * What a live listing is missing.
   *
   * Every one of these is a reason somebody scrolls past a room that is
   * otherwise fine, and every one is fixable in a message to the host. Named
   * individually rather than scored, because "listing quality 60%" tells an
   * operator nothing they can act on.
   */
  const availabilityBySpace = new Map<string, number>();
  for (const block of availability.data ?? []) {
    const id = block.space_id as string;
    availabilityBySpace.set(id, (availabilityBySpace.get(id) ?? 0) + 1);
  }

  const photoCount = new Map<string, number>();
  for (const item of media.data ?? []) {
    const id = item.space_id as string;
    photoCount.set(id, (photoCount.get(id) ?? 0) + 1);
  }

  const listingGaps: ListingGap[] = (spaces.data ?? [])
    .filter((space) => space.status === "active")
    .map((space) => {
      const missing: string[] = [];
      if (!space.description) missing.push("no description");
      if ((photoCount.get(space.id as string) ?? 0) === 0) missing.push("no photos");
      if (!space.entrance_access && !space.restroom_access) missing.push("no access details");
      if (!(availabilityBySpace.get(space.id as string) ?? 0)) missing.push("no open hours");

      return {
        id: space.id as string,
        name: space.name as string,
        hostEmail: emails.get(space.host_id as string) ?? null,
        missing,
      };
    })
    .filter((gap) => gap.missing.length > 0)
    .sort((a, b) => b.missing.length - a.missing.length);

  /**
   * Where people stop.
   *
   * Each step is a subset of the one above it, so a drop between two is a
   * place somebody gave up. Signups that never chose a side, hosts that never
   * listed, listings that never went live, rooms that never got booked.
   */
  const hostIds = new Set(
    (profiles.data ?? []).filter((p) => p.account_type === "host").map((p) => p.id as string),
  );
  const hostsWhoListed = new Set((spaces.data ?? []).map((s) => s.host_id as string));
  const spacesBooked = new Set(rows.map((b) => b.space_id as string));

  const funnel: FunnelStep[] = [
    { label: "Signed up", count: (profiles.data ?? []).length },
    {
      label: "Chose a side",
      count: (profiles.data ?? []).filter((p) => p.account_type !== null).length,
    },
    { label: "Hosts who listed", count: [...hostsWhoListed].filter((id) => hostIds.has(id)).length },
    {
      label: "Listings live",
      count: (spaces.data ?? []).filter((s) => s.status === "active").length,
    },
    {
      label: "Listings booked",
      count: (spaces.data ?? []).filter((s) => spacesBooked.has(s.id as string)).length,
    },
  ];

  /**
   * Not accepted the terms.
   *
   * The most consequential number here at the moment: acceptance was added
   * after everybody had already signed up, so it is deliberately not
   * backfilled and every existing account shows until they next open the app.
   */
  const termsOutstanding = (profiles.data ?? []).filter(
    (p) => (p.terms_version as number | null) === null,
  ).length;

  // Fourteen buckets, pre-seeded so a quiet day is a gap in the chart rather
  // than a missing bar that shifts every other one along.
  const byDay = new Map<string, number>();
  for (let i = 0; i < 14; i++) {
    const day = new Date(chartStart.getTime() + i * DAY_MS);
    byDay.set(day.toISOString().slice(0, 10), 0);
  }
  /*
   * Money on the same fourteen days as the booking count, so the two charts
   * line up and a busy day with no revenue — all cancelled, or none captured —
   * is visible as a gap between them rather than invisible.
   */
  const moneyDay = new Map<string, { platformCents: number; grossCents: number }>();
  for (const [day] of byDay) moneyDay.set(day, { platformCents: 0, grossCents: 0 });

  for (const booking of rows) {
    const key = new Date(booking.starts_at as string).toISOString().slice(0, 10);
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + 1);

    if (booking.captured_at !== null && moneyDay.has(key)) {
      const bucket = moneyDay.get(key)!;
      bucket.platformCents += (booking.platform_cents as number) ?? 0;
      bucket.grossCents += (booking.total_cents as number) ?? 0;
    }
  }

  return {
    escalations: (escalations.data ?? [])
      .map((row) => {
        const review = (row as unknown as { reviews: Record<string, unknown> }).reviews ?? {};
        const booking = (review.bookings as { spaces?: { name?: string } }) ?? {};
        return {
          id: row.id as string,
          priority: row.priority as OpenEscalation["priority"],
          createdAt: row.created_at as string,
          overall: (review.overall as number) ?? 0,
          comment: (review.comment as string) ?? "",
          safetyConcern: Boolean(review.safety_concern),
          role: (review.role as string) ?? "",
          spaceName: booking.spaces?.name ?? null,
        };
      })
      // A stated risk outranks a low rating however old either is.
      .sort((a, b) => rank(a.priority) - rank(b.priority)),

    pendingListings: (listings.data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      category: row.category as string,
      hourlyRateCents: row.hourly_rate_cents as number,
      addressLine: (row.address_line as string) ?? null,
      hostEmail: emails.get(row.host_id as string) ?? null,
      subleaseDocPath: (row.sublease_doc_path as string) ?? null,
      insuranceDocPath: (row.insurance_doc_path as string) ?? null,
      createdAt: row.created_at as string,
    })),

    accountChangeRequests: (changes.data ?? []).map((row) => ({
      id: row.id as string,
      email: emails.get(row.user_id as string) ?? null,
      from: row.requested_type === "host" ? "practitioner" : "host",
      to: row.requested_type as string,
      reason: (row.reason as string) ?? "",
      createdAt: row.created_at as string,
    })),

    unpayableHosts: [...unpayable.values()]
      .map((host) => ({ ...host, email: emails.get(host.id) ?? null }))
      .sort((a, b) => b.owedCents - a.owedCents),

    money: {
      platformCents: sum(thisMonth, "platform_cents"),
      hostCents: sum(thisMonth, "host_rate_cents"),
      grossCents: sum(thisMonth, "total_cents"),
      platformAllTimeCents: sum(paid, "platform_cents"),
    },

    counts: {
      activeListings: (spaces.data ?? []).filter((s) => s.status === "active").length,
      pendingListings: (listings.data ?? []).length,
      practitioners: (profiles.data ?? []).filter((p) => p.account_type === "practitioner").length,
      hosts: (profiles.data ?? []).filter((p) => p.account_type === "host").length,
      sessionsThisMonth: thisMonth.length,
      upcomingSessions: rows.filter(
        (b) => b.status === "upcoming" && new Date(b.starts_at as string) > now,
      ).length,
      hostsUnpaid: rows.filter(
        (b) =>
          b.captured_at !== null &&
          b.refunded_at === null &&
          b.host_paid_at === null &&
          new Date(b.starts_at as string) < now,
      ).length,
    },

    bookingsByDay: [...byDay.entries()].map(([day, count]) => ({ day, bookings: count })),

    failedNotifications: (notifications.data ?? []).map((row) => ({
      id: row.id as string,
      kind: row.kind as string,
      channel: row.channel as string,
      attempts: (row.attempts as number) ?? 0,
      lastError: (row.last_error as string) ?? null,
      // Given up on, versus still being retried and possibly still arriving.
      givenUp: row.dropped_at !== null,
      createdAt: row.created_at as string,
    })),

    atRisk,

    reviewReasons,
    listingGaps,
    moneyByDay: [...moneyDay.entries()].map(([day, m]) => ({ day, ...m })),
    funnel,
    termsOutstanding,

    liveSessions,

    people: (profiles.data ?? [])
      .map((row) => {
        const id = row.id as string;
        const totals = perPerson.get(id) ?? EMPTY_TOTALS;
        const isHost = row.account_type === "host";
        return {
          id,
          email: emails.get(id) ?? null,
          accountType: (row.account_type as string) ?? null,
          displayName: (row.display_name as string) ?? null,
          joinedAt: (row.created_at as string) ?? null,
          listings: listingCounts.get(id) ?? 0,
          sessions: totals.sessions,
          lateCancellations: lateCounts.get(id)?.count ?? 0,
          // Null rather than false for a practitioner, who has nothing to be
          // paid into — an unpaid host is a problem, a practitioner without a
          // payout account is simply how it works.
          payoutsReady: isHost ? Boolean(payable.get(id)) : null,
          earnedCents: totals.earned,
          spentCents: totals.spent,
          emergency: {
            name: (row.emergency_contact_name as string) ?? null,
            phone: (row.emergency_contact_phone as string) ?? null,
            relationship: (row.emergency_contact_relationship as string) ?? null,
          },
        };
      })
      // Busiest first, then whoever arrived most recently among the quiet ones.
      .sort(
        (a, b) =>
          b.sessions - a.sessions ||
          (b.joinedAt ?? "").localeCompare(a.joinedAt ?? ""),
      ),

    listings: (spaces.data ?? [])
      .map((row) => {
        const id = row.id as string;
        const totals = perListing.get(id) ?? { sessions: 0, earned: 0 };
        return {
          id,
          name: row.name as string,
          status: row.status as string,
          category: (row.category as string) ?? "",
          hourlyRateCents: (row.hourly_rate_cents as number) ?? 0,
          hostEmail: emails.get(row.host_id as string) ?? null,
          addressLine: (row.address_line as string) ?? null,
          sessions: totals.sessions,
          earnedCents: totals.earned,
          createdAt: (row.created_at as string) ?? null,
        };
      })
      .sort((a, b) => b.sessions - a.sessions || (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),

    activity: buildActivity({
      rows,
      spaceName,
      spaces: spaces.data ?? [],
      profiles: profiles.data ?? [],
      reviews: reviews.data ?? [],
      messages: messages.data ?? [],
      emails,
    }),

    recent: rows.slice(0, 8).map((row) => ({
      id: row.id as string,
      spaceName: spaceName.get(row.space_id as string) ?? "a space",
      startsAt: row.starts_at as string,
      status: row.status as string,
      totalCents: (row.total_cents as number) ?? 0,
      hostRateCents: (row.host_rate_cents as number) ?? 0,
    })),
  };
}


/* ------------------------------------------------------------------ */

/** A booking that was actually charged, reduced to what a rollup needs. */
export interface PaidBooking {
  spaceId: string;
  practitionerId: string | null;
  /** What the host is owed. Never the same number as `totalCents`. */
  hostRateCents: number;
  /** What the practitioner paid, fees included. */
  totalCents: number;
}

export interface Totals {
  sessions: number;
  earned: number;
  spent: number;
}

export const EMPTY_TOTALS: Totals = { sessions: 0, earned: 0, spent: 0 };

/**
 * Sessions and money per person and per room.
 *
 * Both sides of a paid booking are credited from the same row, in one pass:
 * the host with their rate, the practitioner with what they actually paid.
 * Two queries, one per side, is where the two columns start disagreeing about
 * a booking that landed between them.
 *
 * The two amounts are deliberately different numbers and must never be
 * summed together — the difference is the platform's fee, and adding them
 * would count the same session's revenue twice.
 */
export function rollUp(
  bookings: PaidBooking[],
  spaceHost: Map<string, string>,
): { perPerson: Map<string, Totals>; perListing: Map<string, Totals> } {
  const perPerson = new Map<string, Totals>();
  const perListing = new Map<string, Totals>();

  const bump = (into: Map<string, Totals>, key: string, patch: Partial<Totals>) => {
    const entry = into.get(key) ?? { ...EMPTY_TOTALS };
    entry.sessions += patch.sessions ?? 0;
    entry.earned += patch.earned ?? 0;
    entry.spent += patch.spent ?? 0;
    into.set(key, entry);
  };

  for (const booking of bookings) {
    bump(perListing, booking.spaceId, { sessions: 1, earned: booking.hostRateCents });

    const hostId = spaceHost.get(booking.spaceId);
    if (hostId) bump(perPerson, hostId, { sessions: 1, earned: booking.hostRateCents });

    /*
     * A host booking their own room is one session for them, not two.
     * Crediting both sides would show a studio twice the sessions they ran,
     * and the same discipline the badges use for the same reason.
     */
    if (booking.practitionerId && booking.practitionerId !== hostId) {
      bump(perPerson, booking.practitionerId, { sessions: 1, spent: booking.totalCents });
    } else if (booking.practitionerId) {
      bump(perPerson, booking.practitionerId, { spent: booking.totalCents });
    }
  }

  return { perPerson, perListing };
}

const rank = (priority: OpenEscalation["priority"]) =>
  priority === "safety" ? 0 : priority === "urgent" ? 1 : 2;

/**
 * Addresses from the auth schema.
 *
 * Fetched through the admin API rather than joined, because `auth.users` is not
 * reachable from PostgREST — deliberate on Supabase's part, and not worth
 * working around with a view that would expose it more widely.
 */
async function emailsFor(
  admin: SupabaseClient,
  ids: string[],
): Promise<Map<string, string | null>> {
  const found = new Map<string, string | null>();
  if (ids.length === 0) return found;

  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const user of data?.users ?? []) {
    if (ids.includes(user.id)) found.set(user.id, user.email ?? null);
  }

  return found;
}

/**
 * One feed out of five different kinds of thing.
 *
 * An operator does not think in tables — they think "what has happened". So
 * signups, listings, bookings, cancellations, reviews and messages are folded
 * into one list sorted by time, and each line says what happened in a
 * sentence rather than naming the table it came from.
 *
 * Messages appear as a count and a timestamp only. What was said is between
 * the two people on that booking, and an operator reading it would undo the
 * masking from the inside — the thing the whole feature exists to guarantee.
 */
function buildActivity(input: {
  rows: Record<string, unknown>[];
  spaceName: Map<string, string>;
  spaces: Record<string, unknown>[];
  profiles: Record<string, unknown>[];
  reviews: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  emails: Map<string, string | null>;
}): ActivityEntry[] {
  const entries: ActivityEntry[] = [];

  for (const booking of input.rows.slice(0, 25)) {
    const name = input.spaceName.get(booking.space_id as string) ?? "a space";
    const status = String(booking.status);

    entries.push(
      status.startsWith("cancelled")
        ? {
            id: `cancel-${booking.id}`,
            at: (booking.cancelled_at as string) ?? (booking.starts_at as string),
            kind: "cancellation",
            text: `${name} — cancelled by the ${status.endsWith("host") ? "studio" : "practitioner"}`,
          }
        : {
            id: `booking-${booking.id}`,
            at: booking.starts_at as string,
            kind: "booking",
            text: `${name} — booked`,
          },
    );
  }

  for (const space of input.spaces.slice(0, 15)) {
    entries.push({
      id: `listing-${space.id}`,
      at: (space.created_at as string) ?? new Date(0).toISOString(),
      kind: "listing",
      text: `${space.name} — listed (${space.status})`,
    });
  }

  for (const review of input.reviews) {
    entries.push({
      id: `review-${review.id}`,
      at: review.created_at as string,
      kind: "review",
      text: review.safety_concern
        ? `Safety concern raised by a ${review.role}`
        : `${review.overall}-star review from a ${review.role}`,
    });
  }

  for (const message of input.messages) {
    entries.push({
      id: `message-${message.id}`,
      at: message.created_at as string,
      kind: "message",
      text: "A message was sent on a booking",
    });
  }

  return entries
    .filter((entry) => entry.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 30);
}
