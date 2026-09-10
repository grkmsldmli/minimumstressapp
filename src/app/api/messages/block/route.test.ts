import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Blocking the other party in a booking (App Store Guideline 1.2). The caller
 * sends only the booking; the route confirms participation, derives who to block,
 * and records it. The block severs the chat (0067) but never the booking.
 */

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({ auth: null as unknown }));
vi.mock("@/lib/api/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/session")>();
  return { ...actual, requireUser: vi.fn(async () => state.auth) };
});

const upserted = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
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
    // blocked_users
    return {
      upsert: async (row: Record<string, unknown>) => {
        upserted.rows.push(row);
        return { error: null };
      },
    };
  };
  return { supabaseAdmin: () => ({ from: table }) };
});

const { POST } = await import("./route");

const post = (body: unknown) =>
  POST(
    new Request("https://minimumstress.app/api/messages/block", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }) as NextRequest,
  );

describe("POST /api/messages/block", () => {
  beforeEach(() => {
    upserted.rows = [];
    state.auth = { user: { id: "PRAC" }, db: {} };
  });

  it("turns away an anonymous caller with 401", async () => {
    state.auth = { response: Response.json({ error: "Sign in to continue" }, { status: 401 }) };
    expect((await post({ bookingId: "b1" })).status).toBe(401);
    expect(upserted.rows).toEqual([]);
  });

  it("blocks the host when the practitioner asks", async () => {
    const response = await post({ bookingId: "b1" });
    expect(response.status).toBe(200);
    expect(upserted.rows[0]).toMatchObject({ blocker_id: "PRAC", blocked_id: "HOST" });
  });

  it("blocks the practitioner when the host asks", async () => {
    state.auth = { user: { id: "HOST" }, db: {} };
    await post({ bookingId: "b1" });
    expect(upserted.rows[0]).toMatchObject({ blocker_id: "HOST", blocked_id: "PRAC" });
  });

  it("refuses a caller who is not part of the booking", async () => {
    state.auth = { user: { id: "STRANGER" }, db: {} };
    expect((await post({ bookingId: "b1" })).status).toBe(403);
    expect(upserted.rows).toEqual([]);
  });

  it("requires a booking id", async () => {
    expect((await post({})).status).toBe(400);
  });
});
