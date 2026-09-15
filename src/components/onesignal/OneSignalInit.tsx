"use client";

import type { NotificationClickEvent } from "@onesignal/capacitor-plugin";
import { useEffect } from "react";

import { isNativeApp } from "@/lib/native";
import { currentPushIdentity, nativeOneSignal } from "@/lib/onesignal/client";
import { publicOneSignalAppId } from "@/lib/onesignal/config";
import {
  nativePushConsentGiven,
  setNativePushConsentGiven,
} from "@/lib/onesignal/consent";
import {
  NATIVE_PUSH_OPT_IN_EVENT,
  type NativePushOptInRequest,
} from "@/lib/onesignal/native-sync";
import { requestNotificationsScreen } from "@/lib/onesignal/navigation";
import { type OneSignalWebApi, withWebOneSignal } from "@/lib/onesignal/web";
import {
  WEB_PUSH_OPT_IN_EVENT,
  type WebPushOptInRequest,
} from "@/lib/onesignal/web-sync";
import { isSiteHost } from "@/lib/site-host";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * OneSignal push, wired to the signed-in account.
 *
 * The browser uses the Web SDK and the Capacitor shell uses the native SDK.
 * Both obtain an opaque External ID from our authenticated server; a raw
 * Supabase UUID is never handed to OneSignal. It is skipped on the marketing
 * site (minimumstress.com) — no sign-in there, and that
 *    host's CSP would block the SDK anyway.
 *
 * It initialises the SDK once, then keeps the OneSignal "user" in step with the
 * Supabase session: login(opaqueId) on sign-in so a push can be aimed at a person
 * across their devices from the server, logout() on sign-out so the next person
 * on the same browser is not tied to the last one.
 *
 * The App ID is public — it ships in the page source of every web-push site, so
 * defaulting it here is safe. The secret REST API key that SENDS pushes lives
 * only on the server and never appears in this file.
 */

const SDK_SRC = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";

