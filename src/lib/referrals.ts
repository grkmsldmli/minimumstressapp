import { APP_URL } from "./company";
import type { ReferralStatus } from "./domain";

/**
 * Host referrals, on the app's side of the line.
 *
 * The server owns attribution and qualification entirely (migration 0061); this
 * file only turns a code into a shareable link and a status into a word. There
 * is no reward here — the labels are factual, never "earned" or a dollar amount,
 * because the economics are a later, unapproved package.
 */

/** The query key a referral link carries, read once on arrival. */
export const REFERRAL_PARAM = "ref";

/** A shareable link that resolves to the referrer server-side, never their id. */
export function referralLink(code: string): string {
  return `${APP_URL}/?${REFERRAL_PARAM}=${encodeURIComponent(code)}`;
}

/**
 * The plain words for each status — calm and factual, no reward language.
 *
 * joined       attributed, nothing more yet
 * space_live   their first listing is live
 * qualified    first completed, captured booking — the referral is qualified
 */
export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  joined: "Joined",
  space_live: "Space live",
  qualified: "Referral qualified",
};

/* ------------------------------------------------------------------ */
/*  A referral code that survives the trip from link to attribution    */
/* ------------------------------------------------------------------ */

/**
 * A referral code held on the device between arriving on a link and the server
 * accepting it. `boundTo` is the account that first tried to use it — once set,
 * the code is that account's alone, so it can never be applied to a different
 * person who later signs in on the same device.
 */
export interface PendingReferral {
  code: string;
  boundTo: string | null;
}

export type AttributionPlan =
  | { kind: "attempt"; code: string; bound: PendingReferral }
  | { kind: "skip" };

/**
 * Decide what to do with a pending referral for the account now signed in.
 *
 * Nothing pending is a skip. A code already bound to a different account is left
 * untouched — never handed to somebody else. Otherwise it binds to this account
 * and is attempted.
 */
export function planAttribution(
  pending: PendingReferral | null,
  currentUserId: string,
): AttributionPlan {
  if (!pending?.code) return { kind: "skip" };
  if (pending.boundTo && pending.boundTo !== currentUserId) return { kind: "skip" };
  return {
    kind: "attempt",
    code: pending.code,
    bound: { code: pending.code, boundTo: currentUserId },
  };
}

/**
 * Carry out a planned attribution against a pending store.
 *
 * Binds before attempting, so a failure still remembers whose code it is. On a
 * server success — an attribution or a safe no-op — the code is cleared. On a
 * transient failure it is kept, so a later load can retry. It is never lost to a
 * failed call, and never applied to the wrong account.
 */
export async function runAttribution(io: {
  read: () => PendingReferral | null;
  write: (pending: PendingReferral) => void;
  clear: () => void;
  currentUserId: string;
  attribute: (code: string) => Promise<void>;
}): Promise<"attributed" | "kept" | "skipped"> {
  const plan = planAttribution(io.read(), io.currentUserId);
  if (plan.kind === "skip") return "skipped";

  io.write(plan.bound); // bind first: a failure below still belongs to this account
  try {
    await io.attribute(plan.code);
    io.clear();
    return "attributed";
  } catch {
    return "kept";
  }
}

const PENDING_KEY = "ms_referral";

/** Read the pending referral from localStorage, tolerating any bad state. */
export function readPendingReferral(): PendingReferral | null {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingReferral>;
    if (typeof parsed?.code !== "string" || !parsed.code) return null;
    return { code: parsed.code, boundTo: parsed.boundTo ?? null };
  } catch {
    return null;
  }
}

export function writePendingReferral(pending: PendingReferral): void {
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Private mode or a blocked store — the link simply will not attribute.
  }
}

export function clearPendingReferral(): void {
  try {
    window.localStorage.removeItem(PENDING_KEY);
  } catch {
    // best effort
  }
}
