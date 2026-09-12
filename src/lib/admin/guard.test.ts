import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The staff gate is the ONLY boundary in front of the service role, so it is
 * tested directly: unauthenticated and non-staff must both get a bare 404 (never
 * a 403 that would confirm the route exists), and only a staff session reaches
 * the builder. Every admin read route shares adminGet, so this covers them all.
 */

vi.mock("server-only", () => ({}));

const requireUser = vi.fn();

vi.mock("@/lib/api/session", () => ({
  // Passthrough so adminGet's own logic is what is under test.
  handled: (work: () => Promise<Response>) => work(),
  requireUser: () => requireUser(),
  jsonError: (message: string, status: number) => Response.json({ error: message }, { status }),
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: () => ({ marker: "service-role" }),
}));

const { adminGet, staffOrRefusal, notFoundJson } = await import("./guard");

beforeEach(() => {
  process.env.ADMIN_EMAILS = "staff@example.com";
  requireUser.mockReset();
});

afterEach(() => {
  delete process.env.ADMIN_EMAILS;
});

describe("staffOrRefusal", () => {
  it("returns 404 for an unauthenticated request", async () => {
    requireUser.mockResolvedValue({ response: new Response("no", { status: 401 }) });
    const result = await staffOrRefusal();
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  });

  it("returns 404 for a signed-in non-staff account", async () => {
    requireUser.mockResolvedValue({ user: { id: "u1", email: "rando@example.com" }, db: {} });
    const result = await staffOrRefusal();
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  });

  it("returns the staff context for an allow-listed account (case-insensitive)", async () => {
    requireUser.mockResolvedValue({ user: { id: "u9", email: "Staff@Example.com" }, db: {} });
    const result = await staffOrRefusal();
    expect(result).toEqual({ staffId: "u9", staffEmail: "Staff@Example.com" });
  });
});

describe("adminGet", () => {
  it("never runs the builder for a non-staff caller", async () => {
    requireUser.mockResolvedValue({ user: { id: "u1", email: "rando@example.com" }, db: {} });
    const build = vi.fn();
    const res = await adminGet(build);
    expect(res.status).toBe(404);
    expect(build).not.toHaveBeenCalled();
  });

  it("runs the builder with the service-role client and returns no-store JSON for staff", async () => {
    requireUser.mockResolvedValue({ user: { id: "u9", email: "staff@example.com" }, db: {} });
    const res = await adminGet(async (admin) => ({ ok: true, admin }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.admin).toEqual({ marker: "service-role" });
  });

  it("passes a builder's own Response through (a 404 for a missing entity)", async () => {
    requireUser.mockResolvedValue({ user: { id: "u9", email: "staff@example.com" }, db: {} });
    const res = await adminGet(async () => notFoundJson());
    expect(res.status).toBe(404);
  });
});
