/**
 * Failures worth trying again before telling anybody about them.
 *
 * Signing in with Google lands on a screen reading "We could not load your
 * account — JWT issued at future", and pressing Try again works. The token is
 * fine: it is stamped with the time the auth server issued it, checked against
 * the clock of the server that answers the first request, and those two are a
 * second or so apart. By the time a finger reaches the button the lagging
 * clock has caught up, which is why it always works on the second go.
 *
 * That is not a failure anybody should be shown. It is a wait, and the app can
 * do the waiting — which is the whole of this file: which errors deserve
 * another attempt, and how long to leave between them.
 *
 * Deliberately narrow. Retrying everything would turn a real outage into a
 * spinner that never resolves and a wrong password into a long pause, so only
 * two shapes qualify: a clock that disagrees with itself, and a request that
 * never arrived.
 */

/**
 * Clock skew, as PostgREST and GoTrue report it.
 *
 * Both wordings appear depending on which side rejects the token, and neither
 * says "clock" anywhere — which is why the message reaches the screen looking
 * like a broken account rather than a busy second.
 */
const CLOCK_SKEW = /issued at future|not yet valid|iat.*future/i;

/**
 * The request never reached us.
 *
 * A phone moving between wifi and cellular drops one request and answers the
 * next, and a person who has just tapped "Continue with Google" is often doing
 * exactly that — the redirect comes back as the radio is changing hands.
 */
const NETWORK = /failed to fetch|networkerror|network error|load failed/i;

export function isTransient(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return CLOCK_SKEW.test(message) || NETWORK.test(message);
}

/**
 * How long to wait before each further attempt, in order.
 *
 * Three tries over about four and a half seconds. Long enough to outlast the
 * skew that causes this, short enough that somebody staring at a loading box
 * does not decide the app is broken and close it — which is the failure this
 * is meant to prevent, arrived at by a different route.
 */
export const RETRY_DELAYS_MS = [400, 1200, 3000] as const;

export function delayFor(attempt: number): number | null {
  return RETRY_DELAYS_MS[attempt] ?? null;
}
