import type { SupabaseClient } from "@supabase/supabase-js";

import { expiresAt } from "../booking-approval";
import { bookingUse } from "../booking-use";
import { type Recipient, notify } from "./send";

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
  const [profileResult, authResult] = await Promise.all([
    admin
      .from("profiles")
      .select(
        "display_name, phone, phone_verified_at, notify_sms, notify_bookings, notify_payouts",
      )
      .eq("id", userId)
      .maybeSingle(),
    admin.auth.admin.getUserById(userId),
  ]);

  if (profileResult.error) throw profileResult.error;
  if (authResult.error) throw authResult.error;

  const profile = profileResult.data;
  const auth = authResult.data;

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
  ends_at: string;
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

interface CancelledBookingRow extends BookingRow {
  cancelled_by: "practitioner" | "host" | null;
  captured_at: string | null;
  authorized_at: string | null;
  refunded_cents: number | null;
  financial_resolution_state: string;
}

interface PaidBookingRow {
  id: string;
  starts_at: string;
  host_rate_cents: number;
  host_paid_at: string | null;
  stripe_transfer_id: string | null;
  spaces: {
    name: string;
    host_id: string;
    timezone: string;
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
  const { data, error } = await admin
    .from("bookings")
    .select(
      "id, practitioner_id, starts_at, ends_at, total_cents, host_rate_cents, access_code, spaces!inner(name, host_id, timezone, address_line, entry_instructions)",
    )
    .eq("id", bookingId)
    .not("captured_at", "is", null)
    .eq("status", "upcoming")
    .is("cancelled_at", null)
    .in("financial_resolution_state", ["not_required", "resolved"])
    .maybeSingle();

  if (error) throw error;

  return (data as BookingRow | null) ?? null;
}

/**
 * Cancellation is loaded after the status changes, so it must not use the
 * active-booking gate above. It still selects only the immutable facts needed
 * for the two receipts and never exposes them to a browser.
 */
async function loadCancelledBooking(
  admin: SupabaseClient,
  bookingId: string,
): Promise<CancelledBookingRow | null> {
  const { data, error } = await admin
    .from("bookings")
    .select(
      "id, practitioner_id, starts_at, ends_at, total_cents, host_rate_cents, access_code, cancelled_by, captured_at, authorized_at, refunded_cents, financial_resolution_state, spaces!inner(name, host_id, timezone, address_line, entry_instructions)",
    )
    .eq("id", bookingId)
    .in("status", ["cancelled_by_practitioner", "cancelled_by_host"])
    .not("cancelled_by", "is", null)
    .eq("financial_resolution_state", "resolved")
    .maybeSingle();

  if (error) throw error;

  return (data as CancelledBookingRow | null) ?? null;
}

/**
 * A payout receipt may only be built from both halves of the durable marker.
 * Stripe returning a transfer is not enough: a process can stop before that
 * fact reaches Postgres, and only persisted state is recoverable by a worker.
 */
async function loadPaidBooking(
  admin: SupabaseClient,
  bookingId: string,
): Promise<PaidBookingRow | null> {
  const { data, error } = await admin
    .from("bookings")
    .select(
      "id, starts_at, host_rate_cents, host_paid_at, stripe_transfer_id, spaces!inner(name, host_id, timezone)",
    )
    .eq("id", bookingId)
    .not("host_paid_at", "is", null)
    .not("stripe_transfer_id", "is", null)
    .maybeSingle();

  if (error) throw error;
  return (data as PaidBookingRow | null) ?? null;
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
      status: string;
      approval_state: string;
      captured_at: string | null;
      authorized_at: string | null;
      cancelled_at: string | null;
      financial_resolution_state: string;
    })
  | null
> {
  const { data, error } = await admin
    .from("bookings")
    .select(
      "id, practitioner_id, starts_at, ends_at, created_at, total_cents, host_rate_cents, access_code, purpose, purpose_note, attendee_count, approval_note, status, approval_state, captured_at, authorized_at, cancelled_at, financial_resolution_state, spaces!inner(name, host_id, timezone, address_line, entry_instructions)",
    )
    .eq("id", bookingId)
    .maybeSingle();

  if (error) throw error;

  return (data as never) ?? null;
}

/** A host, told somebody wants their room and by when they have to answer. */
export async function notifyRequestMade(
  admin: SupabaseClient,
  bookingId: string,
  options: { propagate?: boolean } = {},
): Promise<void> {
  try {
    const booking = await loadRequest(admin, bookingId);
    if (
      !booking ||
      booking.status !== "upcoming" ||
      booking.approval_state !== "pending" ||
      !booking.authorized_at ||
      booking.captured_at !== null ||
      booking.cancelled_at !== null ||
      booking.financial_resolution_state !== "not_required"
    ) return;

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
      expiresAt: deadline,
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
    if (options.propagate) throw error;
  }
}

