"use client";

import { Bell } from "lucide-react";
import { useEffect, useState } from "react";

import { isNativeApp } from "@/lib/native";
import { nativeOneSignal } from "@/lib/onesignal/client";
import {
  nativePushConsentGiven,
  setNativePushConsentGiven,
} from "@/lib/onesignal/consent";
import { requestNativePushOptIn } from "@/lib/onesignal/native-sync";
import { webOneSignal } from "@/lib/onesignal/web";
import { requestWebPushOptIn } from "@/lib/onesignal/web-sync";

type PushState = "checking" | "unsupported" | "ready" | "blocked" | "repair" | "on" | "error";

/** One user gesture that enables push in either a browser or a native shell. */
export function PushEnable() {
  const [state, setState] = useState<PushState>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stopped = false;

    if (isNativeApp()) {
      let removeChange: (() => void) | undefined;

      void nativeOneSignal().then(async (oneSignal) => {
        if (!oneSignal || stopped) {
          if (!stopped) setState("unsupported");
          return;
        }

        const refresh = async () => {
          const permitted = await oneSignal.Notifications.hasPermission();
          const consented = nativePushConsentGiven();
          if (!consented) {
            oneSignal.setConsentGiven(false);
            if (!stopped) setState("ready");
            return;
          }
          if (!permitted) {
            setNativePushConsentGiven(false);
            oneSignal.setConsentGiven(false);
            if (!stopped) setState("blocked");
            return;
          }
          const optedIn = await oneSignal.User.pushSubscription.getOptedInAsync();
          if (!stopped) setState(optedIn ? "on" : "repair");
        };

        const onChange = () => void refresh();
        oneSignal.User.pushSubscription.addEventListener("change", onChange);
        removeChange = () =>
          oneSignal.User.pushSubscription.removeEventListener("change", onChange);
        await refresh().catch(() => {
          if (!stopped) setState("error");
        });
      });

      return () => {
        stopped = true;
        removeChange?.();
      };
    }

    if (!("Notification" in window)) {
      queueMicrotask(() => {
        if (!stopped) setState("unsupported");
      });
      return;
    }

    let removeChange: (() => void) | undefined;
    const permission = Notification.permission;
    queueMicrotask(() => {
      if (!stopped) setState(permission === "denied" ? "blocked" : "checking");
    });

    void webOneSignal().then((oneSignal) => {
      if (stopped) return;
      const subscription = oneSignal.User.PushSubscription;
      const refresh = () => {
        if (stopped) return;
        const nextPermission = Notification.permission;
        setState(
          nextPermission === "denied"
            ? "blocked"
            : nextPermission === "granted" && subscription.optedIn
              ? "on"
              : nextPermission === "granted"
                ? "repair"
                : "ready",
        );
      };
      const onChange = () => refresh();
      subscription.addEventListener?.("change", onChange);
      removeChange = () => subscription.removeEventListener?.("change", onChange);
      refresh();
    });

    return () => {
      stopped = true;
      removeChange?.();
    };
  }, []);

  if (state === "checking" || state === "unsupported" || state === "on") return null;

  const enable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (isNativeApp()) {
        const oneSignal = await nativeOneSignal();
        if (!oneSignal) {
          setState("unsupported");
          return;
        }
        const permitted = await oneSignal.Notifications.requestPermission(true);
        if (!permitted) {
          setNativePushConsentGiven(false);
          oneSignal.setConsentGiven(false);
          setState("blocked");
          return;
        }
        setNativePushConsentGiven(true);
        if (!(await requestNativePushOptIn())) {
          setNativePushConsentGiven(false);
          oneSignal.setConsentGiven(false);
          throw new Error("Push identity unavailable");
        }
        setState((await oneSignal.User.pushSubscription.getOptedInAsync()) ? "on" : "repair");
        return;
      }

      const oneSignal = await webOneSignal();
      if (Notification.permission === "default") {
        // Ask the browser directly while OneSignal is still consent-gated.
        await Notification.requestPermission();
      }
      if (Notification.permission === "denied") {
        await oneSignal.setConsentGiven(false);
        setState("blocked");
        return;
      }
      if (Notification.permission !== "granted") {
        setState("ready");
        return;
      }
      if (!(await requestWebPushOptIn())) throw new Error("Push identity unavailable");
      setState(oneSignal.User.PushSubscription.optedIn ? "on" : "repair");
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  };

  const blocked = state === "blocked";
  const repair = state === "repair";
  const native = isNativeApp();

  return (
    <div
      className="rounded-xl px-3.5 py-3 mb-3 flex items-start gap-2.5"
      style={{ backgroundColor: "#EDF6FE", border: "1px solid #D4E8FA" }}
    >
      <Bell size={16} color="#2578C2" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-body font-medium text-[15px] text-navy">Turn on notifications</p>
        <p className="font-body font-normal text-[13.5px] mt-0.5 leading-relaxed text-ink-soft">
          {blocked
            ? "Notifications are blocked. Allow them in this device’s settings, then try again."
            : repair
              ? "Permission is allowed, but this device is not subscribed yet. Finish setup to receive booking alerts."
              : state === "error"
                ? "Notifications could not be enabled. Check your connection and try again."
                : "Get booking confirmations and important updates as soon as they happen."}
        </p>
        {(!blocked || native) && (
          <button
            type="button"
            onClick={() => void enable()}
            disabled={busy}
            className="mt-2.5 px-4 py-2 rounded-full font-body font-medium text-[14px] press disabled:opacity-60"
            style={{ backgroundColor: "#16304E", color: "#fff" }}
          >
            {busy
              ? "Turning on…"
              : blocked
                ? "Open settings"
                : repair
                  ? "Finish setup"
                  : "Turn on"}
          </button>
        )}
      </div>
    </div>
  );
}
