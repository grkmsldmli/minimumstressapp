"use client";

import { Bell } from "lucide-react";
import { useEffect, useState } from "react";

import { isNativeApp } from "@/lib/native";

/**
 * A one-tap "turn on notifications" control for the Notifications screen, shown
 * to both hosts and practitioners.
 *
 * Web push needs a real user gesture to raise the browser's permission prompt —
 * an auto-prompt on load is unreliable and, once dismissed or blocked, never
 * comes back. A clear button the person taps is the dependable path: the click
 * itself is the gesture, so the "Allow" prompt appears every time.
 *
 * It asks the browser directly (works even if the OneSignal SDK is slow to
 * load), then nudges OneSignal to register the subscription. It renders nothing
 * where push cannot work — the native shell (its own push comes from the native
 * plugin), a browser with no Notification API, or once permission is already
 * granted — and shows a short hint if the browser has it blocked.
 */

interface OneSignalPush {
  User: { PushSubscription: { optIn?: () => void } };
}

type Perm = "default" | "granted" | "denied" | "unsupported";

function readPermission(): Perm {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as Perm;
}

export function PushEnable() {
  const native = isNativeApp();
  const [perm, setPerm] = useState<Perm>("unsupported");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (native) return;
    // Read after mount (in a callback, not synchronously in the effect body) so
    // there is no hydration mismatch and no cascading render — the first paint
    // shows nothing, then this fills in the real permission state.
    const id = window.setTimeout(() => setPerm(readPermission()), 0);
    return () => window.clearTimeout(id);
  }, [native]);

  // Nothing to offer in the native shell, on an unsupported browser, or once
  // it is already on.
  if (native || perm === "unsupported" || perm === "granted") return null;

  const enable = async () => {
    if (busy || !("Notification" in window)) return;
    setBusy(true);
    try {
      // The click is the gesture, so this reliably shows the native prompt.
      const result = await Notification.requestPermission();
      setPerm(result as Perm);
      if (result === "granted") {
        // Let OneSignal (loaded app-wide by OneSignalInit) register the
        // subscription now that permission is ours.
        const w = window as unknown as {
          OneSignalDeferred?: Array<(os: OneSignalPush) => void>;
        };
        w.OneSignalDeferred = w.OneSignalDeferred ?? [];
        w.OneSignalDeferred.push((os) => {
          try {
            os.User.PushSubscription.optIn?.();
          } catch {
            /* already subscribed, or SDK unavailable — nothing to do */
          }
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="rounded-xl px-3.5 py-3 mb-3 flex items-start gap-2.5"
      style={{ backgroundColor: "#EDF6FE", border: "1px solid #D4E8FA" }}
    >
      <Bell size={16} color="#2578C2" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-body font-medium text-[15px] text-navy">Turn on notifications</p>
        {perm === "denied" ? (
          <p className="font-body font-normal text-[13.5px] mt-0.5 leading-relaxed text-ink-soft">
            Notifications are blocked for this site in your browser. Allow them in your browser&apos;s
            site settings to get booking alerts here.
          </p>
        ) : (
          <>
            <p className="font-body font-normal text-[13.5px] mt-0.5 leading-relaxed text-ink-soft">
              Get booking confirmations, messages and door codes the moment they happen.
            </p>
            <button
              type="button"
              onClick={() => void enable()}
              disabled={busy}
              className="mt-2.5 px-4 py-2 rounded-full font-body font-medium text-[14px] press disabled:opacity-60"
              style={{ backgroundColor: "#16304E", color: "#fff" }}
            >
              {busy ? "Turning on…" : "Turn on"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
