import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { headers } from "next/headers";

import { bearerToken } from "../auth-header";
import { supabaseServer } from "../supabase/server";

/**
 * Who is making this request.
 *
 * Read from the session, never from the request body. A route that accepted a
 * practitioner id from its caller would let anyone book as anyone — and every
 * authorization check downstream would be checking a claim rather than a fact.
 *
 * The session arrives one of two ways: the cookie on the web, or — because the
 * native shell's cookie does not survive its WebView — an `Authorization:
 * Bearer <jwt>` header carrying the same access token. Either way the token is
 * handed to `getUser`, which revalidates it with Supabase rather than trusting
 * it (unlike `getSession`), so a bearer is exactly as trustworthy as a cookie
 * and neither trusts a client-supplied identity.
 */
export async function requireUser(): Promise<
  { user: User; db: SupabaseClient } | { response: Response }
> {
  const db = await supabaseServer();
  const token = bearerToken((await headers()).get("authorization"));
  const { data, error } = token ? await db.auth.getUser(token) : await db.auth.getUser();

  if (error || !data.user) {
    return { response: jsonError("Sign in to continue", 401) };
  }
  return { user: data.user, db };
}

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * Wraps a handler so an unexpected throw becomes a 500 with nothing revealing
 * in it, while a deliberate `BookingError` keeps its own status and wording.
 *
 * Postgres errors in particular are worth swallowing: they name tables,
 * columns and constraints, which is free reconnaissance for anyone poking at
 * the API.
 */
export async function handled(work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (typeof status === "number") {
      return jsonError((error as Error).message, status);
    }
    console.error("Unhandled route error:", error);
    return jsonError(`Something went wrong on our end${because(error)}`, 500);
  }
}

/**
 * The real reason, outside production only.
 *
 * The blanket message above is right for the public internet and useless to
 * whoever is testing: a bare 500 in the console names no route, no call and no
 * cause, so finding out what broke means reading a server log in a terminal
 * nobody has open. Everything it withholds is already on the same laptop as
 * the screen the failure appeared on.
 *
 * Guarded on NODE_ENV rather than a flag somebody could set by mistake, and
 * Next sets that to "production" for `next build` and `next start` without
 * being asked.
 */
function because(error: unknown): string {
  if (process.env.NODE_ENV === "production") return "";
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return ` — ${detail}`;
}
