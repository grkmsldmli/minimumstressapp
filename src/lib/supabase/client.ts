"use client";

import { createBrowserClient } from "@supabase/ssr";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";

import { isNativeApp } from "../native";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * Browser client, carrying the publishable key and the signed-in user's
 * session.
 *
 * Everything it can reach is bounded by the RLS policies in
 * supabase/migrations/0002_rls.sql, which is what makes it safe to ship this
 * key in the bundle. It is not a lesser version of the secret key — it is the
 * only key that should ever touch a browser.
 *
 * Two storages, one for each place this runs.
 *
 * On the web the session lives in cookies (@supabase/ssr), because the server
 * has to read it too — the OAuth callback exchanges a code into a cookie a
 * Server Component can see.
 *
 * In the native shell it lives in localStorage instead. The Capacitor Android
 * WebView does not persist the SSR cookies reliably, so a fresh sign-in was
 * lost the instant it happened and the app bounced back to the start — the bug
 * this exists to fix. localStorage does persist in the WebView, and the native
 * app signs in by email code only (no OAuth callback, so nothing needs the
 * cookie). The choice is gated on isNativeApp(), so the web is untouched.
 */
let cached: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (cached) return cached;

  // One instance per tab, so the auth session and its refresh timer are not
  // duplicated across components.
  cached = isNativeApp()
    ? createClient(supabaseUrl(), supabasePublishableKey(), {
        auth: {
          storage: window.localStorage,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      })
    : createBrowserClient(supabaseUrl(), supabasePublishableKey());

  return cached;
}