/**
 * Tell the practitioner their request is real and waiting.
 *
 * The `authorized_at` gate is intentionally the same one the Stripe webhook
 * writes after `amount_capturable_updated`. A PaymentIntent id alone only
 * proves that a checkout form was created; it does not prove any funds are
 * held and must never produce this receipt.
 */
export async function notifyRequestSubmitted(
  admin: SupabaseClient,
  bookingId: string,
  options: { propagate?: boolean } = {},
): Promise<void> {
  try {
    const booking = await loadRequest(admin, bookingId);
    if (
      !booking ||
      booking.status !== "upcoming" ||
      booking.approval_state !== "pending" ||
      !booking.authorized_at ||
      booking.captured_at !== null ||
      booking.cancelled_at !== null ||
      booking.financial_resolution_state !== "not_required"
    ) return;

    const practitioner = await recipientFor(admin, booking.practitioner_id);
    if (!practitioner) return;

    const zone = booking.spaces.timezone;
    const deadline = expiresAt({
      approvalState: "pending",
      requestedAt: new Date(booking.created_at),
      startsAt: new Date(booking.starts_at),
    });

    await notify({
      kind: "request_submitted",
      recipient: practitioner,
      subjectId: bookingId,
      bookingId,
      expiresAt: deadline,
      context: {
        spaceName: booking.spaces.name,
        when: formatWhen(new Date(booking.starts_at), zone),
        amountCents: booking.total_cents,
        deadline: formatWhen(deadline, zone),
      },
    });
  } catch (error) {
    console.error(`Request-submitted notification failed for ${bookingId}:`, error);
    if (options.propagate) throw error;
  }
}

/** A host receipt only after the confirmed transfer is durably recorded. */
export async function notifyHostPayoutSent(
  admin: SupabaseClient,
  bookingId: string,
  options: { propagate?: boolean } = {},
): Promise<void> {
  try {
    const booking = await loadPaidBooking(admin, bookingId);
    if (!booking?.host_paid_at || !booking.stripe_transfer_id) return;

    const host = await recipientFor(admin, booking.spaces.host_id);
    if (!host || hasOptedOut(host, "host_payout_sent")) return;

    await notify({
      kind: "host_payout_sent",
      recipient: host,
      subjectId: bookingId,
      bookingId,
      context: {
        spaceName: booking.spaces.name,
        when: formatWhen(new Date(booking.starts_at), booking.spaces.timezone),
        amountCents: booking.host_rate_cents,
      },
    });
  } catch (error) {
    console.error(`Host payout notification failed for ${bookingId}:`, error);
    if (options.propagate) throw error;
  }
}