export function OneSignalInit() {
  useEffect(() => {
    const appId = publicOneSignalAppId();
    const native = isNativeApp();
    if (
      !appId ||
      isSiteHost(window.location.host) ||
      window.__oneSignalStarted ||
      (!native && !("Notification" in window))
    ) return;
    window.__oneSignalStarted = true;

    const supabase = supabaseBrowser();
    let stopped = false;
    let authRevision = 0;
    let unsubscribeAuth: (() => void) | undefined;

    if (native) {
      let removeClick: (() => void) | undefined;
      let removeOptIn: (() => void) | undefined;

      void nativeOneSignal().then(async (os) => {
        if (!os || stopped) return;

        // Keep initialization gated until Supabase emits INITIAL_SESSION. OS
        // permission alone is not consent (Android 12 and lower report it true
        // before any prompt); the app-owned flag is set only by PushEnable.
        os.setConsentGiven(false);

        let currentUserId: string | null | undefined;
        let authQueue: Promise<void> = Promise.resolve();

        const queueAuthSync = (
          userId: string | null | undefined,
          revision: number,
          optIn: boolean,
        ): Promise<boolean> => {
          let complete: (success: boolean) => void = () => undefined;
          const result = new Promise<boolean>((resolve) => {
            complete = resolve;
          });

          authQueue = authQueue
            .catch(() => undefined)
            .then(async () => {
              if (stopped || revision !== authRevision || userId === undefined) {
                complete(false);
                return;
              }

              if (!userId) {
                // Always detach the previous account, even when OS permission
                // was revoked. Serializing this work guarantees a newer login
                // runs after an already-started logout.
                await os.logout().catch(() => undefined);
                if (!stopped && revision === authRevision) os.setConsentGiven(false);
                complete(false);
                return;
              }

              const consented = nativePushConsentGiven();
              const hasPermission = await os.Notifications.hasPermission().catch(() => false);
              if (stopped || revision !== authRevision) {
                complete(false);
                return;
              }
              if (!consented || !hasPermission) {
                if (!hasPermission) setNativePushConsentGiven(false);
                await os.logout().catch(() => undefined);
                if (!stopped && revision === authRevision) os.setConsentGiven(false);
                complete(false);
                return;
              }

              const externalId = await currentPushIdentity();
              if (!externalId || stopped || revision !== authRevision) {
                if (!stopped && revision === authRevision) os.setConsentGiven(false);
                complete(false);
                return;
              }

              os.setConsentGiven(true);
              try {
                await os.login(externalId);
                if (stopped || revision !== authRevision) {
                  complete(false);
                  return;
                }
                if (optIn) await os.User.pushSubscription.optIn();
                complete(true);
              } catch {
                if (!stopped && revision === authRevision) os.setConsentGiven(false);
                complete(false);
              }
            })
            .catch(() => complete(false));

          return result;
        };

        const onClick = (event: NotificationClickEvent) => {
          const data = event.notification.additionalData as Record<string, unknown> | undefined;
          const destination = data?.minimumstress_destination;
          // Missing keeps already-issued notifications backward compatible.
          if (destination === undefined || destination === "notifications") {
            requestNotificationsScreen();
          }
        };
        os.Notifications.addEventListener("click", onClick);
        removeClick = () => os.Notifications.removeEventListener("click", onClick);

        const onOptIn = (event: Event) => {
          const request = (event as CustomEvent<NativePushOptInRequest>).detail;
          if (!request || request.accepted) return;
          request.accepted = true;
          const revision = ++authRevision;
          void queueAuthSync(currentUserId, revision, true).then(request.complete);
        };
        window.addEventListener(NATIVE_PUSH_OPT_IN_EVENT, onOptIn);
        removeOptIn = () => window.removeEventListener(NATIVE_PUSH_OPT_IN_EVENT, onOptIn);

        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
          currentUserId = session?.user?.id ?? null;
          const revision = ++authRevision;
          void queueAuthSync(currentUserId, revision, false);
        });
        unsubscribeAuth = () => data.subscription.unsubscribe();
      });

      return () => {
        stopped = true;
        authRevision += 1;
        unsubscribeAuth?.();
        removeClick?.();
        removeOptIn?.();
        window.__oneSignalStarted = false;
      };
    }

    // The SDK drains this queue when it loads; anything pushed after init still
    // runs, which is what lets the auth listener reach OneSignal later.
    const withOneSignal = (fn: (os: OneSignalWebApi) => void | Promise<void>) =>
      withWebOneSignal(fn);
    let removeWebOptIn: (() => void) | undefined;

    withOneSignal(async (os) => {
      if (stopped) return;
      // Require an explicit notification choice before OneSignal can collect
      // device/session data. Existing subscribers are preserved because their
      // browser permission is already granted.
      await os.setConsentRequired(true);
      // `false` is safe before init (unlike `true`, which triggers delayed
      // initialization in Web SDK v16) and closes any persisted-consent window.
      await os.setConsentGiven(false);
      let initialized = false;
      let initPromise: Promise<void>;
      try {
        initPromise = os
          .init({
            appId,
            allowLocalhostAsSecureOrigin: process.env.NODE_ENV !== "production",
            requiresUserPrivacyConsent: true,
          })
          .then(() => {
            initialized = true;
          })
          .catch(() => {
            // A stray second init throws "already initialized"; use the live SDK.
            initialized = true;
          });
      } catch {
        initialized = true;
        initPromise = Promise.resolve();
      }
      if (stopped) return;

      let removeClick: (() => void) | undefined;
      void initPromise.then(() => {
        if (stopped) return;
        const onClick = () => requestNotificationsScreen();
        os.Notifications?.addEventListener?.("click", onClick);
        removeClick = () => os.Notifications?.removeEventListener?.("click", onClick);
      });

      let currentUserId: string | null | undefined;
      let webAuthQueue: Promise<void> = Promise.resolve();

      const queueWebAuthSync = (
        userId: string | null | undefined,
        revision: number,
        optIn: boolean,
      ): Promise<boolean> => {
        let complete: (success: boolean) => void = () => undefined;
        const result = new Promise<boolean>((resolve) => {
          complete = resolve;
        });

        webAuthQueue = webAuthQueue
          .catch(() => undefined)
          .then(async () => {
            if (stopped || revision !== authRevision || userId === undefined) {
              complete(false);
              return;
            }

            if (!userId) {
              // Before first consent, init is intentionally pending and there
              // is no active network context to log out. Once initialized,
              // detach the bound identity before re-gating collection.
              if (initialized) await os.logout().catch(() => undefined);
              if (!stopped && revision === authRevision) {
                await os.setConsentGiven(false).catch(() => undefined);
              }
              complete(false);
              return;
            }

            if (Notification.permission !== "granted") {
              await os.setConsentGiven(false).catch(() => undefined);
              complete(false);
              return;
            }

            const externalId = await currentPushIdentity();
            if (!externalId || stopped || revision !== authRevision) {
              if (!stopped && revision === authRevision) {
                await os.setConsentGiven(false).catch(() => undefined);
              }
              complete(false);
              return;
            }

            try {
              const grantConsent = os.setConsentGiven(true);
              await Promise.all([grantConsent, initPromise]);
              if (stopped || revision !== authRevision) {
                complete(false);
                return;
              }
              await os.login(externalId);
              if (stopped || revision !== authRevision) {
                complete(false);
                return;
              }
              if (optIn) {
                if (!os.User.PushSubscription.optIn) {
                  complete(false);
                  return;
                }
                await os.User.PushSubscription.optIn();
              }
              complete(true);
            } catch {
              if (!stopped && revision === authRevision) {
                await os.setConsentGiven(false).catch(() => undefined);
              }
              complete(false);
            }
          })
          .catch(() => complete(false));

        return result;
      };

      const onWebOptIn = (event: Event) => {
        const request = (event as CustomEvent<WebPushOptInRequest>).detail;
        if (!request || request.accepted) return;
        request.accepted = true;
        const revision = ++authRevision;
        void queueWebAuthSync(currentUserId, revision, true).then(request.complete);
      };
      window.addEventListener(WEB_PUSH_OPT_IN_EVENT, onWebOptIn);
      removeWebOptIn = () => window.removeEventListener(WEB_PUSH_OPT_IN_EVENT, onWebOptIn);

      // Keep the OneSignal user in step with the Supabase session, driven only
      // by onAuthStateChange (it emits an INITIAL_SESSION event on load, so no
      // separate getSession() call is needed and nothing double-fires). Act only
      // on a real change of id, and only invite the prompt on a genuine sign-in
      // — never on the roughly-hourly token refresh.
      let lastId: string | null | undefined;
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        const userId = session?.user?.id ?? null;
        currentUserId = userId;
        if (userId === lastId) return;
        lastId = userId;
        const revision = ++authRevision;
        void queueWebAuthSync(userId, revision, false);
      });
      unsubscribeAuth = () => {
        data.subscription.unsubscribe();
        removeClick?.();
      };
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

    return () => {
      stopped = true;
      authRevision += 1;
      unsubscribeAuth?.();
      removeWebOptIn?.();
      window.__oneSignalStarted = false;
    };
  }, []);

  return null;
}
