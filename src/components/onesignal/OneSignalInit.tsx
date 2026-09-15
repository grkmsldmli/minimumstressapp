"use client";

import { useEffect } from "react";

import { isNativeApp } from "@/lib/native";
import { isSiteHost } from "@/lib/site-host";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * OneSignal web push, wired to the signed-in account.
 *
 * Runs in exactly one place: a real browser on the APP host. It is skipped
 *  - inside the Capacitor native shell (its WebView can't do service-worker web
 *    push; native push is a separate plugin integration), and
 *  - on the marketing site (minimumstress.com) — no sign-in there, and that
 *    host's CSP would block the SDK anyway.
 *
 * It initialises the SDK once, then keeps the OneSignal "user" in step with the
 * Supabase session: login(userId) on sign-in so a push can be aimed at a person
 * across their devices from the server, logout() on sign-out so the next person
 * on the same browser is not tied to the last one.
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
    /** Set once the SDK setup has run; on window (not module scope) so it
     *  survives Fast Refresh and the SDK is never initialised twice. */
    __oneSignalStarted?: boolean;
  }
}

export function OneSignalInit() {
  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID || DEFAULT_APP_ID;
    // Web push only, app host only, once per page load. See the component note.
    if (
      !appId ||
      isNativeApp() ||
      isSiteHost(window.location.host) ||
      window.__oneSignalStarted
    ) {
      return;
    }
    window.__oneSignalStarted = true;

    // The SDK drains this queue when it loads; anything pushed after init still
    // runs, which is what lets the auth listener reach OneSignal later.
    const withOneSignal = (fn: (os: OneSignalApi) => void | Promise<void>) => {
      window.OneSignalDeferred = window.OneSignalDeferred ?? [];
      window.OneSignalDeferred.push(fn);
    };

    withOneSignal(async (os) => {
      try {
        await os.init({
          appId,
          allowLocalhostAsSecureOrigin: process.env.NODE_ENV !== "production",
        });
      } catch {
        // A stray second init throws "already initialized" — harmless; the auth
        // sync below still binds against the live SDK.
      }

      // Keep the OneSignal user in step with the Supabase session, driven only
      // by onAuthStateChange (it emits an INITIAL_SESSION event on load, so no
      // separate getSession() call is needed and nothing double-fires). Act only
      // on a real change of id, and only invite the prompt on a genuine sign-in
      // — never on the roughly-hourly token refresh.
      const supabase = supabaseBrowser();
      let lastId: string | null | undefined;
      supabase.auth.onAuthStateChange((_event, session) => {
        const userId = session?.user?.id ?? null;
        if (userId === lastId) return;
        const signingIn = userId !== null && !lastId;
        lastId = userId;
        withOneSignal(async (next) => {
          if (userId) {
            await next.login(userId);
            // promptPush has its own backoff, so even here it won't nag.
            if (signingIn && !next.User.PushSubscription.optedIn) next.Slidedown.promptPush();
          } else {
            await next.logout();
          }
        });
      });
    });

    // Load the page SDK. Injected here (not rendered as a <script>) so it is
    // never fetched in the native shell or on the marketing site, both guarded
    // above.
    if (!document.querySelector(`script[src="${SDK_SRC}"]`)) {
      const script = document.createElement("script");
      script.src = SDK_SRC;
      script.defer = true;
      document.head.appendChild(script);
    }
  }, []);

  return null;
}
