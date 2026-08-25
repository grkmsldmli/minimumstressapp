// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * How an API call carries the session in each build. The web leans on the
 * cookie the browser sends itself; the native shell has no cookie and must
 * attach its localStorage token as a Bearer header — but only to our own
 * origin, only when there is a token, and always the current one.
 */

const { isNativeApp, getSession } = vi.hoisted(() => ({
  isNativeApp: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("./native", () => ({ isNativeApp }));
vi.mock("./supabase/client", () => ({ supabaseBrowser: () => ({ auth: { getSession } }) }));

import { apiFetch } from "./api-fetch";

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  isNativeApp.mockReset();
  getSession.mockReset();
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
});

afterEach(() => vi.restoreAllMocks());

const authOf = (call: unknown[]) =>
  new Headers((call[1] as RequestInit | undefined)?.headers).get("Authorization");

describe("apiFetch", () => {
  it("on the web, sends a plain fetch and never touches the session — the cookie rides along", async () => {
    isNativeApp.mockReturnValue(false);
    await apiFetch("/api/pro", { method: "POST" });
    expect(fetchSpy).toHaveBeenCalledWith("/api/pro", { method: "POST" });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("in the native shell, attaches the session's access token as a Bearer header", async () => {
    isNativeApp.mockReturnValue(true);
    getSession.mockResolvedValue({ data: { session: { access_token: "jwt-123" } } });
    await apiFetch("/api/pro", { method: "POST" });
    const call = fetchSpy.mock.calls[0];
    expect(authOf(call)).toBe("Bearer jwt-123");
    expect((call[1] as RequestInit).method).toBe("POST");
  });

  it("signs any internal authenticated route the same way, not just Pro", async () => {
    isNativeApp.mockReturnValue(true);
    getSession.mockResolvedValue({ data: { session: { access_token: "jwt-b" } } });
    await apiFetch("/api/bookings", { method: "POST" });
    await apiFetch("/api/account/card");
    expect(authOf(fetchSpy.mock.calls[0])).toBe("Bearer jwt-b");
    expect(authOf(fetchSpy.mock.calls[1])).toBe("Bearer jwt-b");
  });

  it("in the native shell with no session, sends a plain fetch so the route returns a real 401", async () => {
    isNativeApp.mockReturnValue(true);
    getSession.mockResolvedValue({ data: { session: null } });
    await apiFetch("/api/pro", { method: "POST" });
    expect(authOf(fetchSpy.mock.calls[0])).toBeNull();
  });

  it("never attaches the token to a cross-origin URL, even in the native shell", async () => {
    isNativeApp.mockReturnValue(true);
    getSession.mockResolvedValue({ data: { session: { access_token: "jwt-secret" } } });
    // A full off-origin URL (a third party, Stripe) must not carry our token.
    await apiFetch("https://evil.example.com/collect", { method: "POST" });
    await apiFetch("https://api.stripe.com/v1/whatever");
    expect(authOf(fetchSpy.mock.calls[0])).toBeNull();
    expect(authOf(fetchSpy.mock.calls[1])).toBeNull();
    // It also never asked for the token — nothing to leak.
    expect(getSession).not.toHaveBeenCalled();
  });

  it("uses the current token each call, never a stale cached one", async () => {
    isNativeApp.mockReturnValue(true);
    getSession.mockResolvedValueOnce({ data: { session: { access_token: "old" } } });
    getSession.mockResolvedValueOnce({ data: { session: { access_token: "refreshed" } } });
    await apiFetch("/api/pro", { method: "POST" });
    await apiFetch("/api/pro", { method: "POST" });
    expect(authOf(fetchSpy.mock.calls[0])).toBe("Bearer old");
    expect(authOf(fetchSpy.mock.calls[1])).toBe("Bearer refreshed");
  });
});
