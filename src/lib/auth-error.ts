/**
 * One user-safe sentence for any sign-in failure.
 *
 * The auth screens have nowhere to hide a stack trace, so whatever comes back —
 * a Supabase error, a dropped connection, something with no message at all —
 * has to become a single line a person can act on. Supabase's own messages
 * ("Invalid login credentials", "Email rate limit exceeded") are already
 * written for the person, so they pass through; anything without a message
 * falls back to the network guess, which is the usual cause.
 *
 * It only ever reads error.message, so a password handed to a failing sign-in
 * can never leak into what the screen shows.
 */
export function describeAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message || "We couldn't reach the server. Check your connection and try again.";
}
