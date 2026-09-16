"use client";

export const OPEN_NOTIFICATION_EVENT = "minimumstress:open-notification";
export const PUSH_RECEIVED_EVENT = "minimumstress:push-received";
const PENDING_KEY = "minimumstress:push-open";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PendingPushNavigation {
  /** Null is the backward-compatible generic Notifications destination. */
  notificationId: string | null;
}

/** Remember a notification tap across a cold app launch, then wake the UI. */
export function requestNotificationDestination(notificationId?: unknown): void {
  const token = typeof notificationId === "string" && UUID.test(notificationId)
    ? notificationId
    : null;
  try {
    window.sessionStorage.setItem(PENDING_KEY, token ? `notification:${token}` : "notifications");
  } catch {
    // The same-tab event still works when storage is unavailable.
  }
  window.dispatchEvent(new Event(OPEN_NOTIFICATION_EVENT));
}

export function consumeNotificationDestination(): PendingPushNavigation | null {
  let requested: PendingPushNavigation | null = null;

  // Web push can open a brand-new tab before the SDK listener exists. Consume
  // and remove the opaque marker so refresh/back never replays navigation.
  try {
    const url = new URL(window.location.href);
    const open = url.searchParams.get("open");
    if (open === "notification") {
      const token = url.searchParams.get("notification");
      requested = { notificationId: token && UUID.test(token) ? token : null };
      url.searchParams.delete("notification");
      url.searchParams.delete("open");
    } else if (open === "notifications") {
      requested = { notificationId: null };
      url.searchParams.delete("open");
    }
    if (requested) {
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
  } catch {
    // Fall through to the native/session marker.
  }

  try {
    const pending = window.sessionStorage.getItem(PENDING_KEY);
    window.sessionStorage.removeItem(PENDING_KEY);
    if (!requested && pending) {
      const token = pending.startsWith("notification:")
        ? pending.slice("notification:".length)
        : null;
      requested = { notificationId: token && UUID.test(token) ? token : null };
    }
  } catch {
    // The URL marker still works when storage is unavailable.
  }

  return requested;
}

/** Existing issued pushes had only a generic destination. */
export function requestNotificationsScreen(): void {
  requestNotificationDestination();
}

export function consumeNotificationsScreenRequest(): boolean {
  return consumeNotificationDestination() !== null;
}
