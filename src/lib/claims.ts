/**
 * When a studio is left worse than it was found.
 *
 * The mirror of `refunds.ts`, pointing the other way, and built to the same
 * rule: nothing is charged to anybody's card on one side's account of events.
 * A host reports, the practitioner answers, a person decides. Reversing that —
 * charging first and arguing later — is how a marketplace collects chargebacks
 * instead of money, and at this size one chargeback costs more than the claim.
 *
 * What is taken from Uber's version is the shape of the amounts. They do not
 * ask a driver to assess a mess; they publish "deep clean, $80". A number
 * agreed in advance moves the argument off "how much" and onto "did it
 * happen", which is a question two people can actually settle. So the common,
 * repeatable harms have fixed prices, published before anybody books, and only
 * genuine damage is assessed.
 */

import { SESSION_MS } from "./session";

export type ClaimKind = "cleaning" | "overstay" | "damage";

export interface ClaimType {
  kind: ClaimKind;
  label: string;
  /** What the host is asked, so the answer is worth reading. */
  prompt: string;
  /**
   * Fixed price in cents, or null when it has to be assessed.
   *
   * Fixed wherever the harm repeats and looks the same every time. A room left
   * needing a clean costs what a clean costs; a broken mirror does not have a
   * price until somebody has looked at it.
   */
  fixedCents: number | null;
  /** Photographs, or it did not happen. */
  requiresPhoto: boolean;
}

/**
 * A clean is a clean.
 *
 * Deliberately modest. This is meant to cover the studio's actual trouble, not
 * to punish — a number that feels like a fine is a number people dispute, and a
 * dispute costs more than the difference.
 */
export const CLEANING_FEE_CENTS = 4000;

/**
 * The ceiling on anything we will charge without both sides agreeing.
 *
 * Above this we stop being the ones who decide. We hold the record, both
 * accounts and the photographs, and the studio's own insurance is what a
 * serious loss is for — a marketplace that quietly becomes an insurer has
 * taken on a liability nobody priced.
 */
export const CLAIM_CAP_CENTS = 50_000;

export const CLAIM_TYPES: readonly ClaimType[] = [
  {
    kind: "cleaning",
    label: "Left needing a clean",
    prompt: "What was left, and what did you have to do about it?",
    fixedCents: CLEANING_FEE_CENTS,
    requiresPhoto: true,
  },
  {
    kind: "overstay",
    label: "Stayed past the hour",
    prompt: "How long did they run over, and did it affect a booking after them?",
    // Priced from the room's own rate rather than a flat figure — see
    // `overstayCents`. A studio at $80 an hour loses more to the same delay
    // than one at $35, and a single number would be wrong for both.
    fixedCents: null,
    requiresPhoto: false,
  },
  {
    kind: "damage",
    label: "Something was damaged or is missing",
    prompt: "What was damaged, and what will it cost to put right?",
    fixedCents: null,
    requiresPhoto: true,
  },
];

export function claimType(kind: ClaimKind): ClaimType {
  const found = CLAIM_TYPES.find((t) => t.kind === kind);
  if (!found) throw new Error(`Unknown claim kind: ${kind}`);
  return found;
}

/**
 * How long after a session a studio may report.
 *
 * Short, and short on purpose. A room is used by other people; damage found
 * two weeks later cannot honestly be pinned on any one of them, and a claim
 * nobody can defend against is a claim that should not be chargeable.
 */
export const CLAIM_WINDOW_HOURS = 48;

/**
 * Time over the hour, priced at the room's own rate.
 *
 * Rounded up to the half hour, because that is how the loss actually lands —
 * ten minutes over is what stops the next booking starting on time, and
 * charging ten minutes' worth would not cover it. Capped at the whole session,
 * so a host who reports somebody as eight hours late cannot invoice a day.
 */
export function overstayCents(minutesOver: number, hourlyRateCents: number): number {
  if (minutesOver <= 0) return 0;

  const halfHours = Math.ceil(Math.min(minutesOver, 240) / 30);
  return Math.round((halfHours * hourlyRateCents) / 2);
}

/**
 * When a host's window closes, for the screen that offers the button.
 *
 * Here rather than in the service because it is arithmetic, and a client
 * component reaching into the service for it drags `server-only` Stripe code
 * into the browser bundle — which is how the build found this.
 */
export function claimWindowEndsAt(sessionStart: Date): Date {
  return new Date(sessionStart.getTime() + SESSION_MS + CLAIM_WINDOW_HOURS * 60 * 60 * 1000);
}

export type ClaimRoute =
  /** Fixed price, both sides told, still not charged until a person says so. */
  | { kind: "priced"; amountCents: number; because: string }
  /** A person has to put a number on it. */
  | { kind: "assess"; because: string }
  /** Refused before it reaches anybody. */
  | { kind: "closed"; because: string };

export interface ClaimContext {
  kind: ClaimKind;
  sessionEnd: Date;
  now: Date;
  hourlyRateCents: number;
  minutesOver: number;
  claimedCents: number | null;
  hasPhoto: boolean;
}

/**
 * What happens to a claim when it arrives.
 *
 * Nothing here charges anybody. The best case is "priced" — an amount both
 * sides can see, still waiting on the practitioner's answer and a person's
 * decision. The route only ever decides what the argument is about.
 */
export function routeClaim(context: ClaimContext): ClaimRoute {
  const { kind, sessionEnd, now, hourlyRateCents, minutesOver, claimedCents, hasPhoto } = context;

  const hoursSince = (now.getTime() - sessionEnd.getTime()) / (60 * 60 * 1000);
  if (hoursSince > CLAIM_WINDOW_HOURS) {
    return {
      kind: "closed",
      because: `Reported ${Math.floor(hoursSince)} hours after the session. The window is ${CLAIM_WINDOW_HOURS}, because a room other people have used since cannot be pinned on one of them.`,
    };
  }

  if (hoursSince < 0) {
    return { kind: "closed", because: "That session has not finished yet." };
  }

  const type = claimType(kind);
  if (type.requiresPhoto && !hasPhoto) {
    return {
      kind: "closed",
      because: "This one needs a photograph. Nobody is charged on a description alone.",
    };
  }

  if (kind === "overstay") {
    const amount = overstayCents(minutesOver, hourlyRateCents);
    if (amount <= 0) {
      return { kind: "closed", because: "No time over the hour was reported." };
    }
    return {
      kind: "priced",
      amountCents: amount,
      because: "Charged at this room's own hourly rate, rounded up to the half hour.",
    };
  }

  if (type.fixedCents !== null) {
    return {
      kind: "priced",
      amountCents: type.fixedCents,
      because: "A published flat rate, the same for every studio.",
    };
  }

  if (claimedCents !== null && claimedCents > CLAIM_CAP_CENTS) {
    return {
      kind: "closed",
      because: `Above what we settle between two accounts. We keep the record and the photographs — this is what a studio's own insurance is for.`,
    };
  }

  return { kind: "assess", because: "A person reads both accounts and puts a number on it." };
}
