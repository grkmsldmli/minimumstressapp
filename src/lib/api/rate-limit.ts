/**
 * Per-caller request ceilings.
 *
 * Two different harms, so two different reasons this exists. `/api/geocode`
 * spends real money on every call — a metered provider, our key — and it is
 * reachable by anyone who can open the page, so an unbounded endpoint is an
 * unbounded invoice. Booking and cancellation cost nothing per call but hold
 * and release slots, and a loop over them is a way to make a studio's calendar
 * unusable without ever paying for anything.
 *
 * A fixed window, in memory. Both of those words are compromises worth being
 * explicit about:
 *
 *   In memory means per serverless instance. Vercel may run several, so the
 *   real ceiling is this number times however many are warm. That is fine for
 *   what this defends against — a runaway client, a scraper, a stuck retry
 *   loop — and useless against a distributed attacker, who is a different
 *   problem needing a shared store. Naming the limit here rather than
 *   pretending it is global.
 *
 *   Fixed window lets a caller spend the whole allowance at the end of one
 *   window and again at the start of the next. A sliding window would smooth
 *   that; the burst it permits is roughly double, which for these limits is
 *   still far below anything that hurts.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Swept opportunistically rather than on a timer — no interval to leak. */
function sweep(now: number): void {
  if (windows.size < 5000) return;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export interface RateLimit {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/**
 * Ceilings chosen against what the feature actually does, not a round number.
 */
export const LIMITS = {
  /**
   * Address lookup. Debounced at 300ms and only while a host types an address,
   * so a real session is a handful of calls; this allows an order of magnitude
   * more before saying no.
   */
  geocode: { limit: 60, windowMs: 60_000 },

  /** Resolving a chosen place — at most one per address a host settles on. */
  geocodeResolve: { limit: 20, windowMs: 60_000 },

  /** Nearby search: one on arrival, a few more if someone retypes a ZIP. */
  nearby: { limit: 30, windowMs: 60_000 },

  /**
   * Booking. Each one authorises a card, and nobody books ten rooms a minute.
   * Low enough that a loop is stopped early, high enough that a person
   * retrying a declined card is never the one who hits it.
   */
  booking: { limit: 10, windowMs: 60_000 },

  /** Cancelling, same reasoning from the other direction. */
  cancel: { limit: 10, windowMs: 60_000 },

  /** Starting Stripe onboarding — a link a host follows once, maybe twice. */
  connect: { limit: 5, windowMs: 60_000 },

  /**
   * Leaving a review. One per booking per side is already enforced in the
   * database, so this only stops a loop probing which bookings exist.
   */
  review: { limit: 10, windowMs: 60_000 },

  /**
   * Asking to switch sides. One open request is already enforced by a unique
   * index, so this only stops somebody hammering the endpoint after a refusal.
   */
  accountChange: { limit: 3, windowMs: 60 * 60_000 },

  /**
   * Deleting an account. Once is the whole story, and the second attempt is
   * either a mistake or somebody else's.
   */
  accountDelete: { limit: 3, windowMs: 60 * 60_000 },

  /**
   * Sending a message. Generous, because a real conversation about a door
   * that will not open is a burst of short messages — and being rate limited
   * mid-problem is exactly when somebody reaches for a phone number instead.
   */
  message: { limit: 30, windowMs: 60_000 },
} as const satisfies Record<string, RateLimit>;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Seconds until the window resets — what a Retry-After header wants. */
  retryAfter: number;
}

export function check(bucket: string, identity: string, limit: RateLimit): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const key = `${bucket}:${identity}`;
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + limit.windowMs });
    return { ok: true, remaining: limit.limit - 1, retryAfter: 0 };
  }

  existing.count += 1;
  const retryAfter = Math.ceil((existing.resetAt - now) / 1000);

  if (existing.count > limit.limit) {
    return { ok: false, remaining: 0, retryAfter };
  }

  return { ok: true, remaining: limit.limit - existing.count, retryAfter };
}

/**
 * Who to count against.
 *
 * A signed-in user is counted by their id, which survives a changed IP and
 * cannot be spoofed — the id comes from a verified token, never from the
 * request body. Anonymous callers fall back to the forwarded address, which is
 * imperfect: everyone behind one office NAT shares a bucket. The limits above
 * are set high enough that a shared bucket does not bite a real office, and
 * the alternative — not limiting anonymous callers — is what leaves the
 * metered endpoint open.
 */
export function identify(request: Request, userId?: string | null): string {
  if (userId) return `user:${userId}`;

  // Vercel sets x-forwarded-for and strips any client-supplied value, so the
  // first entry is the real peer rather than something the caller chose.
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim();
  return `ip:${ip || "unknown"}`;
}

/** The 429 a caller gets, with the header that tells them when to come back. */
export function tooManyRequests(result: RateLimitResult): Response {
  return Response.json(
    { error: "Too many requests — please slow down." },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, result.retryAfter)),
        "Cache-Control": "no-store",
      },
    },
  );
}

/** Test seam. Nothing in the app calls this. */
export function resetForTests(): void {
  windows.clear();
}
