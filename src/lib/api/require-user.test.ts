import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The session guard behind every write route, and the two transports it must
 * treat as equal: the web's cookie and the native shell's Bearer header. Both
 * carry a Supabase access token; both are revalidated by getUser rather than
 * trusted, so a bearer is no weaker than a cookie and neither believes a
 * client-supplied identity.
 */

vi.mock("server-only", () => ({}));

const { supabaseServer, headers } = vi.hoisted(() => ({
  supabaseServer: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("../supabase/server", () => ({ supabaseServer }));
vi.mock("next/headers", () => ({ headers }));

import { requireUser } from "./session";

function signedInAs(id: string | null) {
  const getUser = vi.fn().mockResolvedValue({
    data: { user: id ? { id } : null },
    error: null,
  });
  supabaseServer.mockResolvedValue({ auth: { getUser } });
  return getUser;
}

beforeEach(() => {
  supabaseServer.mockReset();
  headers.mockReset();
});

describe("requireUser", () => {
  it("validates the Bearer token the native shell sends when there is no cookie", async () => {
    const getUser = signedInAs("u-native");
    headers.mockReturnValue(new Headers({ authorization: "Bearer jwt-native" }));

    const result = await requireUser();

    expect(getUser).toHaveBeenCalledWith("jwt-native"); // revalidated, not trusted
    expect("user" in result && result.user.id).toBe("u-native");
  });

  it("uses the cookie session on the web, with no token argument", async () => {
    const getUser = signedInAs("u-web");
    headers.mockReturnValue(new Headers());

    const result = await requireUser();

    expect(getUser).toHaveBeenCalledWith();
    expect("user" in result && result.user.id).toBe("u-web");
  });

  it("refuses with 401 when neither transport identifies a user", async () => {
    signedInAs(null);
    headers.mockReturnValue(new Headers());

    const result = await requireUser();

    expect("response" in result).toBe(true);
    if ("response" in result) expect(result.response.status).toBe(401);
  });

  it("refuses with 401 when the Bearer token is invalid or expired", async () => {
    // getUser rejects the token — Supabase revalidates it, so a forged or stale
    // JWT never passes.
    const getUser = vi
      .fn()
      .mockResolvedValue({ data: { user: null }, error: { message: "invalid JWT" } });
    supabaseServer.mockResolvedValue({ auth: { getUser } });
    headers.mockReturnValue(new Headers({ authorization: "Bearer forged" }));

    const result = await requireUser();

    expect(getUser).toHaveBeenCalledWith("forged");
    expect("response" in result).toBe(true);
    if ("response" in result) expect(result.response.status).toBe(401);
  });

  it("is deterministic when a Bearer is present: the bearer is validated, never the no-arg cookie path", async () => {
    // Our own clients never send both (web is cookie-only, native bearer-only),
    // but if both were present the rule is fixed and safe: the bearer wins and
    // is revalidated, so identity is never silently ambiguous.
    const getUser = signedInAs("u-bearer");
    headers.mockReturnValue(new Headers({ authorization: "Bearer jwt-b" }));

    await requireUser();

    expect(getUser).toHaveBeenCalledWith("jwt-b");
    expect(getUser).not.toHaveBeenCalledWith(); // the cookie path was not taken
  });
});
