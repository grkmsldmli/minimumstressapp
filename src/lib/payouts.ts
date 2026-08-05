/**
 * When a host gets paid, and what it costs them.
 *
 * Two questions with real money on both sides: pay too early and the platform
 * carries losses it cannot recover; pay too late and hosts leave. The policy
 * below sits deliberately at the point where the platform's exposure is
 * already small for structural reasons, rather than buying safety with a long
 * hold on other people's earnings.
 */

/* ------------------------------------------------------------------ */
/*  Timing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Business days between a session and the money reaching the host's bank.
 *
 * Stripe's US default, kept rather than lengthened, because the real
 * protection is structural: funds only reach a host's balance when the
 * PaymentIntent is captured, and capture happens at the session start time,
 * not at booking. A room booked three days out earns the host nothing until
 * the hour actually arrives, so most of the ways a booking can fall apart —
 * cancellation, no-show, a listing pulled — resolve before any money moves.
 *
 * The window this delay does cover is the one that matters most in practice: a
 * host who cancels or fails to show *after* capture. The refund reverses their
 * transfer, and having the funds still on the platform makes that a clean
 * reversal instead of a clawback against a balance that has already left.
 *
 * Lengthening it further buys little. Card disputes can arrive months later,
 * so no realistic delay covers them; a longer hold would tax every honest host
 * for a risk it does not actually remove.
 */
export const PAYOUT_DELAY_DAYS = 2;

export type PayoutSpeed = "standard" | "instant";

/* ------------------------------------------------------------------ */
/*  Instant payouts                                                    */
/* ------------------------------------------------------------------ */

/** Stripe's charge for moving money to a debit card within minutes. */
export const INSTANT_PAYOUT_PERCENT = 0.015;
export const INSTANT_PAYOUT_MINIMUM_CENTS = 50;

/**
 * What Stripe takes for an instant payout, deducted from the host's own money.
 *
 * This is the single place a host's take can differ from the rate they set,
 * and it is worth being precise about why that does not contradict the promise
 * the rest of the app makes. Our service fee never touches their rate — it is
 * added on top, for the practitioner. This is a different transaction
 * entirely: the host paying Stripe to receive their earnings sooner than the
 * free option, which they choose, and can unchoose.
 *
 * What would be dishonest is showing it as "a small fee". So `describeSpeed`
 * below returns the actual figure on their actual rate, and the profile screen
 * prints it.
 */
export function instantPayoutFeeCents(amountCents: number): number {
  if (amountCents <= 0) return 0;
  return Math.max(
    INSTANT_PAYOUT_MINIMUM_CENTS,
    Math.ceil(amountCents * INSTANT_PAYOUT_PERCENT),
  );
}

/** What actually lands in the host's bank for a payout of this size. */
export function netPayoutCents(amountCents: number, speed: PayoutSpeed): number {
  if (speed === "standard") return amountCents;
  return Math.max(0, amountCents - instantPayoutFeeCents(amountCents));
}

export interface SpeedDescription {
  arrival: string;
  /** Null when nothing is deducted, so the UI can stay silent rather than say "free". */
  costLine: string | null;
}

/**
 * Plain wording for each option, using the host's own rate so the trade-off is
 * a number rather than an adjective.
 */
export function describeSpeed(
  speed: PayoutSpeed,
  exampleCents: number,
  /** Days earned off the standard wait. See earnedPayoutSpeedupDays. */
  speedupDays = 0,
): SpeedDescription {
  if (speed === "standard") {
    /**
     * Floored at one day rather than zero.
     *
     * The delay is not friction to be removed — it is the window in which a
     * card can be disputed after we have already paid the host out. A benefit
     * that took it to nothing would move that risk from the practitioner's
     * bank to ours, which is the wrong way for a reward to work.
     */
    const days = Math.max(1, PAYOUT_DELAY_DAYS - speedupDays);

    return {
      arrival:
        speedupDays > 0
          ? `${days} business ${days === 1 ? "day" : "days"} after each session — a day sooner, earned`
          : `${days} business days after each session`,
      costLine: null,
    };
  }

  const fee = instantPayoutFeeCents(exampleCents);
  const net = netPayoutCents(exampleCents, "instant");
  return {
    arrival: "Within minutes, to a debit card",
    costLine:
      exampleCents > 0
        ? `Stripe charges ${formatMoney(fee)} for this, taken from the payout — on a ${formatMoney(exampleCents)} session you'd receive ${formatMoney(net)}.`
        : `Stripe charges ${(INSTANT_PAYOUT_PERCENT * 100).toFixed(1)}% (minimum ${formatMoney(INSTANT_PAYOUT_MINIMUM_CENTS)}), taken from the payout.`,
  };
}

function formatMoney(cents: number): string {
  return `$${Math.floor(cents / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/*  Readiness                                                          */
/* ------------------------------------------------------------------ */

export type PayoutStatus = "not_started" | "in_progress" | "ready" | "restricted";

/**
 * Where a host stands, from what Stripe reports rather than how far through
 * the form they felt they got.
 *
 * `in_progress` is the state that actually costs money if it is mislabelled:
 * an account exists, the host believes they are set up, and every booking on
 * their space is refused. It has to read as unfinished, not as almost-done.
 */
export function payoutStatus(account: {
  hasAccount: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  hasOverdueRequirements: boolean;
}): PayoutStatus {
  if (!account.hasAccount) return "not_started";
  if (account.hasOverdueRequirements) return "restricted";
  if (account.chargesEnabled && account.payoutsEnabled) return "ready";
  return "in_progress";
}

/** True only when a booking can safely be taken against this host. */
export function canAcceptBookings(status: PayoutStatus): boolean {
  return status === "ready";
}
