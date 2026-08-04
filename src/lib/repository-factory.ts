/**
 * Which Repository the app runs against.
 *
 * Both are complete. The mock holds everything in memory and is what the app
 * falls back to; the Supabase one reads and writes the live project, and books
 * and cancels through server routes because pricing a booking on the client
 * would let a client price it however it liked.
 *
 * The switch is `NEXT_PUBLIC_USE_SUPABASE`. It stays a switch rather than
 * becoming a hard default because the mock is genuinely useful: every screen
 * works with no account, no network and no card, which is what makes the
 * design reviewable and the empty states real.
 */

import { MockRepository } from "./mock-repository";
import type { Repository } from "./repository";
import { SupabaseRepository } from "./supabase-repository";
import { supabaseBrowser } from "./supabase/client";

export type AppRepository = Repository & {
  simulateInboundBooking(spaceId: string): Promise<unknown>;
};

/**
 * Not a hook, despite reading like state — it is a build-time constant.
 *
 * It was called `useSupabaseBackend`, which made the rules-of-hooks lint treat
 * every plain function that called it as a broken component. The `use` prefix
 * is reserved for a reason.
 */
export function supabaseBackendEnabled(): boolean {
  return process.env.NEXT_PUBLIC_USE_SUPABASE === "true";
}

export function createRepository(): AppRepository {
  if (!supabaseBackendEnabled()) return new MockRepository();

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
