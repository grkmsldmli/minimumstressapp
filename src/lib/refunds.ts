/**
 * Asking for money back, and deciding whether to give it.
 *
 * The automatic rule covers one case: cancel 24 hours ahead and the charge is
 * refunded in full. Everything else had no path at all. A practitioner who
 * stood outside a locked door, or walked into a room that was nothing like its
 * photographs, had exactly the same options as somebody who simply changed
 * their mind — none — and the terms meanwhile promised a goodwill credit the
 * software never once wrote.
 *
 * So: a reason, from a list, because a reason that cannot be counted cannot be
 * compared and a marketplace that cannot compare cannot spot a pattern. Free
 * text is carried alongside, never instead.
 *
 * The design rule underneath all of it: nothing that accuses the host is ever
 * decided on the practitioner's word alone, and nothing that costs the host
 * money is decided without asking them. A refund system that pays out on one
 * unchecked story is a refund system that gets farmed, and the person who pays
 * for that is the host who did nothing wrong.
 */

import { FREE_CANCEL_WINDOW_MS } from "./money";

export type RefundReason =
  | "no_access"
  | "not_as_described"
  | "double_booked"
  | "unsafe"
  | "host_no_show"
  | "changed_plans"
  | "other";

export interface RefundQuestion {
  reason: RefundReason;
  /** How somebody would say it themselves. */
  label: string;
  /** What we then ask them, so the answer is worth reading. */
  prompt: string;
  /** True when the answer is about something the host did or failed to do. */
  accusesHost: boolean;
  /**
   * True when a photograph is the difference between a claim and a fact.
   *
   * Not required — somebody in a bad situation should not be blocked by a
   * camera — but asked for, and its absence is visible to whoever decides.
   */
  wantsPhoto: boolean;
}

export const REFUND_QUESTIONS: readonly RefundQuestion[] = [
  {
    reason: "no_access",
    label: "I could not get in",
    prompt: "What happened at the door, and did you message the studio at the time?",
    accusesHost: true,
    wantsPhoto: false,
  },
  {
    reason: "host_no_show",
    label: "Nobody was there to let me in",
    prompt: "How long did you wait, and how did you try to reach them?",
    accusesHost: true,
    wantsPhoto: false,
  },
  {
    reason: "not_as_described",
    label: "The room was not what the listing showed",
    prompt: "Which part — the size, the state of it, something that was missing?",
    accusesHost: true,
    wantsPhoto: true,
  },
  {
    reason: "double_booked",
    label: "Somebody else was using the room",
    prompt: "Who was in there, and what did they say?",
    accusesHost: true,
    wantsPhoto: false,
  },
  {
    reason: "unsafe",
    label: "Something unsafe happened",
    prompt: "Tell us what happened. This reaches a person, not a queue.",
    accusesHost: true,
    wantsPhoto: false,
  },
  {
    reason: "changed_plans",
    label: "My plans changed",
    prompt: "Anything you want us to know.",
    accusesHost: false,
    wantsPhoto: false,
  },
  {
    reason: "other",
    label: "Something else",
    prompt: "In your own words.",
    accusesHost: false,
    wantsPhoto: false,
  },
];

export function questionFor(reason: RefundReason): RefundQuestion {
  const found = REFUND_QUESTIONS.find((q) => q.reason === reason);
  if (!found) throw new Error(`Unknown refund reason: ${reason}`);
  return found;
}

/**
 * How long after a session somebody may still ask.
 *
 * Long enough that a bad session on a Friday can still be raised on Monday;
 * short enough that the host is not answering for a room as it was a month
 * ago, when neither of them remembers and nothing can be checked.
 */
export const REFUND_WINDOW_DAYS = 7;

/**
 * How long the host has to answer before it goes to staff anyway.
 *
 * A host who says nothing must not be able to stall a refund indefinitely, and
 * a practitioner who is owed money should not wait on somebody else's inbox.
 */
export const HOST_REPLY_HOURS = 48;

/**
 * Requests in the window before the pattern is worth looking at on its own.
 *
 * Not a limit and deliberately not a block: three genuinely bad sessions is
 * possible, and refusing the fourth on arithmetic would punish somebody for
 * their bad luck. It moves the decision to a person and shows them the count.
 */
export const REQUESTS_BEFORE_REVIEW = 3;
export const REQUEST_WINDOW_DAYS = 90;

