/**
 * The one account that signs in with a password instead of an emailed code.
 *
 * Everybody else uses the passwordless flow (a six-digit code to their inbox),
 * which is the whole product's front door — see lib/supabase/auth.ts. But an
 * app reviewer signs in from a machine that has no access to that inbox and
 * cannot receive the code, so for this single, known address the login screen
 * offers a password field wired to Supabase's password grant instead.
 *
 * Nothing here is a secret. The address is not sensitive, and there is no
 * password in this file, this repository, or the client bundle — the account
 * and its password are created by hand in Supabase Auth, and the only thing the
 * app knows is which address to show a password box for. Deliberately no label
 * naming who the reviewer is: to anyone who types this address it is simply a
 * standard password sign-in.
 */

/** The reviewer address. An email is not a credential; the password is, and it is not here. */
export const REVIEWER_EMAIL = "minimumstress.review@gmail.com";

/**
 * Whether a typed address is the reviewer account, so the screen knows to ask
 * for a password rather than send a code.
 *
 * Trimmed and lower-cased because a reviewer pastes the address and email
 * casing is not significant; the match is otherwise exact, so no ordinary user
 * is ever routed away from the code flow.
 */
export function isReviewerEmail(email: string): boolean {
  return email.trim().toLowerCase() === REVIEWER_EMAIL;
}
