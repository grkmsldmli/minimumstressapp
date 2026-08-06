/**
 * Which ways of signing in actually work right now.
 *
 * The screen offered Apple and Google. Neither was enabled on the project, so
 * both buttons failed — the app asked Supabase to start an OAuth flow, got a
 * 400 back, and showed the raw message. Two of the three ways in were broken
 * on the first screen anybody sees, and nothing said so.
 *
 * The obvious fix is to delete the buttons, which trades one wrong answer for
 * another: they come back the day the providers are turned on, and somebody
 * has to remember. A constant listing them has the same problem in a different
 * file.
 *
 * So the app asks. Supabase publishes what is enabled, and reading it is one
 * request to the host we are about to authenticate against — it cannot drift
 * from the truth, because it is the truth.
 */

export type Provider = "apple" | "google";

const PROVIDERS: Provider[] = ["apple", "google"];

/**
 * Fails closed.
 *
 * If the answer cannot be had — offline, blocked, the project moved — the
 * buttons stay hidden and the email code, which needs no configuration, is
 * still there. Showing a sign-in method we could not confirm is how this
 * started.
 */
export async function enabledProviders(
  url: string,
  key: string,
  signal?: AbortSignal,
): Promise<Provider[]> {
  try {
    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: key },
      signal,
    });
    if (!response.ok) return [];

    const settings = (await response.json()) as { external?: Record<string, boolean> };
    return PROVIDERS.filter((provider) => settings.external?.[provider] === true);
  } catch {
    return [];
  }
}