export type RefundOutcome =
  /** Money back in full. */
  | "full"
  /**
   * Our fee back, the host keeps their rate.
   *
   * The honest middle, and the one most disputes deserve. The host set the
   * hour aside and lost the chance to sell it; that is real whether or not the
   * session went well. Our own cut is the part we can give back without
   * charging somebody else for a decision they had no part in.
   */
  | "our_fee"
  /** Nothing. */
  | "none";

export type RefundRoute =
  /** Decided now, no human needed. */
  | { kind: "decided"; outcome: RefundOutcome; because: string }
  /** The host is asked first, then a person decides. */
  | { kind: "ask_host"; because: string }
  /** Straight to a person. */
  | { kind: "staff"; priority: "safety" | "normal"; because: string };

export interface RefundContext {
  reason: RefundReason;
  sessionStart: Date;
  now: Date;
  /** Refund requests this practitioner has made in the last REQUEST_WINDOW_DAYS. */
  recentRequests: number;
  /** Whether the session has already been paid out to the host. */
  hostAlreadyPaid: boolean;
}

/**
 * Where a request goes. Never straight to a payout.
 *
 * Note what is missing: there is no branch that refunds on the practitioner's
 * account of events alone. Every reason that blames the host is routed to the
 * host and then to a person. That is the whole anti-abuse design — not a
 * cleverer rule, but the absence of a rule that pays out unchecked.
 */
export function routeRefund(context: RefundContext): RefundRoute {
  const { reason, sessionStart, now, recentRequests } = context;

  /*
   * Safety first and unconditionally. It is not routed by cost, it is not
   * weighed against how often somebody has asked before, and it does not wait
   * on the host's reply — somebody describing an unsafe session is telling us
   * something that matters more than the forty dollars.
   */
  if (reason === "unsafe") {
    return {
      kind: "staff",
      priority: "safety",
      because: "Anything unsafe reaches a person straight away.",
    };
  }

  const daysSince = (now.getTime() - sessionStart.getTime()) / (24 * 60 * 60 * 1000);
  if (daysSince > REFUND_WINDOW_DAYS) {
    return {
      kind: "decided",
      outcome: "none",
      because: `Asked ${Math.floor(daysSince)} days after the session, and the window is ${REFUND_WINDOW_DAYS}.`,
    };
  }

  /*
   * Changing your mind is the one reason that needs nobody else's account of
   * events, and it is the one the 24-hour rule already answers. Inside the
   * window the hour was held and could not be resold, so the answer is no —
   * said plainly, rather than left in a queue to look like it might be yes.
   */
  if (reason === "changed_plans") {
    const ahead = sessionStart.getTime() - now.getTime();
    if (ahead >= FREE_CANCEL_WINDOW_MS) {
      return {
        kind: "decided",
        outcome: "full",
        because: "More than 24 hours ahead — this is a normal cancellation.",
      };
    }
    return {
      kind: "decided",
      outcome: "none",
      because:
        "Inside 24 hours the studio kept the hour free and could not sell it again, so it is theirs.",
    };
  }

  if (recentRequests >= REQUESTS_BEFORE_REVIEW) {
    return {
      kind: "staff",
      priority: "normal",
      because: `${recentRequests + 1} requests in ${REQUEST_WINDOW_DAYS} days — a person should look at the pattern rather than this one request.`,
    };
  }

  if (questionFor(reason).accusesHost) {
    return {
      kind: "ask_host",
      because: "The studio is asked what happened before anything is decided.",
    };
  }

  return { kind: "staff", priority: "normal", because: "Needs a person to read it." };
}

/** What each outcome actually pays back, in cents. */
export function refundCents(
  outcome: RefundOutcome,
  booking: { totalCents: number; hostRateCents: number },
): number {
  if (outcome === "full") return booking.totalCents;
  if (outcome === "our_fee") return booking.totalCents - booking.hostRateCents;
  return 0;
}

/**
 * Whether a booking can be asked about at all.
 *
 * Anything already refunded, or never paid, has nothing to give back — and a
 * request against it would only produce a queue item that cannot end in money.
 */
export function canRequestRefund(booking: {
  status: string;
  paidCents: number;
  refundedCents: number;
}): boolean {
  if (booking.paidCents <= 0) return false;
  if (booking.refundedCents >= booking.paidCents) return false;
  return booking.status === "completed" || booking.status.startsWith("cancelled");
}
