/**
 * The ?space=<id> deep link, as two small decisions the app shell can test.
 *
 * A public listing page redirects to `APP_URL?space=<id>` (migration 0064)
 * rather than rendering the listing itself. The shell captures the id, carries
 * it through sign-in if need be, and opens Space Detail once the signed-in
 * catalogue has loaded. The two rules worth pinning are here rather than tangled
 * into an effect: what the parameter is, and when it may be honoured.
 */

export const SPACE_DEEP_LINK_PARAM = "space";

/**
 * The listing a link targets, read from a URL's query string. Null when there
 * is none, or when it is blank — a bare `?space=` is not a request for anything.
 */
export function readSpaceDeepLink(search: string): string | null {
  const id = new URLSearchParams(search).get(SPACE_DEEP_LINK_PARAM);
  return id && id.trim() ? id : null;
}

/**
 * Which listing to open, given the id and the inventory this user has already
 * loaded — the public catalogue and their own listings.
 *
 * The id is only ever matched against what is already in hand; nothing is
 * fetched to resolve it, so a removed, unlisted or otherwise inaccessible
 * listing matches nothing and returns null, which the shell reads as "stay on
 * Discover". This never decides whether a *role* may see a listing — the app's
 * own screen guard still does that — only whether the deep link points at
 * something real and visible to this user.
 */
export function resolveSpaceDeepLink(
  pendingId: string | null,
  loaded: readonly { id: string }[][],
): string | null {
  if (!pendingId) return null;
  return loaded.some((list) => list.some((space) => space.id === pendingId)) ? pendingId : null;
}
