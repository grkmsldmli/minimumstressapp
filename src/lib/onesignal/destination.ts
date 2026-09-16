export interface NotificationTarget {
  bookingId: string | null;
  kind: string;
}

export type NotificationDestination =
  | { screen: "notifications" }
  | { screen: "thread"; bookingId: string }
  | { screen: "review"; bookingId: string; role: "practitioner" | "host" };

/**
 * Route only after the opaque notification row has resolved through RLS and
 * the booking appears in the signed-in account's own snapshot.
 */
export function notificationDestination(
  target: NotificationTarget | null,
  practitionerBookingIds: ReadonlySet<string>,
  hostBookingIds: ReadonlySet<string>,
): NotificationDestination {
  if (!target?.bookingId) return { screen: "notifications" };

  const practitioner = practitionerBookingIds.has(target.bookingId);
  const host = hostBookingIds.has(target.bookingId);
  if (!practitioner && !host) return { screen: "notifications" };

  if (target.kind === "new_message") {
    return { screen: "thread", bookingId: target.bookingId };
  }

  if (target.kind === "review_prompt" || target.kind === "review_reminder") {
    return {
      screen: "review",
      bookingId: target.bookingId,
      role: practitioner ? "practitioner" : "host",
    };
  }

  return { screen: "notifications" };
}
