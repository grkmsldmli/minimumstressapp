import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type AdminCancellationRow,
  EMPTY_TOTALS,
  rollUp,
  standingByPerson,
} from "./queue";

/**
 * The cross-linked business graph, in one read.
 *
 * Command answers "what is happening"; this answers "who / which room / which
 * booking", and every id here points at a real detail page — no number on any
 * admin screen dead-ends. People, spaces and bookings are loaded together so
 * they can be linked by id in both directions (a booking knows its practitioner,
 * host and space; a person knows their bookings and listings), and the derived
 * money and standing come from the very same helpers the queue and the booking
 * gate use, so this directory can never disagree with them about a person's
 * earnings, sessions or reliability.
 *
 * At founding scale the whole graph is small; it is read whole and filtered in
 * memory rather than paginated in SQL, which keeps every count consistent with
 * every other and the code honest about what it is showing.
 */

export interface DirPerson {
  id: string;
  email: string | null;
  displayName: string | null;
  accountType: string | null;
  joinedAt: string | null;
  listings: number;
  sessions: number;
  earnedCents: number;
  spentCents: number;
  lateCancellations: number;
  suspended: boolean;
  /** Hosts only; null for a practitioner, who has nothing to be paid into. */
  payoutsReady: boolean | null;
  emergency: { name: string | null; phone: string | null; relationship: string | null };
}

export interface DirSpace {
  id: string;
  name: string;
  status: string;
  category: string;
  hourlyRateCents: number;
  hostId: string | null;
  hostEmail: string | null;
  hostName: string | null;
  addressLine: string | null;
  sessions: number;
  earnedCents: number;
  createdAt: string | null;
  archivedAt: string | null;
}

export interface DirBooking {
  id: string;
  spaceId: string;
  spaceName: string;
  practitionerId: string | null;
  practitionerName: string | null;
  practitionerEmail: string | null;
  hostId: string | null;
  hostName: string | null;
  hostEmail: string | null;
  startsAt: string;
  endsAt: string | null;
  status: string;
  /** Kept distinct on purpose: gross ≠ host earnings ≠ platform revenue. */
  totalCents: number;
  hostRateCents: number;
  platformCents: number;
  /** A charged booking. An abandoned checkout has no captured_at and is not one. */
  paid: boolean;
  capturedAt: string | null;
  cancelledAt: string | null;
  refundedAt: string | null;
  hostPaidAt: string | null;
}

export interface Directory {
  people: DirPerson[];
  spaces: DirSpace[];
  bookings: DirBooking[];
}

/**
 * Emails live in the auth schema, unreachable from PostgREST by design, so they
 * are fetched through the admin API. One page of 1000 covers founding scale;
 * beyond that this would page, and the caller would know because the map would
 * be short.
 */
async function allEmails(admin: SupabaseClient): Promise<Map<string, string | null>> {
  const emails = new Map<string, string | null>();
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const user of data?.users ?? []) emails.set(user.id, user.email ?? null);
  return emails;
}

