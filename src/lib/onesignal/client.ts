"use client";

import { apiFetch } from "@/lib/api-fetch";
import { isNativeApp } from "@/lib/native";

import { publicOneSignalAppId } from "./config";

type NativeOneSignal = (typeof import("@onesignal/capacitor-plugin"))["default"];

let nativePromise: Promise<NativeOneSignal | null> | null = null;

/** Initialize the native bridge once. Old store binaries fail closed here. */
export function nativeOneSignal(): Promise<NativeOneSignal | null> {
  if (!isNativeApp()) return Promise.resolve(null);
  if (nativePromise) return nativePromise;

  nativePromise = import("@onesignal/capacitor-plugin")
    .then(async ({ default: sdk }) => {
      // This must happen before initialize: until the person has explicitly
      // enabled notifications, the SDK is not allowed to send device data to
      // OneSignal. PushEnable grants consent only after OS permission exists.
      sdk.setConsentRequired(true);
      // Consent persists inside the native SDK. Re-gate every process launch
      // before initialization so a previously bound account cannot emit data
      // while the current Supabase session is still unknown.
      sdk.setConsentGiven(false);
      await sdk.initialize(publicOneSignalAppId());
      return sdk;
    })
    .catch(() => null);

  return nativePromise;
}

/**
 * Ask our authenticated server for this account's opaque push identity.
 * The raw Supabase UUID never becomes a OneSignal External ID.
 */
export async function currentPushIdentity(): Promise<string | null> {
  try {
    const response = await apiFetch("/api/onesignal/identity", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { externalId?: unknown };
    return typeof body.externalId === "string" && /^ms_[A-Za-z0-9_-]{43}$/.test(body.externalId)
      ? body.externalId
      : null;
  } catch {
    return null;
  }
}
