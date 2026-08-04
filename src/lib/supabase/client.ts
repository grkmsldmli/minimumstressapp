"use client";

import { createBrowserClient } from "@supabase/ssr";

import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * Browser client, carrying the publishable key and the signed-in user's
 * session.
 *
 * Everything it can reach is bounded by the RLS policies in
 * supabase/migrations/0002_rls.sql, which is what makes it safe to ship this
 * key in the bundle. It is not a lesser version of the secret key — it is the
 * only key that should ever touch a browser.
 */
let cached: ReturnType<typeof createBrowserClient> | null = null;

export function supabaseBrowser() {
  // One instance per tab, so the auth session and its refresh timer are not
  // duplicated across components.
  cached ??= createBrowserClient(supabaseUrl(), supabasePublishableKey());
  return cached;
}
