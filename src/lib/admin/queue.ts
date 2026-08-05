import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Everything waiting for a person, in one read.
 *
 * The ordering is the point: this is a queue, not a report. What comes first is
 * whatever hurts somebody while nobody is looking — a safety concern nobody has
 * read, a host earning money they cannot receive — and the pleasant numbers come
 * last, because a dashboard that opens on revenue is a dashboard where the
 * unread report stays unread.
 *
 * Read with the service role, which is the only way to see a pending listing's
 * documents at all. That is also why the route in front of this checks the
 * allowlist before calling it.
 */

export interface PendingListing {
  id: string;
  name: string;
  category: string;
  hourlyRateCents: number;
  addressLine: string | null;
  hostEmail: string | null;
  hostName: string | null;
  subleaseDocPath: string | null;
  insuranceDocPath: string | null;
  photoCount: number;
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
  subjectEmail: string | null;
}

export interface AdminQueue {
  pendingListings: PendingListing[];
  escalations: OpenEscalation[];
  unpayableHosts: { id: string; email: string | null; upcomingSessions: number }[];
  accountChangeRequests: { id: string; email: string | null; from: string; to: string; reason: string; createdAt: string }[];
  /** Context, not work. Last so it cannot crowd out the queue above it. */
  summary: {
    activeListings: number;
    sessionsThisMonth: number;
    creditOwedCents: number;
  };
}

export async function loadQueue(admin: SupabaseClient): Promise<AdminQueue> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [
    listings,
    escalations,
    hosts,
    changes,
    activeCount,
    monthSessions,
    credit,
  ] = await Promise.all([
    admin
      .from("spaces")
      .select(
        "id, name, category, hourly_rate_cents, address_line, sublease_doc_path, insurance_doc_path, created_at, host_id",
      )
      .eq("status", "pending")
      .order("created_at"),

    admin
      .from("review_escalations")
      .select("id, priority, created_at, state, reviews(overall, comment, safety_concern, role, subject_id, bookings(spaces(name)))")
      .neq("state", "resolved")
      // Safety first, then oldest — a report that has waited is worse than a
      // fresh one of the same severity.
      .order("created_at"),

    admin
      .from("profiles")
      .select("id, stripe_connect_charges_enabled")
      .eq("stripe_connect_charges_enabled", false),

    admin
      .from("account_type_change_requests")
      .select("id, user_id, requested_type, reason, created_at, state")
      .eq("state", "open")
      .order("created_at"),

    admin.from("spaces").select("id", { count: "exact", head: true }).eq("status", "active"),

    admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .gte("starts_at", monthStart.toISOString())
      .eq("status", "completed"),

    admin.from("credit_ledger").select("delta_cents"),
  ]);

  // Emails live on auth.users, not profiles, so they are fetched once for
  // everybody who appears anywhere above rather than per row.
  const userIds = new Set<string>([
    ...(listings.data ?? []).map((row) => row.host_id as string),
    ...(changes.data ?? []).map((row) => row.user_id as string),
    ...(hosts.data ?? []).map((row) => row.id as string),
  ]);

  const emails = await emailsFor(admin, [...userIds]);

  return {
    pendingListings: (listings.data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      category: row.category as string,
      hourlyRateCents: row.hourly_rate_cents as number,
      addressLine: (row.address_line as string) ?? null,
      hostEmail: emails.get(row.host_id as string) ?? null,
      hostName: null,
      subleaseDocPath: (row.sublease_doc_path as string) ?? null,
      insuranceDocPath: (row.insurance_doc_path as string) ?? null,
      photoCount: 0,
      createdAt: row.created_at as string,
    })),

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
          subjectEmail: null,
        };
      })
      // A stated risk outranks a low rating however old either is.
      .sort((a, b) => rank(a.priority) - rank(b.priority)),

    unpayableHosts: [],

    accountChangeRequests: (changes.data ?? []).map((row) => ({
      id: row.id as string,
      email: emails.get(row.user_id as string) ?? null,
      from: row.requested_type === "host" ? "practitioner" : "host",
      to: row.requested_type as string,
      reason: (row.reason as string) ?? "",
      createdAt: row.created_at as string,
    })),

    summary: {
      activeListings: activeCount.count ?? 0,
      sessionsThisMonth: monthSessions.count ?? 0,
      creditOwedCents: (credit.data ?? []).reduce(
        (sum, row) => sum + ((row.delta_cents as number) ?? 0),
        0,
      ),
    },
  };
}

const rank = (priority: OpenEscalation["priority"]) =>
  priority === "safety" ? 0 : priority === "urgent" ? 1 : 2;

/**
 * Addresses from the auth schema.
 *
 * Fetched through the admin API rather than joined, because `auth.users` is not
 * reachable from PostgREST — which is deliberate on Supabase's part and worth
 * not working around with a view that would expose it more widely.
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
