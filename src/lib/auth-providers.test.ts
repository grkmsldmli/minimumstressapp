import { afterEach, describe, expect, it, vi } from "vitest";

import { enabledProviders } from "./auth-providers";

const answer = (external: Record<string, boolean>) =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => ({ external }) });

afterEach(() => vi.unstubAllGlobals());

/**
 * The screen offered Apple and Google while neither was enabled, so two of the
 * three ways in were broken on the first screen anybody sees.
 */
describe("enabledProviders", () => {
  it("returns only what the auth server says is on", async () => {
    vi.stubGlobal("fetch", answer({ apple: true, google: false, email: true }));

    expect(await enabledProviders("https://x.supabase.co", "key")).toEqual(["apple"]);
  });

  it("returns nothing when both are off", async () => {
    vi.stubGlobal("fetch", answer({ apple: false, google: false, email: true }));

    expect(await enabledProviders("https://x.supabase.co", "key")).toEqual([]);
  });

  /** Email is always there and is not a button this decides about. */
  it("never reports email as an OAuth button", async () => {
    vi.stubGlobal("fetch", answer({ email: true, apple: true }));

    expect(await enabledProviders("https://x.supabase.co", "key")).not.toContain("email");
  });

  /**
   * Supabase enables plenty this app has never drawn a button for. Turning one
   * on in the dashboard must not put a dead control on the sign-in screen —
   * which is the failure this whole module was written to end.
   *
   * The example used to be azure. It stopped being one when Microsoft was
   * added, and the test caught that itself rather than quietly passing on a
   * premise that had become false.
   */
  it("ignores a provider the app has no button for", async () => {
    vi.stubGlobal("fetch", answer({ github: true, discord: true, notion: true }));

    expect(await enabledProviders("https://x.supabase.co", "key")).toEqual([]);
  });

  it("reports Microsoft under the key Supabase uses for it", async () => {
    vi.stubGlobal("fetch", answer({ azure: true, google: true }));

    expect(await enabledProviders("https://x.supabase.co", "key")).toEqual(["google", "azure"]);
  });

  /**
   * Fails closed. Showing a sign-in method we could not confirm is how this
   * started, so an unreachable answer hides the buttons and leaves the email
   * code, which needs no configuration.
   */
  it("hides everything when the answer cannot be had", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    expect(await enabledProviders("https://x.supabase.co", "key")).toEqual([]);
  });

  it("hides everything when the server refuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    expect(await enabledProviders("https://x.supabase.co", "key")).toEqual([]);
  });

  it("hides everything when the answer is not shaped as expected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    expect(await enabledProviders("https://x.supabase.co", "key")).toEqual([]);
  });
});
