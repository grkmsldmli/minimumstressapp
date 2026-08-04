/**
 * Which Repository the app runs against.
 *
 * The Supabase implementation is written, typechecked and pointed at a live
 * project whose schema and RLS are verified — but it is not the default yet,
 * and the reason is worth stating plainly rather than leaving as a mystery
 * flag.
 *
 * Creating a booking must (a) price it server-side, because a client that
 * computes its own total can simply send a smaller one, and (b) write the
 * booking row, its credit_ledger entry and a Stripe PaymentIntent as one unit.
 * A client interrupted between those steps leaves money in a state nobody
 * reconciles. That work needs a server route holding the secret key, so it
 * arrives with the Stripe milestone.
 *
 * Switching before then would trade a demo where every flow works for one that
 * falls over at the moment of booking. So the mock stays in charge, and the
 * Supabase path is exercised by its own tests rather than half-wired here.
 *
 * To flip it once payments land: set NEXT_PUBLIC_USE_SUPABASE=true.
 */

import { MockRepository } from "./mock-repository";
import type { Repository } from "./repository";

export type AppRepository = Repository & {
  simulateInboundBooking(spaceId: string): Promise<unknown>;
};

export function useSupabaseBackend(): boolean {
  return process.env.NEXT_PUBLIC_USE_SUPABASE === "true";
}

export function createRepository(): AppRepository {
  return new MockRepository();
}
