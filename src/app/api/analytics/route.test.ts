import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const db = vi.hoisted(() => ({
  insert: vi.fn(async () => ({ error: null as { message: string } | null })),
  from: vi.fn(),
}));
db.from.mockImplementation(() => ({ insert: db.insert }));
vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: () => ({ from: db.from }),
}));

const { POST } = await import("./route");

let nextIp = 1;
const SESSION = "2e3697dd-2e87-4ae6-b33c-f815d5834ab0";

function post(
  body: unknown,
  {
    origin = "https://minimumstress.app",
    ip = `203.0.113.${nextIp++}`,
  }: { origin?: string | null; ip?: string } = {},
) {
  const headers = new Headers({
    "content-type": "application/json",
    "x-forwarded-for": ip,
  });
  if (origin) headers.set("origin", origin);
  return POST(
    new Request("https://minimumstress.app/api/analytics", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }) as NextRequest,
  );
}

beforeEach(() => {
  db.insert.mockReset();
  db.insert.mockResolvedValue({ error: null });
  db.from.mockClear();
});

describe("analytics ingestion", () => {
  it("accepts a fixed event and writes only the privacy-safe fields", async () => {
    const response = await post({
      event: "page_viewed",
      platform: "site_web",
      surface: "/spaces/[state]/[city]",
      sessionId: SESSION,
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(db.from).toHaveBeenCalledWith("analytics_events");
    expect(db.insert).toHaveBeenCalledWith({
      event_name: "page_viewed",
      user_id: null,
      anonymous_id: null,
      session_id: SESSION,
      platform: "site_web",
      app_version: null,
      surface: "/spaces/[state]/[city]",
      properties: {},
    });
  });

  it("accepts a same-origin native app open with no screen state", async () => {
    const response = await post({
      event: "app_opened",
      platform: "ios",
      surface: "app",
      sessionId: SESSION,
    });

    expect(response.status).toBe(202);
    expect(db.insert).toHaveBeenCalledWith(expect.objectContaining({ surface: "app" }));
  });

  it.each(["userId", "anonymousId", "properties", "query", "referrer"])(
    "refuses caller-supplied %s",
    async (field) => {
      const response = await post({
        event: "page_viewed",
        platform: "site_web",
        surface: "/",
        sessionId: SESSION,
        [field]: field === "properties" ? { anything: true } : "not accepted",
      });

      expect(response.status).toBe(400);
      expect(db.insert).not.toHaveBeenCalled();
    },
  );

  it("refuses business facts, raw dynamic paths and invalid platform/event pairs", async () => {
    for (const body of [
      { event: "payment_succeeded", platform: "app_web", surface: "payment" },
      { event: "page_viewed", platform: "site_web", surface: "/spaces/ca/oakland" },
      { event: "app_opened", platform: "site_web", surface: "/" },
      { event: "app_opened", platform: "ios", surface: "payment" },
      { event: "page_viewed", platform: "ios", surface: "discover" },
      { event: "page_viewed", platform: "ios", surface: "toString" },
    ]) {
      const response = await post({ ...body, sessionId: SESSION });
      expect(response.status).toBe(400);
    }
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("requires the request to come from the same origin", async () => {
    expect(
      (await post({ event: "page_viewed" }, { origin: "https://attacker.example" })).status,
    ).toBe(403);
    expect((await post({ event: "page_viewed" }, { origin: null })).status).toBe(403);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("stops reading a body at the byte ceiling", async () => {
    const response = await post({
      event: "page_viewed",
      platform: "site_web",
      surface: "/",
      sessionId: SESSION,
      padding: "x".repeat(2000),
    });

    expect(response.status).toBe(413);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rate limits one noisy caller", async () => {
    const body = {
      event: "page_viewed",
      platform: "site_web",
      surface: "/",
      sessionId: SESSION,
    };
    const ip = "198.51.100.240";
    for (let i = 0; i < 120; i++) expect((await post(body, { ip })).status).toBe(202);

    const response = await post(body, { ip });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
  });

  it("does not expose a database error to the caller", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.insert.mockResolvedValueOnce({
      error: { message: "relation analytics_events exposes_schema_details does not exist" },
    });

    const response = await post({
      event: "page_viewed",
      platform: "site_web",
      surface: "/",
      sessionId: SESSION,
    });
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).not.toContain("analytics_events");
    expect(text).not.toContain("exposes_schema_details");
    expect(log).toHaveBeenCalled();
  });
});