/** The nudge halfway to the deadline. Deduped by kind and subject, so once. */
export async function notifyRequestReminder(
  admin: SupabaseClient,
  bookingId: string,
): Promise<void> {
  try {
    const booking = await loadRequest(admin, bookingId);
    if (
      !booking ||
      booking.status !== "upcoming" ||
      booking.approval_state !== "pending" ||
      !booking.authorized_at ||
      booking.cancelled_at !== null ||
      booking.financial_resolution_state !== "not_required"
    ) return;

    const host = await recipientFor(admin, booking.spaces.host_id);
    if (!host || hasOptedOut(host, "host_new_request")) return;

    const zone = booking.spaces.timezone;
    const deadline = expiresAt({
      approvalState: "pending",
      requestedAt: new Date(booking.created_at),
      startsAt: new Date(booking.starts_at),
    });

    await notify({
      kind: "host_request_reminder",
      recipient: host,
      subjectId: bookingId,
      bookingId,
      expiresAt: deadline,
      context: {
        spaceName: booking.spaces.name,
        when: formatWhen(new Date(booking.starts_at), zone),
        purpose: describePurpose(booking.purpose, booking.purpose_note),
        deadline: formatWhen(deadline, zone),
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
  options: { propagate?: boolean } = {},
): Promise<void> {
  await tellGuest(admin, bookingId, "request_approved", options.propagate);
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
  propagate = false,
): Promise<void> {
  try {
    const booking = await loadRequest(admin, bookingId);
    if (!booking) return;

    const stateMatches =
      (kind === "request_approved" &&
        booking.approval_state === "approved" &&
        booking.status === "upcoming" &&
        booking.captured_at !== null &&
        booking.cancelled_at === null &&
        ["not_required", "resolved"].includes(booking.financial_resolution_state)) ||
      (kind === "request_declined" &&
        booking.approval_state === "declined" &&
        booking.status === "cancelled_by_host" &&
        booking.financial_resolution_state === "resolved") ||
      (kind === "request_expired" &&
        booking.approval_state === "expired" &&
        booking.status === "cancelled_by_host" &&
        booking.financial_resolution_state === "resolved");
    if (!stateMatches) return;

    const practitioner = await recipientFor(admin, booking.practitioner_id);
    if (!practitioner) return;

    await notify({
      kind,
      recipient: practitioner,
      subjectId: bookingId,
      bookingId,
      expiresAt: kind === "request_approved" ? booking.starts_at : undefined,
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
    if (propagate) throw error;
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
 * This is called only from Stripe's webhook. An outbox insert failure must
 * escape so Stripe retries the event; provider failures already have a durable
 * row and therefore return normally for the worker to recover.
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
        expiresAt: booking.starts_at,
        context: { spaceName: booking.spaces.name, when, amountCents: booking.total_cents },
      });
    }

    if (host && !hasOptedOut(host, "host_new_booking")) {
      await notify({
        kind: "host_new_booking",
        recipient: host,
        subjectId: bookingId,
        bookingId,
        expiresAt: booking.starts_at,
        // The host's rate, never the total. What the practitioner paid is not
        // theirs to see — the same rule host_bookings() enforces in SQL.
        context: { spaceName: booking.spaces.name, when, amountCents: booking.host_rate_cents },
      });
    }
  } catch (error) {
    console.error(`Booking notifications failed for ${bookingId}:`, error);
    throw error;
  }
}

/**
 * Tell the other side of a booking that a message is waiting.
 *
 * Names the booking and nothing else — never the message text (masked or not),
 * the address, or a door code (see the new_message wording). Deduped by the
 * message id, so a retried send never notifies twice, while a genuinely new
 * message always does. The recipient is whichever participant did not send.
 */
export async function notifyNewMessage(
  admin: SupabaseClient,
  bookingId: string,
  senderId: string,
  messageId: string,
): Promise<void> {
  try {
    const { data } = await admin
      .from("bookings")
      .select("practitioner_id, starts_at, ends_at, status, spaces!inner(name, host_id, timezone)")
      .eq("id", bookingId)
      .maybeSingle();

    const booking = data as unknown as {
      practitioner_id: string;
      starts_at: string;
      ends_at: string;
      status: string;
      spaces: { name: string; host_id: string; timezone: string };
    } | null;
    if (!booking || booking.status !== "upcoming") return;

    const recipientId =
      senderId === booking.practitioner_id ? booking.spaces.host_id : booking.practitioner_id;
    if (!recipientId || recipientId === senderId) return;

    const recipient = await recipientFor(admin, recipientId);
    if (!recipient || hasOptedOut(recipient, "new_message")) return;

    await notify({
      kind: "new_message",
      recipient,
      // Per message, so a retry collides on the dedupe key and a new message does
      // not — never a permanent per-thread dedupe that would notify once only.
      subjectId: messageId,
      bookingId,
      expiresAt: booking.ends_at,
      context: {
        spaceName: booking.spaces.name,
        when: formatWhen(new Date(booking.starts_at), booking.spaces.timezone),
      },
    });
  } catch (error) {
    console.error(`New-message notification failed for ${bookingId}:`, error);
  }
}

export async function notifyCancellation(
  admin: SupabaseClient,
  bookingId: string,
  actor: "practitioner" | "host",
  _outcome: { chargedCents: number; refundedCents: number },
): Promise<void> {
  try {
    const booking = await loadCancelledBooking(admin, bookingId);
    if (
      !booking ||
      booking.cancelled_by !== actor ||
      booking.financial_resolution_state !== "resolved" ||
      (!booking.captured_at && !booking.authorized_at)
    ) return;

    // Settlement copy comes from the durable row, never from a caller's stale
    // pre-update calculation. This makes concurrent cancellation attempts
    // converge on the actor and money Stripe actually recorded.
    const refundedCents = booking.refunded_cents ?? 0;
    const chargedCents = booking.captured_at
      ? Math.max(0, booking.total_cents - refundedCents)
      : 0;

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
            chargedCents,
            refundedCents,
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
        chargedCents,
        refundedCents,
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
      "id, practitioner_id, starts_at, ends_at, total_cents, host_rate_cents, access_code, spaces!inner(name, host_id, timezone, address_line, entry_instructions)",
    )
    .eq("status", "upcoming")
    .is("cancelled_at", null)
    .in("financial_resolution_state", ["not_required", "resolved"])
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
    .not("access_code", "is", null)
    .lte("access_code_revealed_at", now.toISOString())
    // Nothing to announce once the booked interval has ended.
    .gt("ends_at", now.toISOString());

  if (error) throw error;

  let announced = 0;

  // PostgREST types an embedded relation as an array even when the join is
  // one-to-one, so the shape has to be asserted rather than narrowed.
  for (const booking of (data ?? []) as unknown as BookingRow[]) {
    try {
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
        expiresAt: booking.ends_at,
        defer: true,
        context: {
          spaceName: booking.spaces.name,
          when: formatWhen(new Date(booking.starts_at), booking.spaces.timezone),
          address: booking.spaces.address_line ?? undefined,
          accessCode: booking.access_code ?? undefined,
          entryInstructions: booking.spaces.entry_instructions ?? undefined,
        },
      });

      if (
        result.email === "sent" || result.email === "queued" ||
        result.sms === "sent" || result.sms === "queued"
      ) announced += 1;
    } catch (failure) {
      // One corrupt recipient or transient auth lookup must not strand every
      // later door code behind it. The row remains eligible for the next run.
      console.error(`Access-code notification failed for ${booking.id}:`, failure);
    }
  }

  return { announced };
}

/**
 * Repair a crash after a direct booking was captured but before both sides'
 * independent outbox rows were claimed. Existing rows collide on their stable
 * dedupe keys, so a one-sided crash sends only the receipt that is missing.
 */
export async function reconcileBookingConfirmationNotifications(
  admin: SupabaseClient,
  now = new Date(),
): Promise<{ reconciled: number }> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin.rpc("list_booking_confirmation_notification_gaps", {
    p_since: since,
    p_now: now.toISOString(),
    p_limit: 100,
  });
  if (error) throw error;

  let reconciled = 0;
  for (const booking of data ?? []) {
    await notifyBookingCreated(admin, booking.id);
    reconciled += 1;
  }
  return { reconciled };
}

