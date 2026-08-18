import { formatCents } from "../money";

/**
 * What each notification says, as pure functions over plain data.
 *
 * Separate from sending so the wording can be tested without a provider, an
 * API key, or a network — which matters more here than usual, because the
 * failure mode of a transactional message is not an exception. It is a correct
 * delivery of the wrong number to a real person.
 */

/**
 * Every kind of message the app sends. Adding one here forces the switch in
 * `render` to handle it, which is the point of the type.
 *
 * A list rather than a bare union so it exists at runtime too. The tests that
 * check every kind has wording used to keep their own copy of this, and a
 * hand-kept copy of a list is a list that falls behind — four kinds had been
 * added and none of them were being checked.
 */
export const NOTIFICATION_KINDS = [
  "booking_confirmed",
  "host_new_booking",
  "host_new_request",
  "host_request_reminder",
  "request_approved",
  "request_declined",
  "request_expired",
  "access_code_ready",
  "cancelled_by_practitioner",
  "cancelled_by_host",
  "reliability_warning",
  "reliability_suspended",
  "payout_failed",
  "safety_escalation",
  "account_change_requested",
  "refund_requested",
  "refund_decided",
  "refund_taken_back",
  "claim_filed",
  "claim_decided",
  "staff_waiting",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface Message {
  subject: string;
  /** Plain text. Deliberately the primary form — see `html` below. */
  body: string;
  /**
   * The same message at SMS length, or null when this kind never goes by SMS.
   *
   * Only two kinds do. SMS is metered and interrupts someone's day, so it is
   * reserved for the moments where being told an hour later is too late: a
   * door code when you are already travelling to the door, and a host
   * cancelling out from under you. Everything else is email, where a longer
   * explanation is an advantage rather than a cost.
   */
  sms: string | null;

  /**
   * A ready-made HTML body, for the few messages that are laid out rather than
   * written.
   *
   * Everything the app sends is a paragraph or two, and `toHtml` wrapping the
   * plain text is the right answer for those — one body to keep correct, and
   * no chance of the two versions drifting. A tool result is a score, a band
   * and a breakdown, which is a table, so it brings its own.
   *
   * Optional on purpose: absent means the text is the message, which is what
   * every existing kind wants.
   */
  html?: string;
}

export interface MessageContext {
  /** Who is being written to, for the greeting. */
  name?: string;
  /*
   * The staff digest. Pre-composed by the caller, because deciding what is
   * worth an interruption is a rule with its own tests — see admin/attention.ts
   * — and this file's job is wording, not judgement.
   */
  summary?: string;
  items?: string;
  queueUrl?: string;
  spaceName?: string;
  /** Pre-formatted in the recipient's own timezone by the caller. */
  when?: string;
  address?: string;
  accessCode?: string;
  entryInstructions?: string;
  amountCents?: number;
  /**
   * What the practitioner ends up paying, and what actually goes back to their
   * card. Two fields rather than one, because they answer different questions
   * and a cancellation can move both: cancel early and the charge falls to zero
   * while the whole amount is refunded; cancel late and nothing is refunded
   * because the studio kept the hour free. A message built from one number
   * would get one of those two cases wrong.
   */
  chargedCents?: number;
  refundedCents?: number;
  /** Reliability: how many late cancellations, and what happens next. */
  strikes?: number;
  limit?: number;
  until?: string;
  reason?: string;
  /** The reviewer's own words, passed through rather than summarised. */
  note?: string;
  /** Which side wrote it, so staff know who they are reading. */
  role?: string;
  /** A request: what was declared, and how long the host has left. */
  purpose?: string;
  attendees?: number;
  deadline?: string;
}

/**
 * The brand is "Minimum Stress". "Spaces" is what this product is, not what
 * the company is called, and it does not belong at the bottom of a message to
 * someone who has only ever seen the shorter name.
 */
const SIGN_OFF = "— Minimum Stress";

function greeting(name?: string): string {
  return name ? `Hi ${name},` : "Hi,";
}

/** Joins paragraphs with the blank line that makes plain text readable. */
function lines(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join("\n\n");
}

/**
 * What happened to the money, in the practitioner's own terms.
 *
 * Three outcomes, and only one of them is a refund. Cancelling more than 24
 * hours ahead releases an authorization that was never captured — no money
 * ever left, so there is no credit to watch for on a statement. Saying
 * "refunded" there would have people waiting for something that is not coming,
 * and then writing in to ask where it is.
 */
function settlement(context: MessageContext): string | null {
  if (context.refundedCents) {
    return `${formatCents(context.refundedCents)} is on its way back to your card. Refunds usually appear within a few working days.`;
  }

  if (context.chargedCents) {
    return `This was inside the 24-hour window, so the session is charged in full — ${formatCents(context.chargedCents)}. The room was held for you and the studio could not re-let the hour.`;
  }

  if (context.chargedCents === 0) {
    return `You are refunded in full. It usually reaches your card within a few working days.`;
  }

  return null;
}

export function render(kind: NotificationKind, context: MessageContext): Message {
  const { name, address, accessCode, entryInstructions } = context;

  /**
   * Nothing is interpolated raw.
   *
   * A missing field is not hypothetical — a listing can be renamed, a row can
   * be read back thin — and the cost of getting this wrong is not an exception
   * anyone would see. It is "Your session at undefined is confirmed for
   * undefined" arriving in a real inbox. So every slot degrades to language
   * that still reads like a sentence.
   */
  const spaceName = context.spaceName ?? "your space";
  const when = context.when ?? "the time you booked";

  switch (kind) {
    case "booking_confirmed":
      return {
        subject: context.when ? `Booked: ${spaceName} on ${when}` : `Booking confirmed: ${spaceName}`,
        body: lines(
          greeting(name),
          `Your session at ${spaceName} is confirmed for ${when}.`,
          context.amountCents !== undefined
            ? `Total ${formatCents(context.amountCents)}, including our service fee, charged to your card now. Cancel more than 24 hours ahead and all of it is refunded.`
            : null,
          /*
           * Two windows, not one. The way in opens a day ahead; only the code
           * waits until just before the session. The booking screen was
           * corrected for exactly this and the email kept the old sentence.
           */
          `The way in appears in this app the day before, and your door code shortly before you start.`,
          SIGN_OFF,
        ),
        sms: null,
      };

    case "host_new_booking":
      return {
        subject: context.when ? `New booking: ${spaceName}, ${when}` : `New booking: ${spaceName}`,
        body: lines(
          greeting(name),
          `${spaceName} is booked for ${when}.`,
          context.amountCents !== undefined
            ? `You receive ${formatCents(context.amountCents)} for this session — your rate in full. Payouts arrive about two business days after the session.`
            : null,
          `Nothing to do unless something changes at your end. If it does, tell us as early as you can: late cancellations count against a studio the same way they count against a practitioner.`,
          SIGN_OFF,
        ),
        sms: null,
      };

    /**
     * A request landing in a host's queue.
     *
     * Everything they need to decide is in the message, because a host reading
     * it on a phone should be able to make the call without opening anything —
     * what the room is for, how many people, when, and by when they have to
     * say. Vague here means the request sits until it expires.
     */
    case "host_new_request":
      return {
        subject: `Booking request: ${spaceName}, ${when}`,
        body: lines(
          greeting(name),
          `Somebody has asked to book ${spaceName} for ${when}.`,
          context.purpose ? `What for: ${context.purpose}` : null,
          context.attendees !== undefined
            ? `People coming: ${context.attendees}, including them`
            : null,
          context.amountCents !== undefined
            ? `You would receive ${formatCents(context.amountCents)} — your rate in full.`
            : null,
          /*
           * The deadline is stated because a request that quietly expires
           * looks, to a host, exactly like one that was never sent.
           */
          context.deadline
            ? `Approve or decline in the app. If nobody answers by ${context.deadline}, the request expires on its own and the hour goes back on your calendar.`
            : `Approve or decline in the app.`,
          `Their card is held for this, not charged. Nothing is taken unless you approve.`,
          SIGN_OFF,
        ),
        sms: null,
      };

    /** Halfway through, once — not a drip. */
    case "host_request_reminder":
      return {
        subject: `Still waiting: ${spaceName}, ${when}`,
        body: lines(
          greeting(name),
          `A booking request for ${spaceName} on ${when} has not been answered yet.`,
          context.purpose ? `What for: ${context.purpose}` : null,
          context.deadline
            ? `It expires by itself at ${context.deadline}, and the hour is unavailable to anybody else until then.`
            : `The hour is unavailable to anybody else until it is answered.`,
          `Declining is a perfectly good answer, and it costs you nothing.`,
          SIGN_OFF,
        ),
        sms: null,
      };

    case "request_approved":
      return {
        subject: `Confirmed: ${spaceName}, ${when}`,
        body: lines(
          greeting(name),
          `The host said yes. Your session at ${spaceName} on ${when} is confirmed.`,
          context.amountCents !== undefined
            ? `${formatCents(context.amountCents)} has now been taken from the card you used. Cancel more than 24 hours ahead and all of it is refunded.`
            : null,
          `The way in appears in this app the day before, and your door code shortly before you start.`,
          SIGN_OFF,
        ),
        sms: null,
      };

    /*
     * A decline is not a failure and is not written as one. No apology on the
     * host's behalf, no reason invented — a host is entitled to say no about
     * their own room, and dressing it up would only invite a reply asking why.
     */
    case "request_declined":
      return {
        subject: `Not this time: ${spaceName}, ${when}`,
        body: lines(
          greeting(name),
          `The host is not able to take your request for ${spaceName} on ${when}.`,
          context.note ? `They said: ${context.note}` : null,
          `Nothing was charged. The hold on your card has been released, so there is nothing to wait for on a statement.`,
          `The hour is back on their calendar, and other spaces are open for that time.`,
          SIGN_OFF,
        ),
        sms: null,
      };

    case "request_expired":
      return {
        subject: `Expired: ${spaceName}, ${when}`,
        body: lines(
          greeting(name),
          `Your request for ${spaceName} on ${when} was not answered in time, so it has expired.`,
          `Nothing was charged. The hold on your card has been released, so there is nothing to wait for on a statement.`,
          `Some spaces confirm straight away — those book without waiting on anybody.`,
          SIGN_OFF,
        ),
        sms: null,
      };

    /**
     * The one message people are standing outside a locked door waiting for.
     * Everything that gets someone through it is in the first two lines, and
     * the SMS carries the code itself rather than telling them to go and look.
     */
    case "access_code_ready":
      return {
        subject: `Your door code for ${spaceName}`,
        body: lines(
          greeting(name),
          `You are in at ${spaceName} at ${when}.`,
          address ? `Address: ${address}` : null,
          accessCode ? `Door code: ${accessCode}` : null,
          entryInstructions || null,
          `Please leave the room as you found it, and reset anything you moved.`,
          SIGN_OFF,
        ),
        sms: [spaceName, address ? `— ${address}` : null, accessCode ? `Code ${accessCode}` : null]
          .filter(Boolean)
          .join(" "),
      };

    case "cancelled_by_practitioner":
      return {
        subject: context.when ? `Cancelled: ${spaceName} on ${when}` : `Cancelled: ${spaceName}`,
        body: lines(
          greeting(name),
          `Your booking at ${spaceName} on ${when} is cancelled.`,
          settlement(context),
          SIGN_OFF,
        ),
        sms: null,
      };

    /**
     * The host pulled out. This is the one where the app owes someone an
     * apology and something concrete, in that order.
     */
    case "cancelled_by_host":
      return {
        subject: `Your ${spaceName} session was cancelled by the studio`,
        body: lines(
          greeting(name),
          `The studio has cancelled your session at ${spaceName} on ${when}.`,
          context.refundedCents
            ? `${formatCents(context.refundedCents)} is refunded in full — you are never left out of pocket when a studio cancels. It usually reaches your card within a few working days.`
            : `You are not charged. Your payment had not gone through for this booking, so there is nothing to refund.`,
            null,
          `This counts against the studio's record with us. Repeated late cancellations suspend a studio from taking new bookings.`,
          SIGN_OFF,
        ),
        // One line, no paragraph break: a blank line in a text message is
        // wasted length in a format that charges by the character. And it has
        // to agree with the email above — "full refund" in a text while the
        // email says nothing was taken is the app contradicting itself to the
        // same person twice in one minute.
        // Both branches read the same field for exactly that reason.
        sms: [
          `${spaceName} cancelled your ${when} session.`,
          context.refundedCents ? `Refunded in full.` : `You are not charged.`,
          `Details in the app.`,
        ].join(" "),
      };

    /**
     * Said before it bites, not after. The sentence structure depends on the
     * counts, so each clause is dropped rather than filled with a guess.
     */
    case "reliability_warning":
      return {
        subject: "A note about last-minute cancellations",
        body: lines(
          greeting(name),
          context.strikes
            ? `You have cancelled ${context.strikes} sessions inside 24 hours in the last 90 days.`
            : `You have cancelled several sessions inside 24 hours in the last 90 days.`,
          context.limit
            ? `We are telling you now rather than after the fact: at ${context.limit}, new bookings pause for two weeks. Anything already booked always goes ahead — a suspension never cancels a session someone is counting on.`
            : `We are telling you now rather than after the fact: a few more and new bookings pause for two weeks. Anything already booked always goes ahead — a suspension never cancels a session someone is counting on.`,
          `The count is rolling, so it falls away as those cancellations age past 90 days.`,
          SIGN_OFF,
        ),
        sms: null,
      };

    case "reliability_suspended":
      return {
        subject: "New bookings paused for two weeks",
        body: lines(
          greeting(name),
          [
            context.strikes
              ? `After ${context.strikes} late cancellations in 90 days, new bookings are paused`
              : `After repeated late cancellations, new bookings are paused`,
            context.until ? ` until ${context.until}.` : ` for two weeks.`,
          ].join(""),
          `Every session already in your calendar goes ahead as normal. This only stops new ones.`,
          `If you think this is wrong, reply to this email and a person will read it.`,
          SIGN_OFF,
        ),
        sms: null,
      };

    /**
     * Not to a user — to whoever is on call.
     *
     * Deliberately plain and complete. This is the message that decides
     * whether somebody looks at a report tonight or on Monday, and a subject
     * line that hides the severity behind politeness gets read on Monday.
     */
    /**
     * Somebody has asked for their money back, and this goes to the studio.
     *
     * Written as a question rather than an accusation. The studio is being
     * asked what happened, not told what they did — nothing has been decided,
     * and a message that reads like a verdict makes an honest host defensive
     * before they have said a word.
     */
    case "refund_requested":
      return {
        subject: `A refund was requested — ${spaceName}`,
        body: lines(
          greeting(name),
          `Somebody who booked ${spaceName} on ${when} has asked for a refund.`,
          `Their reason: ${context.reason ?? "not given"}.`,
          context.note ? `They wrote:

"${context.note}"` : "They left no detail.",
          "Nothing has been decided. Open the booking in the app and tell us what happened from your side — we read both accounts before anything moves.",
          "If we do not hear from you in two days it goes to us to decide on what we have.",
          SIGN_OFF,
        ),
        sms: null,
      };

    /**
     * The answer, with the reasoning attached.
     *
     * A refusal that explains itself is arguable; one that does not is just a
     * wall, and the person on the other side of it writes to their bank
     * instead — which costs everyone more than the refund would have.
     */
    case "refund_decided":
      return {
        subject:
          (context.refundedCents ?? 0) > 0
            ? `Refunded ${formatCents(context.refundedCents ?? 0)} — ${spaceName}`
            : `About your refund request — ${spaceName}`,
        body: lines(
          greeting(name),
          (context.refundedCents ?? 0) > 0
            ? `${formatCents(context.refundedCents ?? 0)} is on its way back to the card you paid with. It usually lands in five to ten days, depending on your bank.`
            : `We are not refunding this one.`,
          context.note ? `Why: ${context.note}` : null,
          "If you think this is wrong, reply to this email and a person will read it.",
          SIGN_OFF,
        ),
        sms: null,
      };

    /**
     * The host's half of a refund, and the only message in this file that
     * tells somebody money has left their account.
     *
     * It exists because the alternative is silent: a refund on a session that
     * was already paid out reverses the host's transfer, and until this was
     * written the host found out by reading their bank statement. A studio
     * that loses forty-five dollars without being told assumes theft, and is
     * right to.
     */
    case "refund_taken_back":
      return {
        subject: `${formatCents(context.amountCents ?? 0)} returned to a practitioner — ${spaceName}`,
        body: lines(
          greeting(name),
          `We refunded the session at ${spaceName} on ${when}, and because you had already been paid for it, ${formatCents(context.amountCents ?? 0)} has been taken back from your account.`,
          context.note ? `Why: ${context.note}` : null,
          "Your standing is unchanged. This is the same money going back to the card that paid it.",
          "If you think this is wrong, reply to this email and a person will read it.",
          SIGN_OFF,
        ),
        sms: null,
      };

    /**
     * A studio says a session left the room worse than it found it, and this
     * goes to the practitioner.
     *
     * Written as a question. Nothing has been decided and nothing has been
     * charged — and a message that reads like a bill makes somebody who did
     * nothing wrong reach for their bank rather than for the reply button.
     */
    case "claim_filed":
      return {
        subject: `About your session at ${spaceName}`,
        body: lines(
          greeting(name),
          `The studio has raised something about your session at ${spaceName} on ${when}.`,
          `What they reported: ${context.reason ?? "not given"}.`,
          context.note ? `They wrote:

"${context.note}"` : "They left no detail.",
          context.amountCents !== undefined
            ? `If it is upheld, ${formatCents(context.amountCents)} would be charged to the card you booked with.`
            : "If it is upheld, an amount would be charged to the card you booked with.",
          "Nothing has been charged and nothing is decided. Open the booking and tell us what happened from your side — we read both accounts before anything moves.",
          SIGN_OFF,
        ),
        sms: null,
      };

    /**
     * The answer, to both sides, with the number and the reasoning.
     *
     * "Uncollectable" is said plainly rather than dressed up. A host whose
     * claim was upheld but whose money did not arrive needs to know which of
     * those two things happened, because only one of them is arguable.
     */
    case "claim_decided":
      return {
        subject: `About the claim on ${spaceName}`,
        body: lines(
          greeting(name),
          (context.amountCents ?? 0) > 0
            ? `${formatCents(context.amountCents ?? 0)} was charged for the session at ${spaceName} on ${when}.`
            : `Nothing was charged for the session at ${spaceName} on ${when}.`,
          context.note ? `Why: ${context.note}` : null,
          context.reason
            ? `The card could not be charged: ${context.reason}. We are not able to collect this on your behalf — your own insurer is the next step, and everything on record is available to you.`
            : null,
          "If you think this is wrong, reply to this email and a person will read it.",
          SIGN_OFF,
        ),
        sms: null,
      };

    case "safety_escalation":
      return {
        subject:
          context.reason === "safety"
            ? `SAFETY CONCERN reported — ${spaceName}`
            : `${context.strikes ?? "Low"}-star review needs review — ${spaceName}`,
        body: lines(
          context.reason === "safety"
            ? "A safety concern was reported on a completed session."
            : context.strikes !== undefined
              ? `A session was rated ${context.strikes} out of 5.`
              : "A session was rated low enough to need reading.",
          `Space: ${spaceName}`,
          `Reported by: the ${context.role === "host" ? "studio" : "practitioner"}`,
          context.note ? `They wrote:

"${context.note}"` : "They left no written comment.",
          "The full record is in review_escalations, which lists everything still open.",
          SIGN_OFF,
        ),
        // Nobody is standing at a door waiting for this, and a text cannot
        // carry the comment that makes it actionable.
        sms: null,
      };

    /**
     * Somebody wants to move to the other side. Not urgent, but it is a person
     * waiting on a human, so it says who and why rather than just that it
     * happened.
     */
    case "account_change_requested": {
      /*
       * Both sides of the arrow are named defensively. A staff message that
       * reads "from undefined to undefined" is worse than a vague one — it
       * tells whoever opens it that the app lost the request.
       */
      const from = context.role ?? "their current side";
      const to = context.reason ?? "the other side";
      return {
        subject: `Account change requested: ${from} → ${to}`,
        body: lines(
          `${context.name ?? "Someone"} has asked to move from ${from} to ${to}.`,
          context.note ? `They wrote:

"${context.note}"` : "They gave no reason.",
          `Nothing has changed. Approving means they take on what that side requires — sublease proof and payout setup for a host, insurance for a practitioner — so check those before you switch it.`,
          `The open requests are in account_type_change_requests, and supabase/admin-queries.sql has the statement that applies one.`,
          SIGN_OFF,
        ),
        sms: null,
      };
    }

    /**
     * What is waiting on the operator, when the operator is not looking.
     *
     * Everything here is already on the staff screen and shown well. The screen
     * cannot reach anybody, though — it is a page, and a page has to be opened.
     * Until this existed, two events sent mail and the rest waited for somebody
     * to happen to look, which is fine right up until a host is standing in a
     * studio they opened for a session we cannot pay them for.
     *
     * Deliberately one message rather than six. Six arriving together is noise,
     * and noise gets filtered, which is the same as silence but harder to
     * notice.
     */
    case "staff_waiting":
      return {
        subject: String(context.summary ?? "Something is waiting on you"),
        body: lines(
          "Waiting on a decision:",
          String(context.items ?? ""),
          `The queue is at ${context.queueUrl ?? "/admin"}.`,
          SIGN_OFF,
        ),
        sms: null,
      };

    /** Money the host has earned and cannot receive. Nobody finds out unless we say. */
    case "payout_failed":
      return {
        subject: "Your payout could not reach your bank",
        body: lines(
          greeting(name),
          `A payout was returned by your bank${context.reason ? `: ${context.reason}` : ""}.`,
          `Your earnings are safe and still yours — they are sitting with our payment processor, not lost. Stripe pauses payouts to an account after a return, so this will keep happening until the bank details are corrected.`,
          `Update them from Payouts in your profile, and the paused amount goes out on the next run.`,
          SIGN_OFF,
        ),
        sms: null,
      };
  }
}

/**
 * A very small HTML wrapper.
 *
 * The plain text is the message; this only makes it survive an email client
 * that would otherwise collapse the line breaks. No images, no tracking pixel,
 * no layout table — the content is six lines and dressing it up would cost
 * deliverability for nothing.
 */
export function toHtml(message: Message): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const paragraphs = message.body
    .split("\n\n")
    .map((p) => `<p style="margin:0 0 16px">${escape(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#16304E;max-width:520px">${paragraphs}</div>`;
}
