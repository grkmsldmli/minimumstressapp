import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({ auth: null as unknown }));
vi.mock("@/lib/api/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/session")>();
  return { ...actual, requireUser: vi.fn(async () => state.auth) };
});

const { GET } = await import("./route");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PRIVATE_SECRET = "route-test-secret-that-must-never-leave-the-server";

beforeEach(() => {
  state.auth = { user: { id: USER_ID }, db: {} };
  vi.stubEnv("ONESIGNAL_EXTERNAL_ID_SECRET", PRIVATE_SECRET);
  vi.stubEnv("SUPABASE_SECRET_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /api/onesignal/identity", () => {
  it("turns away an unauthenticated caller before returning any identity", async () => {
    state.auth = {
      response: Response.json({ error: "Sign in to continue" }, { status: 401 }),
    };

    const response = await GET();
    const text = await response.text();

    expect(response.status).toBe(401);
    expect(JSON.parse(text)).toEqual({ error: "Sign in to continue" });
    expect(text).not.toContain("externalId");
    expect(text).not.toContain(USER_ID);
    expect(text).not.toContain(PRIVATE_SECRET);
  });

  it("returns only the signed-in account's opaque alias and forbids caching", async () => {
    const response = await GET();
    const text = await response.text();
    const body = JSON.parse(text) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(Object.keys(body)).toEqual(["externalId"]);
    expect(body.externalId).toMatch(/^ms_[A-Za-z0-9_-]{43}$/);
    expect(text).not.toContain(USER_ID);
    expect(text).not.toContain(PRIVATE_SECRET);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("fails closed without disclosing secret names or values when configuration is absent", async () => {
    vi.stubEnv("ONESIGNAL_EXTERNAL_ID_SECRET", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");

    const response = await GET();
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ error: "Push notifications are not configured" });
    expect(text).not.toContain("ONESIGNAL_EXTERNAL_ID_SECRET");
    expect(text).not.toContain("SUPABASE_SECRET_KEY");
    expect(text).not.toContain(USER_ID);
  });
});
