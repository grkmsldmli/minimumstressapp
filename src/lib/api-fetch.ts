"use client";

import { isNativeApp } from "./native";
import { supabaseBrowser } from "./supabase/client";

/**
 * `fetch` for our own `/api/*` routes, carrying the session however this build
 * carries it.
 *
 * On the web the session is a cookie, which the browser attaches to a
 * same-origin request on its own — so this is a plain fetch and nothing is
 * added. In the native shell there is no cookie: the session lives in
 * localStorage (see supabase/client.ts), so the same access token is attached
 * as an `Authorization: Bearer` header, which the server reads as an equal
 * transport for the same auth (see auth-header.ts, api/session.ts). Without
 * this, every server route saw a native caller as signed out and answered
 * "Sign in to continue" — the Pro checkout being where it was first noticed.
 *
 * If the native session cannot be read, the call is made without a token and
 * the route answers 401 on its own, which is the correct signed-out behaviour
 * rather than a fabricated one.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  // The token is only ever attached in the native shell, and only to our own
  // origin. On the web the cookie does the job. Anything cross-origin — Stripe,
  // a third party — goes out as a plain fetch with no token, so the access
  // token can never leak off our origin even if a caller passes a full URL.
  if (!isNativeApp() || !isSameOrigin(input)) return fetch(input, init);

  // Read the session fresh on every call rather than caching a token: supabase-js
  // keeps it refreshed, so this is always the current, unexpired access token.
  const {
    data: { session },
  } = await supabaseBrowser().auth.getSession();

  const token = session?.access_token;
  if (!token) return fetch(input, init);

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

/**
 * Whether a request stays on our own origin.
 *
 * A relative path ("/api/…") always does; an absolute URL is checked against
 * the page's origin. Anything else — or anything unparseable — is treated as
 * off-origin, so the token is withheld rather than risked.
 */
function isSameOrigin(input: string): boolean {
  try {
    return new URL(input, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}
