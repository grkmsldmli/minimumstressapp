import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

import { bearerToken } from "../auth-header";
import { supabasePublishableKey, supabaseSecretKey, supabaseUrl } from "./env";

/**
 * Server client carrying the caller's session, so RLS applies exactly as it
 * would in the browser. This is the default for anything server-rendered.
 *
 * The session normally rides in the cookie. The native shell has no cookie —
 * the Capacitor WebView drops it, so it sends the same access token as a Bearer
 * header instead (see supabase/client.ts and api-fetch.ts). When one is
 * present it is passed to the client as an Authorization header, so its
 * PostgREST requests act as that user under RLS exactly as the cookie would.
 * This is a second transport for one session, not a second auth: the token is
 * still a Supabase JWT, validated the same way. The web sends no such header
 * and keeps using the cookie untouched.
 */
export async function supabaseServer() {
  const store = await cookies();
  const token = bearerToken((await headers()).get("authorization"));

  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) {
            store.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. Refresh happens in middleware
          // or a route handler instead, so swallowing this is correct rather
          // than a missing case.
        }
      },
    },
  });
}

/**
 * A client with nobody signed in, for pages that are the same for everybody.
 *
 * The city and listing pages are read by strangers and by crawlers, and they
 * show only what `anon` is granted: spaces_public and the two inventory views.
 * Using `supabaseServer()` for them would work and would be wrong twice over —
 * it reads cookies, which opts the route out of static rendering and makes
 * every crawl a fresh render, and it would quietly show a signed-in visitor a
 * different page from the one a search engine was given.
 *
 * No cookies in, no session, nothing to refresh. If RLS would hide a row from
 * a stranger, it is hidden here too, which is the property these pages need.
 */
export function supabasePublic() {
  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: { getAll: () => [], setAll: () => {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Admin client. Bypasses RLS entirely — every policy in
 * supabase/migrations/0002_rls.sql stops applying.
 *
 * Reserved for the operations that genuinely cannot run as the user: writing a
 * booking and its credit_ledger entry in the same transaction as a Stripe
 * PaymentIntent, and the scheduled jobs that capture payment and reveal access
 * codes. Reach for `supabaseServer()` first and only come here when the work
 * has to outrank the person requesting it.
 *
 * No session, no cookie persistence: this client must never pick up a user's
 * identity and quietly act with elevated rights on their behalf.
 */
export function supabaseAdmin() {
  return createServerClient(supabaseUrl(), supabaseSecretKey(), {
    cookies: { getAll: () => [], setAll: () => {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
