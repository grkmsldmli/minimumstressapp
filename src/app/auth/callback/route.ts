import { NextResponse, type NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";

/**
 * Where Apple and Google send someone back to.
 *
 * `signInWithProvider` has always pointed here and this route did not exist,
 * so both providers landed on a 404 with the authorisation code in the URL and
 * no session was ever created. Every OAuth sign-in failed, silently, at the
 * last step.
 *
 * The exchange has to happen server-side: the code is single-use and is traded
 * for a session that is written as an httpOnly cookie, which a client-side
 * exchange cannot set.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");

  // The provider reports a refusal here rather than by failing to arrive —
  // someone tapping "Cancel" on Apple's sheet comes back exactly like this.
  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (providerError) {
    return NextResponse.redirect(failureUrl(url.origin, providerError));
  }

  if (!code) {
    return NextResponse.redirect(failureUrl(url.origin, "No sign-in code came back."));
  }

  // supabaseServer sets cookies through the request's own store, which a
  // Route Handler is allowed to write to — unlike a Server Component.
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("OAuth code exchange failed:", error.message);
    return NextResponse.redirect(failureUrl(url.origin, error.message));
  }

  /**
   * Always back to our own origin, built from the request rather than from
   * anything in the query string.
   *
   * A `next` or `redirect_to` parameter is the ordinary way to do this and is
   * also the ordinary way to build an open redirect: an attacker sends someone
   * a real sign-in link that lands them, freshly authenticated, on a page that
   * is not ours. There is nowhere in this app that needs a variable
   * destination, so there is no parameter to abuse.
   */
  return NextResponse.redirect(new URL("/", url.origin));
}

/** Home, with a message the app can show. Same origin, for the same reason. */
function failureUrl(origin: string, reason: string): URL {
  const target = new URL("/", origin);
  // Truncated: this ends up in a URL bar, and a provider's error text is not
  // something to hand back at whatever length it arrives in.
  target.searchParams.set("authError", reason.slice(0, 200));
  return target;
}
