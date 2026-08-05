/**
 * Who counts as staff.
 *
 * An environment variable rather than a column, and the difference matters.
 * A column is a row somebody could flip — through a policy mistake, a stray
 * update, a compromised session — and the thing it unlocks is every lease
 * document and every home address in the database. The allowlist lives where
 * only Vercel holds it, cannot be reached by any query, and changing it takes
 * a deploy.
 *
 * The trade is real: adding a colleague means editing a setting rather than
 * ticking a box. For an operation with one or two people that is the right way
 * round, and it stops being right somewhere around a team of ten — at which
 * point this becomes a table with its own policies and its own audit trail.
 */

/** Comma-separated, because a single operator is the ordinary case. */
export function staffEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Whether this address is staff.
 *
 * Compared lowercased, because an email that differs only in case is the same
 * mailbox and somebody signing in as `Minimum@…` should not be locked out of
 * their own dashboard.
 *
 * An empty allowlist grants nothing. The alternative — treating "unset" as
 * "everybody" — is how a staging deploy with no configuration ends up serving
 * lease documents to the internet.
 */
export function isStaff(email: string | null | undefined): boolean {
  if (!email) return false;

  const allowed = staffEmails();
  if (allowed.length === 0) return false;

  return allowed.includes(email.trim().toLowerCase());
}

/** True when nobody has been named yet, so the page can say so rather than 404. */
export function adminUnconfigured(): boolean {
  return staffEmails().length === 0;
}
