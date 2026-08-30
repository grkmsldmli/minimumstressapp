import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The two parties to a booking, derived server-side for the report/block routes.
 *
 * A host never learns the practitioner's user id on the client (they see a first
 * name), so who to report or block is worked out here from booking truth, with
 * the service role, rather than trusted from the caller.
 */
export interface BookingParties {
  practitionerId: string;
  hostId: string;
}

/** The booking's practitioner and host, or null if the booking does not exist. */
export async function bookingParties(
  admin: SupabaseClient,
  bookingId: string,
): Promise<BookingParties | null> {
  const { data: booking } = await admin
    .from("bookings")
    .select("practitioner_id, space_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return null;

  const { data: space } = await admin
    .from("spaces")
    .select("host_id")
    .eq("id", booking.space_id)
    .maybeSingle();
  if (!space) return null;

  return { practitionerId: booking.practitioner_id as string, hostId: space.host_id as string };
}

/**
 * The other party to `callerId` in a booking, or null when the caller is not a
 * participant — which the routes turn into a 403 rather than acting on it.
 */
export function counterpartFor(parties: BookingParties, callerId: string): string | null {
  if (callerId === parties.practitionerId) return parties.hostId;
  if (callerId === parties.hostId) return parties.practitionerId;
  return null;
}
