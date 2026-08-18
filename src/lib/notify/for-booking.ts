import type { SupabaseClient } from "@supabase/supabase-js";

import { expiresAt } from "../booking-approval";
import { bookingUse } from "../booking-use";
import { type NotificationKind, render } from "./messages";
import { type PendingNotification, type Recipient, notify } from "./send";

/**
 * Turning a booking into "who needs to be told what".
 *
 * Kept apart from `send.ts` so that module can stay ignorant of bookings and
 * be tested on its own, and apart from `messages.ts` so the wording never has
 * to reach into a database row.
 */

/**
 * The recipient, if there is anyone to write to.
 *
 * Email lives on auth.users rather than profiles, so it is fetched with the
 * admin API. A phone number is returned *only* when it is both verified and
 * opted in — an unverified number is somebody's typo until proven otherwise,
 * and the wrong number is a stranger receiving a door code.
 */
export async function recipientFor(
  admin: SupabaseClient,
  userId: string,
): Promise<Recipient | null> {
  const [{ data: profile }, { data: auth }] = await Promise.all([
    admin
      .from("profiles")
      .select(
        "display_name, phone, phone_verified_at, notify_sms, notify_bookings, notify_payouts",
      )
      .eq("id", userId)
      .maybeSingle(),
    admin.auth.admin.getUserById(userId),
  ]);

  const email = auth?.user?.email ?? null;
  if (!profile && !email) return null;

  const smsAllowed = Boolean(profile?.notify_sms && profile?.phone_verified_at && profile?.phone);

  return {
    userId,
    name: profile?.display_name?.split(" ")[0] ?? undefined,
    email,
    phone: smsAllowed ? profile!.phone : null,
    // Default to on: a null column is an account that predates the setting,
    // not somebody who turned it off.
    wantsBookingAlerts: profile?.notify_bookings !== false,
    wantsPayoutAlerts: profile?.notify_payouts !== false,
  };
}

/**
 * Which notifications a switch is allowed to silence.
 *
 * The two toggles on the profile did nothing at all — the column was read and
 * never consulted, so the app offered control it did not have.
 *
 * Making them work needs a line drawn, because not everything here is an
 * alert. A booking confirmation carries the door code and the address; a
 * cancellation is somebody's day changing. Those arrive whether or not
 * anybody wants them, and no switch on this screen offers otherwise.
 *
 * What a host may turn off is the nudge that somebody booked, and the note
 * that money moved. Both are things they can see for themselves on a screen
 * they already have.
 */
const SILENCEABLE = {
  host_new_booking: "wantsBookingAlerts",
  host_payout_sent: "wantsPayoutAlerts",
} as const;

/** True when this recipient has asked not to receive this kind. */
export function hasOptedOut(recipient: Recipient, kind: string): boolean {
  const preference = SILENCEABLE[kind as keyof typeof SILENCEABLE];
  return preference !== undefined && recipient[preference] === false;
}

/**
 * How a time is written to a person.
 *
 * In the room's zone, always. This used to take whatever zone the process was
 * running in, which for email means the server — so a confirmation for a 9am
 * session in California went out reading 4pm, and the one thing an email about
 * a booking has to get right is when it is.
 *
 * The zone comes from the space rather than the recipient on purpose. Both
 * sides need to meet at the same door at the same moment, and the door is on
 * the room's clock; a practitioner reading their own zone would have to do the
 * conversion themselves to know when to leave.
 */
export function formatWhen(date: Date, timeZone: string): string {
  return date.toLocaleString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  });
}

/** The row shape every notifier here needs. Selected once, in `loadBooking`. */
interface BookingRow {
  id: string;
  practitioner_id: string;
  starts_at: string;
  total_cents: number;
  host_rate_cents: number;
  access_code: string | null;
  spaces: {
    name: string;
    host_id: string;
    timezone: string;
    address_line: string | null;
    entry_instructions: string | null;
  };
}

/**
 * The booking behind a message that is about to be sent again.
 *
 * Filtered rather than fetched, because a retry happens later — sometimes much
 * later — and the world moves in between. A first attempt that failed on a
 * provider error is retried against a booking that may since have been
 * cancelled, and the message being rebuilt may carry the door code. Sending it
 * then hands the way into a room to somebody whose booking no longer exists.
 *
 * The same two conditions as the gates in 0039: paid for, and still standing.
 */
