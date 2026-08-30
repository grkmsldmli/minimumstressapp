import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reporting the other party in a booking (App Store Guideline 1.2). The caller
 * sends only the booking and a reason; the route confirms they are a participant,
 * derives who the other party is, and records the report. A non-participant, or
 * an unknown booking, gets nothing.
 */

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({ auth: null as unknown }));
vi.mock("@/lib/api/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/session")>();
  return { ...actual, requireUser: vi.fn(async () => state.auth) };
});

// A booking on SPACE, practitioner PRAC, host HOST.
const inserted = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/supabase/server", () => {
  const table = (name: string) => {
    if (name === "bookings") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { practitioner_id: "PRAC", space_id: "SPACE" }, error: null }) }),
        }),
      };
    }
    if (name === "spaces") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { host_id: "HOST" }, error: null }) }),
        }),
      };
    }
    // message_reports
    return {
      insert: async (row: Record<string, unknown>) => {
        inserted.rows.push(row);
        return { error: null };
      },
    };
  };
  return { supabaseAdmin: () => ({ from: table }) };
});

const { POST } = await import("./route");

const post = (body: unknown) =>
  POST(
    new Request("https://minimumstress.app/api/messages/report", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }) as NextRequest,
  );

describe("POST /api/messages/report", () => {
  beforeEach(() => {
    inserted.rows = [];
    state.auth = { user: { id: "PRAC" }, db: {} };
  });

  it("turns away an anonymous caller with 401", async () => {
    state.auth = { response: Response.json({ error: "Sign in to continue" }, { status: 401 }) };
    expect((await post({ bookingId: "b1", reason: "off-app" })).status).toBe(401);
    expect(inserted.rows).toEqual([]);
  });

  it("records a report against the host when the practitioner files it", async () => {
    const response = await post({ bookingId: "b1", reason: "tried to move off the app" });
    expect(response.status).toBe(200);
    expect(inserted.rows).toHaveLength(1);
    expect(inserted.rows[0]).toMatchObject({
      booking_id: "b1",
      reporter_id: "PRAC",
      reported_user_id: "HOST",
      reason: "tried to move off the app",
    });
  });

  it("records a report against the practitioner when the host files it", async () => {
    state.auth = { user: { id: "HOST" }, db: {} };
    await post({ bookingId: "b1", reason: "no show and rude" });
    expect(inserted.rows[0]).toMatchObject({ reporter_id: "HOST", reported_user_id: "PRAC" });
  });

  it("refuses a caller who is not part of the booking", async () => {
    state.auth = { user: { id: "STRANGER" }, db: {} };
    expect((await post({ bookingId: "b1", reason: "nosy" })).status).toBe(403);
    expect(inserted.rows).toEqual([]);
  });

  it("requires a booking and a reason", async () => {
    expect((await post({ reason: "x" })).status).toBe(400);
    expect((await post({ bookingId: "b1" })).status).toBe(400);
    expect((await post({ bookingId: "b1", reason: "   " })).status).toBe(400);
  });

  it("stores no address, code, or message — only who, which booking, and why", async () => {
    await post({ bookingId: "b1", reason: "moved off app" });
    expect(Object.keys(inserted.rows[0]).sort()).toEqual([
      "booking_id",
      "reason",
      "reported_user_id",
      "reporter_id",
    ]);
  });
});
