/** Public OneSignal App ID used by the web page and both native shells. */
export const DEFAULT_ONESIGNAL_APP_ID = "9a689fef-6763-4b4d-82ba-f2fe8cf929d2";

export function publicOneSignalAppId(): string {
  return process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID?.trim() || DEFAULT_ONESIGNAL_APP_ID;
}