async function loadBooking(admin: SupabaseClient, bookingId: string): Promise<BookingRow | null> {
  const { data } = await admin
    .from("bookings")
    .select(
      "id, practitioner_id, starts_at, total_cents, host_rate_cents, access_code, spaces!inner(name, host_id, timezone, address_line, entry_instructions)",
    )
    .eq("id", bookingId)
    .not("captured_at", "is", null)
    .in("status", ["upcoming", "completed"])
    .maybeSingle();

  return (data as BookingRow | null) ?? null;
}

/**
 * The booking behind a request, which is a different set of conditions.
 *
 * loadBooking refuses anything uncaptured or closed, and it is right to: its
 * messages carry the door code and the address, so a stale retry would hand
 * somebody the way into a room. None of that applies here. A request is
 * uncaptured by definition — that is what a hold is — and a decline is sent
 * precisely because the booking has just been closed. Reusing the strict
 * loader would mean no host was ever told about a request and nobody was ever
 * told it had been refused.
 *
 * What makes that safe is the messages themselves: not one of the request
 * kinds carries an address or a code, so there is nothing here to leak by
 * being late.
 */
async function loadRequest(
  admin: SupabaseClient,
  bookingId: string,
): Promise<
  | (BookingRow & {
      created_at: string;
      purpose: string | null;
      purpose_note: string | null;
      attendee_count: number | null;
      approval_note: string | null;
    })
  | null
> {
  const { data } = await admin
    .from("bookings")
    .select(
      "id, practitioner_id, starts_at, created_at, total_cents, host_rate_cents, access_code, purpose, purpose_note, attendee_count, approval_note, spaces!inner(name, host_id, timezone, address_line, entry_instructions)",
    )
    .eq("id", bookingId)
    .maybeSingle();

  return (data as never) ?? null;
}

/** A host, told somebody wants their room and by when they have to answer. */
export async function notifyRequestMade(admin: SupabaseClient, bookingId: string): Promise<void> {
  try {
    const booking = await loadRequest(admin, bookingId);
    if (!booking) return;

    const host = await recipientFor(admin, booking.spaces.host_id);
    if (!host || hasOptedOut(host, "host_new_request")) return;

    const zone = booking.spaces.timezone;
    const deadline = expiresAt({
      approvalState: "pending",
      requestedAt: new Date(booking.created_at),
      startsAt: new Date(booking.starts_at),
    });

    await notify({
      kind: "host_new_request",
      recipient: host,
      subjectId: bookingId,
      bookingId,
      context: {
        spaceName: booking.spaces.name,
        when: formatWhen(new Date(booking.starts_at), zone),
        // The host's rate, never the total — the same rule as host_new_booking.
        amountCents: booking.host_rate_cents,
        purpose: describePurpose(booking.purpose, booking.purpose_note),
        attendees: booking.attendee_count ?? undefined,
        deadline: formatWhen(deadline, zone),
      },
    });
  } catch (error) {
    console.error(`Request notification failed for ${bookingId}:`, error);
  }
}

/** The nudge halfway to the deadline. Deduped by kind and subject, so once. */
export async function notifyRequestReminder(
  admin: SupabaseClient,
  bookingId: string,
): Promise<void> {
  try {
    const booking = await loadRequest(admin, bookingId);
    if (!booking) return;

    const host = await recipientFor(admin, booking.spaces.host_id);
    if (!host || hasOptedOut(host, "host_new_request")) return;

    const zone = booking.spaces.timezone;

    await notify({
      kind: "host_request_reminder",
      recipient: host,
      subjectId: bookingId,
      bookingId,
      context: {
        spaceName: booking.spaces.name,
        when: formatWhen(new Date(booking.starts_at), zone),
        purpose: describePurpose(booking.purpose, booking.purpose_note),
        deadline: formatWhen(
          expiresAt({
            approvalState: "pending",
            requestedAt: new Date(booking.created_at),
            startsAt: new Date(booking.starts_at),
          }),
          zone,
        ),
      },
    });
  } catch (error) {
    console.error(`Request reminder failed for ${bookingId}:`, error);
  }
}

/** The three ways a request ends, told to the person who made it. */
export async function notifyRequestApproved(
  admin: SupabaseClient,
  bookingId: string,
): Promise<void> {
  await tellGuest(admin, bookingId, "request_approved");
}

export async function notifyRequestDeclined(
  admin: SupabaseClient,
  bookingId: string,
): Promise<void> {
  await tellGuest(admin, bookingId, "request_declined");
}

