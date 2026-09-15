"use client";

import { useEffect } from "react";

import { isNativeApp } from "@/lib/native";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * OneSignal web push, wired to the signed-in account.
 *
 * Runs ONLY in a real browser — never inside the Capacitor native shell. That
 * shell's WebView cannot do service-worker web push (its own native push is a
 * separate, later integration through the OneSignal Capacitor plugin), and
 * trying to register a service worker there only errors. So the whole thing is
 * gated on !isNativeApp().
 *
 * It initialises the SDK, then keeps the OneSignal "user" in step with the
 * Supabase session: on sign-in it calls login(userId) so a push can be aimed at
 * a person across their devices from the server, and on sign-out it calls
 * logout() so the next person on the same browser is not tied to the last one.
 *
 * The App ID is public — it ships in the page source of every web-push site, so
 * defaulting it here is safe. The secret REST API key that SENDS pushes lives
 * only on the server and never appears in this file.
 */

const SDK_SRC = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";

/** Public OneSignal App ID for Minimum Stress; override per environment if needed. */
const DEFAULT_APP_ID = "9a689fef-6763-4b4d-82ba-f2fe8cf929d2";

interface OneSignalApi {
  init(options: { appId: string; allowLocalhostAsSecureOrigin?: boolean }): Promise<void>;
  login(externalId: string): Promise<void>;
  logout(): Promise<void>;
  Slidedown: { promptPush(options?: { force?: boolean }): void };
  User: { PushSubscription: { optedIn?: boolean } };
}

declare global {
  interface Window {
    OneSignalDeferred?: Array<(os: OneSignalApi) => void | Promise<void>>;
  }
}

// Once per page load. React StrictMode (dev) double-invokes effects and HMR
// re-runs them, and initialising the SDK twice throws "SDK already initialized";
// a module-level latch keeps init and the auth listener to exactly one setup.
let started = false;

export function OneSignalInit() {
  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID || DEFAULT_APP_ID;
    // Web push only, once, and only when we have an App ID. The native shell
    // uses the native plugin instead — see the component comment.
    if (!appId || isNativeApp() || started) return;
    started = true;

    // The SDK drains this queue when it loads; anything pushed after init still
    // runs, which is what lets the auth listener reach OneSignal later.
    const withOneSignal = (fn: (os: OneSignalApi) => void | Promise<void>) => {
      window.OneSignalDeferred = window.OneSignalDeferred ?? [];
      window.OneSignalDeferred.push(fn);
    };

    const syncUser = (userId: string | null | undefined) => {
      withOneSignal(async (os) => {
        if (userId) {
          await os.login(userId);
          // Invite a signed-in visitor to turn on notifications. promptPush has
          // its own backoff, so a dismissal is remembered and this does not nag.
          if (!os.User.PushSubscription.optedIn) os.Slidedown.promptPush();
        } else {
          await os.logout();
        }
      });
    };

    withOneSignal(async (os) => {
      await os.init({
        appId,
        allowLocalhostAsSecureOrigin: process.env.NODE_ENV !== "production",
      });

      const supabase = supabaseBrowser();
      const { data } = await supabase.auth.getSession();
      syncUser(data.session?.user?.id ?? null);
      supabase.auth.onAuthStateChange((_event, session) => {
        syncUser(session?.user?.id ?? null);
      });
    });

    // Load the page SDK. Injected here rather than rendered as a <script> so it
    // is never fetched inside the native shell (guarded above).
    if (!document.querySelector(`script[src="${SDK_SRC}"]`)) {
      const script = document.createElement("script");
      script.src = SDK_SRC;
      script.defer = true;
      document.head.appendChild(script);
    }
  }, []);

  return null;
}
