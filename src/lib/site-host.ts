/**
 * Which hostnames are the content site rather than the app.
 *
 * One deployment serves two things. minimumstress.app is the marketplace —
 * practitioners renting rooms from hosts, behind a sign-in. minimumstress.com
 * is the public site: what the company is, the articles, the free tools, and
 * the way into the app.
 *
 * They are one Next project because they share a repository, a deploy, and a
 * brand, and because the alternative was paying Shopify to host the second one
 * in a template we could not change. They are kept apart by hostname here
 * rather than by a path prefix in every link, so a page on the content site
 * can be written at `/articles` and mean `minimumstress.com/articles`.
 *
 * `new.` is the staging name. It exists so the whole site can be built and
 * reviewed while minimumstress.com is still served by Shopify — the apex only
 * moves once there is something finished to move it to.
 */
const SITE_HOSTS = new Set([
  "minimumstress.com",
  "www.minimumstress.com",
  "new.minimumstress.com",
]);

/**
 * Local development, where there is one port and no DNS.
 *
 * `site.localhost` resolves to 127.0.0.1 in every current browser without a
 * hosts-file entry, so `http://site.localhost:3000` reaches the content site
 * and `http://localhost:3000` reaches the app, from the same `next dev`.
 */
const LOCAL_SITE_HOST = "site.localhost";

/**
 * True when this request belongs to the content site.
 *
 * The port is stripped: a Host header carries one in development and not in
 * production, and the answer is the same either way.
 */
export function isSiteHost(host: string | null): boolean {
  if (!host) return false;
  const name = host.split(":")[0].toLowerCase();
  return SITE_HOSTS.has(name) || name === LOCAL_SITE_HOST;
}

/**
 * A request for a file rather than for a page.
 *
 * Everything in `public/` is served from the root of the deployment and is not
 * under `/site`, so rewriting these turns every photograph on the content site
 * into a 404 — which is exactly what happened: the homepage's own images were
 * reachable on the app host and missing on the site they belong to. It went
 * unnoticed for a while because `next/image` fetches through `/_next/image`,
 * which was already excluded, so the page looked right while every direct link
 * to a file — an OpenGraph preview, a share card, `robots.txt` — was broken.
 *
 * A dot in the last segment is the test. Routes here are words and slashes;
 * files carry an extension. It is the same rule Next's own matcher uses.
 */
function isFileRequest(pathname: string): boolean {
  return pathname.slice(pathname.lastIndexOf("/")).includes(".");
}

/**
 * Paths that belong to the deployment rather than to either site.
 *
 * API routes, the auth callback and Next's own assets answer the same way on
 * every hostname, and rewriting them under `/site` would break them — the
 * Supabase callback in particular is registered against a fixed path.
 */
export function isSharedPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/_next/") ||
    isFileRequest(pathname)
  );
}