export async function notifyRequestExpired(
  admin: SupabaseClient,
  bookingId: string,
): Promise<void> {
  await tellGuest(admin, bookingId, "request_expired");
}

async function tellGuest(
  admin: SupabaseClient,
  bookingId: string,
  kind: "request_approved" | "request_declined" | "request_expired",
): Promise<void> {
  try {
    const booking = await loadRequest(admin, bookingId);
    if (!booking) return;

    const practitioner = await recipientFor(admin, booking.practitioner_id);
    if (!practitioner) return;

    await notify({
      kind,
      recipient: practitioner,
      subjectId: bookingId,
      bookingId,
      context: {
        spaceName: booking.spaces.name,
        when: formatWhen(new Date(booking.starts_at), booking.spaces.timezone),
        // The total, because this is the person paying it.
        amountCents: booking.total_cents,
        /*
         * Only on a decline, and only if the host wrote one. An approval's
         * note is an internal remark on a queue; passing it here would put it
         * in front of the guest, which is not what a host was writing it into.
         */
        note: kind === "request_declined" ? (booking.approval_note ?? undefined) : undefined,
      },
    });
  } catch (error) {
    console.error(`Request outcome notification failed for ${bookingId}:`, error);
  }
}

/**
 * What was declared, in words a host reads rather than a key.
 *
 * "Something else" is the one that matters: the host is deciding on the note,
 * not on the word "other", so the note is what goes in the message.
 */
function describePurpose(purpose: string | null, note?: string | null): string | undefined {
  if (!purpose) return undefined;
  const use = bookingUse(purpose);
  if (!use) return undefined;
  return use.key === "other" && note ? `${use.label} — ${note}` : use.label;
}

/**
 * Both sides of a new booking.
 *
 * Failures are swallowed on purpose. This runs after the money has already
 * moved, and throwing here would turn a delivered email into a failed booking
 * — the caller has nothing useful to do with the error, and the queue will
 * retry anything transient.
 */
export async function notifyBookingCreated(
  admin: SupabaseClient,
  bookingId: string,
): Promise<void> {
  try {
    const booking = await loadBooking(admin, bookingId);
    if (!booking) return;

    const when = formatWhen(new Date(booking.starts_at), booking.spaces.timezone);

    const [practitioner, host] = await Promise.all([
      recipientFor(admin, booking.practitioner_id),
      recipientFor(admin, booking.spaces.host_id),
    ]);

    if (practitioner) {
      await notify({
        kind: "booking_confirmed",
        recipient: practitioner,
        subjectId: bookingId,
        bookingId,
        context: { spaceName: booking.spaces.name, when, amountCents: booking.total_cents },
      });
    }

    if (host && !hasOptedOut(host, "host_new_booking")) {
      await notify({
        kind: "host_new_booking",
        recipient: host,
        subjectId: bookingId,
        bookingId,
        // The host's rate, never the total. What the practitioner paid is not
        // theirs to see — the same rule host_bookings() enforces in SQL.
        context: { spaceName: booking.spaces.name, when, amountCents: booking.host_rate_cents },
      });
    }
  } catch (error) {
    console.error(`Booking notifications failed for ${bookingId}:`, error);
  }
}

export async function notifyCancellation(
  admin: SupabaseClient,
  bookingId: string,
  actor: "practitioner" | "host",
  outcome: { chargedCents: number; refundedCents: number },
): Promise<void> {
  try {
    const booking = await loadBooking(admin, bookingId);
    if (!booking) return;

    const when = formatWhen(new Date(booking.starts_at), booking.spaces.timezone);

    // A practitioner cancelling tells the host; a host cancelling tells the
    // practitioner. Each side hears about the thing done to them.
    if (actor === "practitioner") {
      const [practitioner, host] = await Promise.all([
        recipientFor(admin, booking.practitioner_id),
        recipientFor(admin, booking.spaces.host_id),
      ]);

      if (practitioner) {
        await notify({
          kind: "cancelled_by_practitioner",
          recipient: practitioner,
          subjectId: bookingId,
          bookingId,
          context: {
            spaceName: booking.spaces.name,
            when,
            chargedCents: outcome.chargedCents,
            refundedCents: outcome.refundedCents,
          },
        });
      }
      if (host) {
        await notify({
          kind: "cancelled_by_practitioner",
          recipient: host,
          subjectId: `${bookingId}:host`,
          bookingId,
          context: { spaceName: booking.spaces.name, when },
        });
      }
      return;
    }

    const practitioner = await recipientFor(admin, booking.practitioner_id);
    if (!practitioner) return;

    await notify({
      kind: "cancelled_by_host",
      recipient: practitioner,
      subjectId: bookingId,
      bookingId,
      context: {
        spaceName: booking.spaces.name,
        when,
        chargedCents: outcome.chargedCents,
        refundedCents: outcome.refundedCents,
      },
    });
  } catch (error) {
    console.error(`Cancellation notifications failed for ${bookingId}:`, error);
  }
}

