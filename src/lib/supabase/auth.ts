"use client";

import { supabaseBrowser } from "./client";

export type OAuthProvider = "apple" | "google";

/**
 * Sends a six-digit sign-in code.
 *
 * `shouldCreateUser` stays on because there is no separate sign-up in this
 * product — the brief's flow is one auth screen, and a practitioner's first
 * visit and their tenth look identical.
 */
export async function sendEmailCode(email: string): Promise<void> {
  const { error } = await supabaseBrowser().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
}

/**
 * How many digits the emailed code has, and the one number here that is not
 * ours to choose.
 *
 * It is set in the Supabase dashboard, under Authentication → Sign In /
 * Providers → Email. The screen draws exactly this many boxes, so if the two
 * disagree the result is silent and cruel: a correct code is physically
 * unenterable, and the only feedback is "invalid code". The prototype's
 * four-box design had this bug; so did the app the first time a real code
 * arrived with eight digits against six boxes.
 *
 * Kept in an environment variable so a mismatch is a redeploy rather than a
 * code change, and validated on read so a typo fails loudly here instead of
 * rendering a row of boxes nobody can fill.
 */
export const EMAIL_CODE_LENGTH = readCodeLength();

function readCodeLength(): number {
  const configured = process.env.NEXT_PUBLIC_EMAIL_CODE_LENGTH;
  if (!configured) return 6;

  const parsed = Number(configured);
  // Supabase allows 6 to 10. Anything else is a typo, and falling back to the
  // default would hide it until someone could not sign in.
  if (!Number.isInteger(parsed) || parsed < 6 || parsed > 10) {
    throw new Error(
      `NEXT_PUBLIC_EMAIL_CODE_LENGTH must be an integer from 6 to 10, got "${configured}"`,
    );
  }
  return parsed;
}

export async function verifyEmailCode(email: string, token: string): Promise<void> {
  const { error } = await supabaseBrowser().auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (error) throw error;
}

/**
 * Hands off to Apple or Google.
 *
 * Both need configuring in the Supabase dashboard before they will do anything;
 * until then the call returns a provider error rather than failing silently,
 * which is why the caller surfaces it.
 */
export async function signInWithProvider(provider: OAuthProvider): Promise<void> {
  const { error } = await supabaseBrowser().auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabaseBrowser().auth.signOut();
}

/**
 * Makes sure a profile row exists for the signed-in user.
 *
 * Called after every successful sign-in rather than only the first, because a
 * session can outlive a failed insert and a user with no profile row would hit
 * a wall on the first write. Upsert makes the repeat harmless.
 */
export async function ensureProfile(): Promise<void> {
  const db = supabaseBrowser();
  const { data } = await db.auth.getUser();
  if (!data.user) return;

  const { error } = await db.from("profiles").upsert({ id: data.user.id }, { onConflict: "id" });
  if (error) throw error;
}
