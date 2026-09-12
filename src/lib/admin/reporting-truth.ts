import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { rollUp, type AdminQueue, loadQueue } from "./queue";

/**
 * A booking row in the admin reporting layer.
 *
 * The bookings table also contains provisional rows created while checkout is
 * in progress. Those rows are implementation details, not business facts. This
 * adapter is deliberately built around captured money for booking/revenue
 * reporting so an abandoned checkout can never become a cancellation, session,
 * booked listing, live session or revenue event in the founder console.
 */
export interface ReportingBookingRow {
  id: string;
  space_id: string;
  practitioner_id: string | null;
  starts_at: string;
  status: string;
  captured_at: string | null;
  cancelled_at: string | null;
  refunded_cents: number | null;
  host_rate_refunded: boolean | null;
  host_paid_at: string | null;
  total_cents: number | null;
  host_rate_cents: number | null;
  platform_cents: number | null;
}

export interface ReportingSpaceRow {
  id: string;
  host_id: string | null;
}

export interface NetBookingAmounts {
  grossCents: number;
  hostCents: number;
  platformCents: number;
}

/** Net economics after any refund already recorded on the booking. */
export function netBookingAmounts(row: ReportingBookingRow): NetBookingAmounts {
  const charged = Math.max(0, row.total_cents ?? 0);
  const refunded = Math.max(0, Math.min(charged, row.refunded_cents ?? 0));
  const grossCents = charged - refunded;
  const hostCents = row.host_rate_refunded === true ? 0 : Math.max(0, row.host_rate_cents ?? 0);

  // Our revenue is what remains after the practitioner's net payment and the
  // host's retained earnings are separated. This correctly becomes zero both
  // for a full refund and for a platform-fee-only refund.
  const platformCents = Math.max(0, grossCents - hostCents);
  return { grossCents, hostCents, platformCents };
}

const sum = (rows: ReportingBookingRow[], pick: (row: ReportingBookingRow) => number) =>
  rows.reduce((total, row) => total + pick(row), 0);

/**
 * Correct the broad legacy queue into business truth.
 *
 * loadQueue intentionally reads many tables in one shot for the operations
 * console. This function is the final reporting boundary: only captured rows
 * are bookings; refunds reduce money; calendar-month metrics stop at the next
 * month; and payout warnings only refer to completed/due sessions.
 */
