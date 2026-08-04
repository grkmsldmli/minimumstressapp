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
 * Verifies the emailed code.
 *
 * Supabase sends six digits by default, so the four-box UI the prototype drew
 * would silently truncate a valid code. The input renders however many
 * `EMAIL_CODE_LENGTH` says.
 */
export const EMAIL_CODE_LENGTH = 6;

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
