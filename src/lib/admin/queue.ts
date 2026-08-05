import type { SupabaseClient } from "@supabase/supabase-js";

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

export interface RecentBooking {
  id: string;
  spaceName: string;
  startsAt: string;
  status: string;
  totalCents: number;
  hostRateCents: number;
}

export interface AdminQueue {
  /* --- work --- */
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
    /** Sessions that started and were never captured — money sitting still. */
    uncaptured: number;
  };

  /** Fourteen days, oldest first, for a bar chart. */
  bookingsByDay: DayCount[];

  recent: RecentBooking[];

  failedNotifications: FailedNotification[];
  atRisk: AtRiskAccount[];
  /** Everything, newest first. The feed an operator actually watches. */
  activity: ActivityEntry[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function loadQueue(admin: SupabaseClient): Promise<AdminQueue> {
  const now = new Date();

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const chartStart = new Date(now.getTime() - 13 * DAY_MS);
  chartStart.setHours(0, 0, 0, 0);

  const [listings, escalations, changes, profiles, spaces, bookings, notifications, reviews, messages] =
    await Promise.all([
    admin
      .from("spaces")
      .select(
        "id, name, category, hourly_rate_cents, address_line, sublease_doc_path, insurance_doc_path, created_at, host_id",
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

    admin.from("profiles").select("id, account_type, stripe_connect_charges_enabled"),

    admin.from("spaces").select("id, host_id, name, status, created_at"),

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
        "id, space_id, starts_at, status, captured_at, cancelled_at, total_cents, host_rate_cents, platform_cents",
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
    const who = byHost ? spaceHost.get(booking.space_id as string) : null;
    if (byHost && !who) continue;

    const key = byHost ? who! : (booking.id as string);
    // Practitioner ids are not on this projection, so only the host side can
    // be attributed by person. Named rather than quietly half-counted.
    if (!byHost) continue;

    const entry = lateCounts.get(key) ?? { count: 0, role: "host" };
    entry.count += 1;
    lateCounts.set(key, entry);
    userIds.add(key);
  }

  const emails = await emailsFor(admin, [...userIds]);

  const atRisk: AtRiskAccount[] = [...lateCounts.entries()]
    // Two is the warning threshold for a host; three suspends.
    .filter(([, entry]) => entry.count >= 2)
    .map(([id, entry]) => ({
      id,
      email: emails.get(id) ?? null,
      role: entry.role,
      lateCancellations: entry.count,
      suspended: entry.count >= 3,
    }))
    .sort((a, b) => b.lateCancellations - a.lateCancellations);

  // Fourteen buckets, pre-seeded so a quiet day is a gap in the chart rather
  // than a missing bar that shifts every other one along.
  const byDay = new Map<string, number>();
  for (let i = 0; i < 14; i++) {
    const day = new Date(chartStart.getTime() + i * DAY_MS);
    byDay.set(day.toISOString().slice(0, 10), 0);
  }
  for (const booking of rows) {
    const key = new Date(booking.starts_at as string).toISOString().slice(0, 10);
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + 1);
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
      uncaptured: rows.filter(
        (b) =>
          b.status === "upcoming" &&
          b.captured_at === null &&
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
