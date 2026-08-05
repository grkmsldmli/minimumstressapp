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
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function loadQueue(admin: SupabaseClient): Promise<AdminQueue> {
  const now = new Date();

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const chartStart = new Date(now.getTime() - 13 * DAY_MS);
  chartStart.setHours(0, 0, 0, 0);

  const [listings, escalations, changes, profiles, spaces, bookings] = await Promise.all([
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

    admin.from("spaces").select("id, host_id, name, status"),

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
        "id, space_id, starts_at, status, captured_at, total_cents, host_rate_cents, platform_cents",
      )
      .order("starts_at", { ascending: false }),
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

  const emails = await emailsFor(admin, [...userIds]);

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