/**
 * Reconcile durable cancellation state with the outbox.
 *
 * A process can stop after the booking and Stripe settlement are durable but
 * before the immediate notification call. This bounded sweep makes that crash
 * recoverable; the normal dedupe key turns already-sent rows into no-ops.
 */
export async function reconcileCancellationNotifications(
  admin: SupabaseClient,
  now = new Date(),
): Promise<{ reconciled: number }> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin.rpc("list_cancellation_notification_gaps", {
    p_since: since,
    p_limit: 100,
  });
  if (error) throw error;

  let reconciled = 0;
  for (const booking of data ?? []) {
    // The abandoned-checkout reaper uses the same cancelled status, but those
    // rows never became bookings and must not generate a cancellation receipt.
    if (
      (!booking.captured_at && !booking.authorized_at) ||
      (booking.cancelled_by !== "host" && booking.cancelled_by !== "practitioner")
    ) continue;

    const actor =
      booking.cancelled_by === "host" || booking.status === "cancelled_by_host"
        ? "host"
        : "practitioner";
    const refundedCents = booking.refunded_cents ?? 0;
    await notifyCancellation(admin, booking.id, actor, {
      chargedCents: booking.captured_at
        ? Math.max(0, booking.total_cents - refundedCents)
        : 0,
      refundedCents,
    });
    reconciled += 1;
  }

  return { reconciled };
}

/** Repair a crash between a durable request outcome and its practitioner receipt. */
export async function reconcileRequestOutcomeNotifications(
  admin: SupabaseClient,
  now = new Date(),
): Promise<{ reconciled: number }> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin.rpc("list_request_outcome_notification_gaps", {
    p_since: since,
    p_limit: 100,
  });
  if (error) throw error;

  let reconciled = 0;
  for (const request of data ?? []) {
    if (request.approval_state === "approved") {
      await notifyRequestApproved(admin, request.id);
      reconciled += 1;
    } else if (request.approval_state === "declined") {
      await notifyRequestDeclined(admin, request.id);
      reconciled += 1;
    } else if (request.approval_state === "expired") {
      await notifyRequestExpired(admin, request.id);
      reconciled += 1;
    }
  }

  return { reconciled };
}

/**
 * Repair the process gap after Stripe authorization became durable but before
 * either side's outbox row was claimed. Both calls are deduped independently,
 * so this also repairs the one-sided crash between the two receipts.
 */
export async function reconcileRequestSubmissionNotifications(
  admin: SupabaseClient,
  now = new Date(),
): Promise<{ reconciled: number }> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin.rpc("list_request_submission_notification_gaps", {
    p_since: since,
    p_now: now.toISOString(),
    p_limit: 100,
  });
  if (error) throw error;

  let reconciled = 0;
  for (const request of data ?? []) {
    await notifyRequestSubmitted(admin, request.id);
    await notifyRequestMade(admin, request.id);
    reconciled += 1;
  }
  return { reconciled };
}

/** Repair a crash after durable payout state and before the host outbox claim. */
export async function reconcileHostPayoutNotifications(
  admin: SupabaseClient,
  now = new Date(),
): Promise<{ reconciled: number }> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin.rpc("list_host_payout_notification_gaps", {
    p_since: since,
    p_limit: 100,
  });
  if (error) throw error;

  let reconciled = 0;
  for (const payout of data ?? []) {
    await notifyHostPayoutSent(admin, payout.id);
    reconciled += 1;
  }
  return { reconciled };
}