export function enforceReportingTruth(
  queue: AdminQueue,
  bookingRows: ReportingBookingRow[],
  spaceRows: ReportingSpaceRow[],
  now = new Date(),
): AdminQueue {
  const captured = bookingRows.filter((row) => row.captured_at !== null);
  const capturedIds = new Set(captured.map((row) => row.id));
  const spaceHost = new Map(spaceRows.map((space) => [space.id, space.host_id]));

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const thisMonth = captured.filter((row) => {
    const start = new Date(row.starts_at);
    return start >= monthStart && start < nextMonthStart;
  });

  const monthGross = sum(thisMonth, (row) => netBookingAmounts(row).grossCents);
  const monthHost = sum(thisMonth, (row) => netBookingAmounts(row).hostCents);
  const monthPlatform = sum(thisMonth, (row) => netBookingAmounts(row).platformCents);
  const allTimePlatform = sum(captured, (row) => netBookingAmounts(row).platformCents);

  const byDay = new Map(queue.moneyByDay.map((day) => [day.day, { platformCents: 0, grossCents: 0 }]));
  for (const row of captured) {
    const day = new Date(row.starts_at).toISOString().slice(0, 10);
    const bucket = byDay.get(day);
    if (!bucket) continue;
    const net = netBookingAmounts(row);
    bucket.platformCents += net.platformCents;
    bucket.grossCents += net.grossCents;
  }

  const spacesBooked = new Set(captured.map((row) => row.space_id));
  const funnel = queue.funnel.map((step) =>
    step.label === "Listings booked" ? { ...step, count: spacesBooked.size } : step,
  );

  // The activity builder historically treated any raw cancelled row as a real
  // cancellation. Provisional checkout cleanup uses exactly those statuses, so
  // only booking/cancellation entries backed by captured money survive here.
  const activity = queue.activity.filter((entry) => {
    if (entry.kind !== "booking" && entry.kind !== "cancellation") return true;
    const prefix = entry.kind === "booking" ? "booking-" : "cancel-";
    return capturedIds.has(entry.id.slice(prefix.length));
  });

  const liveSessions = queue.liveSessions.filter((session) => capturedIds.has(session.bookingId));

  // People/listing lifetime totals must reflect refunds too. Session counts are
  // counts of genuine captured bookings; money is net of refunds.
  const { perPerson, perListing } = rollUp(
    captured.map((row) => {
      const net = netBookingAmounts(row);
      return {
        spaceId: row.space_id,
        practitionerId: row.practitioner_id,
        hostRateCents: net.hostCents,
        totalCents: net.grossCents,
      };
    }),
    new Map(
      [...spaceHost.entries()].flatMap(([spaceId, hostId]) =>
        hostId ? ([[spaceId, hostId]] as [string, string][]) : [],
      ),
    ),
  );

  const people = queue.people.map((person) => {
    const totals = perPerson.get(person.id);
    return totals
      ? { ...person, sessions: totals.sessions, earnedCents: totals.earned, spentCents: totals.spent }
      : { ...person, sessions: 0, earnedCents: 0, spentCents: 0 };
  });

  const listings = queue.listings.map((listing) => {
    const totals = perListing.get(listing.id);
    return totals
      ? { ...listing, sessions: totals.sessions, earnedCents: totals.earned }
      : { ...listing, sessions: 0, earnedCents: 0 };
  });

  // A host is owed only after a captured session is due, the host's rate was
  // not refunded, and no host payout has been recorded yet.
  const payoutReady = new Map(
    people
      .filter((person) => person.accountType === "host")
      .map((person) => [person.id, person.payoutsReady === true]),
  );
  const personById = new Map(people.map((person) => [person.id, person]));
  const dueUnpaid = captured.filter(
    (row) =>
      new Date(row.starts_at) < now &&
      row.host_rate_refunded !== true &&
      row.host_paid_at === null,
  );
  const unpayable = new Map<string, AdminQueue["unpayableHosts"][number]>();
  for (const row of dueUnpaid) {
    const hostId = spaceHost.get(row.space_id);
    if (!hostId || payoutReady.get(hostId) === true) continue;
    const prior = unpayable.get(hostId) ?? {
      id: hostId,
      email: personById.get(hostId)?.email ?? null,
      listings: personById.get(hostId)?.listings ?? 0,
      owedSessions: 0,
      owedCents: 0,
    };
    prior.owedSessions += 1;
    prior.owedCents += Math.max(0, row.host_rate_cents ?? 0);
    unpayable.set(hostId, prior);
  }

  const netById = new Map(captured.map((row) => [row.id, netBookingAmounts(row)]));
  const recent = queue.recent.map((booking) => {
    const net = netById.get(booking.id);
    return net
      ? { ...booking, totalCents: net.grossCents, hostRateCents: net.hostCents }
      : booking;
  });

  return {
    ...queue,
    money: {
      platformCents: monthPlatform,
      hostCents: monthHost,
      grossCents: monthGross,
      platformAllTimeCents: allTimePlatform,
    },
    counts: {
      ...queue.counts,
      sessionsThisMonth: thisMonth.length,
      upcomingSessions: captured.filter(
        (row) => row.status === "upcoming" && new Date(row.starts_at) > now,
      ).length,
      // This field is intentionally the count of due unpaid sessions. The
      // actual host count is unpayableHosts.length and is labelled that way.
      hostsUnpaid: dueUnpaid.length,
    },
    moneyByDay: queue.moneyByDay.map((day) => ({ day: day.day, ...(byDay.get(day.day) ?? { platformCents: 0, grossCents: 0 }) })),
    funnel,
    activity,
    liveSessions,
    people,
    listings,
    unpayableHosts: [...unpayable.values()].sort((a, b) => b.owedCents - a.owedCents),
    recent,
  };
}

/** Load the broad ops queue and apply the audited reporting boundary. */
export async function loadReportingQueue(admin: SupabaseClient): Promise<AdminQueue> {
  const [queue, bookings, spaces] = await Promise.all([
    loadQueue(admin),
    admin
      .from("bookings")
      .select(
        "id, space_id, practitioner_id, starts_at, status, captured_at, cancelled_at, refunded_cents, host_rate_refunded, host_paid_at, total_cents, host_rate_cents, platform_cents",
      ),
    admin.from("spaces").select("id, host_id"),
  ]);

  return enforceReportingTruth(
    queue,
    (bookings.data ?? []) as unknown as ReportingBookingRow[],
    (spaces.data ?? []) as unknown as ReportingSpaceRow[],
  );
}
