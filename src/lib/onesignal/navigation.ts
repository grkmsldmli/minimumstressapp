"use client";

export const OPEN_NOTIFICATIONS_EVENT = "minimumstress:open-notifications";
const PENDING_KEY = "minimumstress:push-open";

/** Remember a notification tap across a cold app launch, then wake the UI. */
export function requestNotificationsScreen(): void {
  try {
    window.sessionStorage.setItem(PENDING_KEY, "1");
  } catch {
    // The same-tab event still works when storage is unavailable.
  }
  window.dispatchEvent(new Event(OPEN_NOTIFICATIONS_EVENT));
}
export function consumeNotificationsScreenRequest(): boolean {
  let requested = false;

  // Web push can open a brand-new tab, before the SDK click listener exists.
  // Consume its non-sensitive URL marker once, then remove it from the address
  // bar so refresh/back never replays the navigation.
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("open") === "notifications") {
      url.searchParams.delete("open");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
      requested = true;
    }
  } catch {
    // Fall through to the native/session marker.
  }

  try {
    if (window.sessionStorage.getItem(PENDING_KEY) === "1") {
      window.sessionStorage.removeItem(PENDING_KEY);
      requested = true;
    }
  } catch {
    // The URL marker still works when storage is unavailable.
  }

  return requested;
}
