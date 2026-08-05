/**
 * Which Repository the app runs against.
 *
 * The default is the real one, and that inversion is the whole point of this
 * file's history. It used to be `NEXT_PUBLIC_USE_SUPABASE === "true"`, so a
 * deployment that simply never set the variable ran the in-memory mock — and
 * did it silently. Production shipped that way: no sign-in code was ever sent
 * because nothing asked Supabase to send one, any six digits were accepted
 * because nothing checked them, and every listing on the screen was seed data
 * that existed only in that browser tab. Everything looked like it worked.
 *
 * A missing environment variable now means the real backend, which is the safe
 * direction to fail in. The mock is a development convenience and has to be
 * asked for by name.
 */

import { MockRepository } from "./mock-repository";
import type { Repository } from "./repository";
import { SupabaseRepository } from "./supabase-repository";
import { supabaseBrowser } from "./supabase/client";

export type AppRepository = Repository & {
  simulateInboundBooking(spaceId: string): Promise<unknown>;
};

/**
 * True unless somebody deliberately opted into the mock.
 *
 * Not a hook, despite reading like state — it is a build-time constant. It was
 * called `useSupabaseBackend` once, which made the rules-of-hooks lint treat
 * every plain function that called it as a broken component.
 */
export function supabaseBackendEnabled(): boolean {
  return process.env.NEXT_PUBLIC_USE_MOCK !== "true";
}

export function createRepository(): AppRepository {
  if (!supabaseBackendEnabled()) {
    /**
     * Loud, because the mock accepts any sign-in code and stores nothing.
     *
     * Anybody who reaches this without meaning to is about to spend an hour
     * wondering why their email never arrives, and the only clue would be that
     * everything works slightly too well.
     */
    console.warn(
      "Running on the in-memory mock: no email is sent, any code is accepted, and nothing is saved. Unset NEXT_PUBLIC_USE_MOCK to use the real backend.",
    );
    return new MockRepository();
  }

  /**
   * Cast rather than implemented, and worth saying why out loud.
   *
   * `simulateInboundBooking` exists so a host can see their own dashboard with
   * something in it before any practitioner has found them. Against the real
   * database it returns null and does nothing — inventing a booking there
   * would mean inventing a practitioner, a payment and an obligation to
   * somebody, which is exactly the class of fake data this app has been
   * careful to keep out of screens hosts use for money.
   */
  return new SupabaseRepository(supabaseBrowser()) as AppRepository;
}