export async function loadDirectory(admin: SupabaseClient): Promise<Directory> {
  const now = new Date();

  const [profilesRes, spacesRes, bookingsRes, emails] = await Promise.all([
    admin
      .from("profiles")
      .select(
        "id, account_type, display_name, stripe_connect_charges_enabled, created_at, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship",
      ),
    admin
      .from("spaces")
      .select(
        "id, name, status, category, hourly_rate_cents, address_line, host_id, created_at, archived_at",
      ),
    admin
      .from("bookings")
      .select(
        "id, space_id, practitioner_id, starts_at, ends_at, status, captured_at, refunded_at, host_rate_refunded, host_paid_at, cancelled_at, total_cents, host_rate_cents, platform_cents",
      )
      .order("starts_at", { ascending: false }),
    allEmails(admin),
  ]);

  const profiles = profilesRes.data ?? [];
  const spaces = spacesRes.data ?? [];
  const bookingRows = bookingsRes.data ?? [];

  const spaceName = new Map<string, string>(spaces.map((s) => [s.id as string, s.name as string]));
  const spaceHost = new Map<string, string>(spaces.map((s) => [s.id as string, s.host_id as string]));
  const nameById = new Map<string, string | null>(
    profiles.map((p) => [p.id as string, (p.display_name as string) ?? null]),
  );
  const payable = new Map<string, boolean>(
    profiles.map((p) => [p.id as string, Boolean(p.stripe_connect_charges_enabled)]),
  );

  const paid = bookingRows.filter((b) => b.captured_at !== null);

  // The same money split the queue and the badges use — one row credits the host
  // their rate and the practitioner what they paid; the difference is our fee and
  // the two are never summed.
  const { perPerson, perListing } = rollUp(
    paid.map((b) => ({
      spaceId: b.space_id as string,
      practitionerId: (b.practitioner_id as string | null) ?? null,
      hostRateCents: (b.host_rate_cents as number) ?? 0,
      totalCents: (b.total_cents as number) ?? 0,
    })),
    spaceHost,
  );

  // The published standing rule, not a second copy of it.
  const standings = standingByPerson(
    bookingRows.map(
      (r): AdminCancellationRow => ({
        status: (r.status as string | null) ?? null,
        space_id: (r.space_id as string | null) ?? null,
        practitioner_id: (r.practitioner_id as string | null) ?? null,
        captured_at: (r.captured_at as string | null) ?? null,
        cancelled_at: (r.cancelled_at as string | null) ?? null,
        starts_at: (r.starts_at as string | null) ?? null,
      }),
    ),
    spaceHost,
    now,
  );

  const listingCounts = new Map<string, number>();
  for (const s of spaces) {
    const hostId = s.host_id as string;
    listingCounts.set(hostId, (listingCounts.get(hostId) ?? 0) + 1);
  }

  const people: DirPerson[] = profiles
    .map((row) => {
      const id = row.id as string;
      const totals = perPerson.get(id) ?? EMPTY_TOTALS;
      const isHost = row.account_type === "host";
      return {
        id,
        email: emails.get(id) ?? null,
        displayName: (row.display_name as string) ?? null,
        accountType: (row.account_type as string) ?? null,
        joinedAt: (row.created_at as string) ?? null,
        listings: listingCounts.get(id) ?? 0,
        sessions: totals.sessions,
        earnedCents: totals.earned,
        spentCents: totals.spent,
        lateCancellations: standings.get(id)?.standing.lateCancellations ?? 0,
        suspended: standings.get(id)?.standing.blocksNewBookings ?? false,
        payoutsReady: isHost ? Boolean(payable.get(id)) : null,
        emergency: {
          name: (row.emergency_contact_name as string) ?? null,
          phone: (row.emergency_contact_phone as string) ?? null,
          relationship: (row.emergency_contact_relationship as string) ?? null,
        },
      };
    })
    .sort(
      (a, b) => b.sessions - a.sessions || (b.joinedAt ?? "").localeCompare(a.joinedAt ?? ""),
    );

  const dirSpaces: DirSpace[] = spaces
    .map((row) => {
      const id = row.id as string;
      const hostId = (row.host_id as string) ?? null;
      const totals = perListing.get(id) ?? { sessions: 0, earned: 0 };
      return {
        id,
        name: row.name as string,
        status: row.status as string,
        category: (row.category as string) ?? "",
        hourlyRateCents: (row.hourly_rate_cents as number) ?? 0,
        hostId,
        hostEmail: hostId ? emails.get(hostId) ?? null : null,
        hostName: hostId ? nameById.get(hostId) ?? null : null,
        addressLine: (row.address_line as string) ?? null,
        sessions: totals.sessions,
        earnedCents: totals.earned,
        createdAt: (row.created_at as string) ?? null,
        archivedAt: (row.archived_at as string) ?? null,
      };
    })
    .sort((a, b) => b.sessions - a.sessions || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  const bookings: DirBooking[] = bookingRows.map((row) => {
    const spaceId = row.space_id as string;
    const hostId = spaceHost.get(spaceId) ?? null;
    const practitionerId = (row.practitioner_id as string | null) ?? null;
    return {
      id: row.id as string,
      spaceId,
      spaceName: spaceName.get(spaceId) ?? "a space",
      practitionerId,
      practitionerName: practitionerId ? nameById.get(practitionerId) ?? null : null,
      practitionerEmail: practitionerId ? emails.get(practitionerId) ?? null : null,
      hostId,
      hostName: hostId ? nameById.get(hostId) ?? null : null,
      hostEmail: hostId ? emails.get(hostId) ?? null : null,
      startsAt: row.starts_at as string,
      endsAt: (row.ends_at as string) ?? null,
      status: row.status as string,
      totalCents: (row.total_cents as number) ?? 0,
      hostRateCents: (row.host_rate_cents as number) ?? 0,
      platformCents: (row.platform_cents as number) ?? 0,
      paid: row.captured_at !== null,
      capturedAt: (row.captured_at as string) ?? null,
      cancelledAt: (row.cancelled_at as string) ?? null,
      refundedAt: (row.refunded_at as string) ?? null,
      hostPaidAt: (row.host_paid_at as string) ?? null,
    };
  });

  return { people, spaces: dirSpaces, bookings };
}
