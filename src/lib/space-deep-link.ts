/**
 * The ?space=<id> deep link, as small decisions the app shell can test.
 *
 * A public listing page redirects to `APP_URL?space=<id>` (migration 0064)
 * rather than rendering the listing itself. The shell captures the id, carries
 * it through sign-in — including a full OAuth redirect — and opens Space Detail
 * once the signed-in catalogue has loaded. The pieces worth pinning live here
 * rather than tangled into an effect: what the parameter is, when it may be
 * honoured, and how it survives a reload.
 *
 * The id in a public URL is only the first eight hex characters of the listing's
 * UUID — that is all listingSlug()/idFromSlug() ever put in a path — so the
 * match is a prefix match against the full UUIDs already loaded for this user.
 * Nothing is ever fetched to resolve it: a removed or inaccessible listing
 * matches nothing, and a prefix that matches more than one is a tie we refuse
 * rather than guess. No anonymous lookup, no leak.
 */

export const SPACE_DEEP_LINK_PARAM = "space";

const PENDING_SPACE_KEY = "ms_pending_space";

/**
 * How long a captured intent may wait to be resumed.
 *
 * Long enough for an OAuth round trip to a provider and back; short enough that
 * a listing link opened, abandoned, and returned to days later does not silently
 * reopen. Ten minutes covers the former without inviting the latter.
 */
const PENDING_SPACE_TTL_MS = 10 * 60 * 1000;

/**
 * The listing a link targets, read from a URL's query string. Null when there
 * is none, or when it is blank — a bare `?space=` is not a request for anything.
 */
export function readSpaceDeepLink(search: string): string | null {
  const id = new URLSearchParams(search).get(SPACE_DEEP_LINK_PARAM);
  return id && id.trim() ? id.trim() : null;
}

/**
 * The normalised hex of an id or prefix: dashes stripped, lower-cased. Null when
 * it is neither an eight-character prefix (the public-URL form) nor a full
 * thirty-two-character UUID — so a short or malformed value can never match many
 * listings by accident.
 */
function normalisedTarget(value: string): string | null {
  const hex = value.replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{8}$/.test(hex) || /^[0-9a-f]{32}$/.test(hex) ? hex : null;
}

/**
 * Which listing to open, given the id and the inventory this user has already
 * loaded — the public catalogue and their own listings.
 *
 * The value may be a full UUID or the eight-character prefix a public listing
 * URL carries; either way it is matched against the full UUIDs in hand by
 * prefix, and only ever against those. It resolves to a full UUID when exactly
 * one loaded listing matches. Zero matches (removed, unlisted, inaccessible) or
 * more than one (a prefix collision) both return null, which the shell reads as
 * "stay on Discover". This never decides whether a *role* may see a listing —
 * the app's own screen guard still does that.
 */
export function resolveSpaceDeepLink(
  pendingId: string | null,
  loaded: readonly { id: string }[][],
): string | null {
  if (!pendingId) return null;
  const needle = normalisedTarget(pendingId);
  if (!needle) return null;

  const matches = new Set<string>();
  for (const list of loaded) {
    for (const space of list) {
      if (space.id.replace(/-/g, "").toLowerCase().startsWith(needle)) matches.add(space.id);
    }
  }
  // Exactly one, or nothing: a tie is refused rather than guessed.
  return matches.size === 1 ? [...matches][0] : null;
}

/**
 * Persist the intent across a full page reload — the OAuth flow redirects to the
 * provider and back, so the in-mount ref alone does not survive it. Best effort:
 * a blocked or private store just means the OAuth path falls back to Discover,
 * while the same-mount email-code path keeps working from the ref.
 */
export function writePendingSpace(id: string, now: number = Date.now()): void {
  try {
    window.localStorage.setItem(PENDING_SPACE_KEY, JSON.stringify({ id, ts: now }));
  } catch {
    // Private mode or a blocked store — nothing to resume from, which is safe.
  }
}

/** The persisted intent, if one is present and still fresh; else null (and any stale one is cleared). */
export function readPendingSpace(now: number = Date.now()): string | null {
  try {
    const raw = window.localStorage.getItem(PENDING_SPACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: unknown; ts?: unknown };
    if (typeof parsed.id !== "string" || typeof parsed.ts !== "number") {
      clearPendingSpace();
      return null;
    }
    if (now - parsed.ts > PENDING_SPACE_TTL_MS) {
      clearPendingSpace();
      return null;
    }
    return parsed.id;
  } catch {
    return null;
  }
}

export function clearPendingSpace(): void {
  try {
    window.localStorage.removeItem(PENDING_SPACE_KEY);
  } catch {
    // Best effort.
  }
}