/**
 * The door code, once it has actually unlocked.
 *
 * The code itself is already available from the moment `access_code_revealed_at`
 * passes — the view handles that with no job involved. What needs a job is
 * *telling* someone, which is this, and it is the only notification in the app
 * that is worth a text message.
 *
 * Driven by comparing state to the clock, like the capture job: "which
 * bookings are open and unannounced", not "which became open since last time".
 */
export async function notifyAccessCodesReady(
  admin: SupabaseClient,
  now: Date,
): Promise<{ announced: number }> {
  const { data, error } = await admin
    .from("bookings")
    .select(
      "id, practitioner_id, starts_at, total_cents, host_rate_cents, access_code, spaces!inner(name, host_id, address_line, entry_instructions)",
    )
    .eq("status", "upcoming")
    /*
     * Paid for, which the two gates in the database have required since 0039
     * and this job never did.
     *
     * An abandoned checkout sits at `upcoming` with a reveal time already in
     * the past — the row is written before the card is — and the reaper only
     * runs on the same twice-daily cron. So the app screen correctly showed
     * nothing while this texted the door code, the address and the entry
     * instructions for a room nobody had paid for.
     */
    .not("captured_at", "is", null)
    .lte("access_code_revealed_at", now.toISOString())
    // Nothing to announce about a session that has already finished.
    .gte("starts_at", new Date(now.getTime() - 60 * 60 * 1000).toISOString());

  if (error) throw error;

  let announced = 0;

  // PostgREST types an embedded relation as an array even when the join is
  // one-to-one, so the shape has to be asserted rather than narrowed.
  for (const booking of (data ?? []) as unknown as BookingRow[]) {
    const practitioner = await recipientFor(admin, booking.practitioner_id);
    if (!practitioner) continue;

    // The dedupe key makes this safe to re-run: a booking already announced
    // collides and is skipped, so a job that runs hourly does not text
    // somebody hourly.
    const result = await notify({
      kind: "access_code_ready",
      recipient: practitioner,
      subjectId: booking.id,
      bookingId: booking.id,
      context: {
        spaceName: booking.spaces.name,
        when: formatWhen(new Date(booking.starts_at), booking.spaces.timezone),
        address: booking.spaces.address_line ?? undefined,
        accessCode: booking.access_code ?? undefined,
        entryInstructions: booking.spaces.entry_instructions ?? undefined,
      },
    });

    if (result.email === "sent" || result.sms === "sent") announced += 1;
  }

  return { announced };
}

/**
 * Rebuilds a queued message so the retry loop can send it again.
 *
 * Reads the booking fresh rather than replaying a stored body, so a retry
 * carries what is true now — and so no door code was ever copied into the
 * notifications table to begin with.
 */
export async function rebuildPending(admin: SupabaseClient) {
  return async (row: PendingNotification) => {
    const recipient = await recipientFor(admin, row.user_id);
    if (!recipient) return null;

    const to = row.channel === "email" ? recipient.email : recipient.phone;
    if (!to) return null;

    if (!row.booking_id) {
      // Kinds that are about a person rather than a booking carry no context
      // worth rebuilding; the subject line alone is still correct.
      return { to, message: render(row.kind as NotificationKind, { name: recipient.name }) };
    }

    const booking = await loadBooking(admin, row.booking_id);
    if (!booking) return null;

    return {
      to,
      message: render(row.kind as NotificationKind, {
        name: recipient.name,
        spaceName: booking.spaces.name,
        when: formatWhen(new Date(booking.starts_at), booking.spaces.timezone),
        address: booking.spaces.address_line ?? undefined,
        accessCode: booking.access_code ?? undefined,
        entryInstructions: booking.spaces.entry_instructions ?? undefined,
        amountCents: booking.total_cents,
      }),
    };
  };
}
