import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import { supabaseServer } from "../supabase/server";

/**
 * Who is making this request.
 *
 * Read from the session cookie via Supabase, never from the request body. A
 * route that accepted a practitioner id from its caller would let anyone book
 * as anyone — and every authorization check downstream would be checking a
 * claim rather than a fact.
 *
 * `getUser()` rather than `getSession()`: the former revalidates the token with
 * Supabase, the latter trusts whatever the cookie says.
 */
export async function requireUser(): Promise<
  { user: User; db: SupabaseClient } | { response: Response }
> {
  const db = await supabaseServer();
  const { data, error } = await db.auth.getUser();

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
    return jsonError("Something went wrong on our end", 500);
  }
}
