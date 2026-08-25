/**
 * The access token out of an Authorization header, or null.
 *
 * The web signs API calls with the session cookie; the native shell cannot —
 * the Capacitor WebView drops the SSR cookie, so its session lives in
 * localStorage and it sends the token as `Authorization: Bearer <jwt>` instead
 * (see api-fetch.ts and supabase/client.ts). This is the one place that reads
 * that header, shared by the server client and the session guard so the two
 * never disagree on what a bearer looks like.
 *
 * Kept in its own module, with no imports, precisely so both of those can use
 * it without importing each other.
 */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match ? match[1].trim() || null : null;
}
