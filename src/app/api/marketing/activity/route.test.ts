import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  consented: true,
  writes: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/api/session", async (original) => {
  const actual = await original<typeof import("@/lib/api/session")>();
  return {
    ...actual,
    requireUser: async () => {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => ({
        data: {
          notify_offers: state.consented,
          marketing_consent_at: "2026-01-01T00:00:00.000Z",
          marketing_unsubscribed_at: state.consented ? null : "2026-09-01T00:00:00.000Z",
        },
        error: null,
      }));
      return {
        user: { id: "11111111-1111-4111-8111-111111111111" },
        db: { from: () => chain },
      };
    },
  };
});

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      upsert: async (row: Record<string, unknown>) => {
        state.writes.push(row);
        return { error: null };
      },
    }),
  }),
}));

import { POST } from "./route";

function request(body: unknown): NextRequest {
  return new NextRequest("https://minimumstress.app/api/marketing/activity", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.consented = true;
  state.writes = [];
});

describe("marketing activity", () => {
  it("stores only the coarse opted-in timestamp", async () => {
    const response = await POST(request({ event: "space_browsed" }));

    expect(response.status).toBe(204);
    expect(state.writes[0]).toMatchObject({
      user_id: "11111111-1111-4111-8111-111111111111",
      last_space_browsed_at: expect.any(String),
      updated_at: expect.any(String),
    });
    expect(state.writes[0]).not.toHaveProperty("space_id");
  });

  it("does nothing after an opt-out", async () => {
    state.consented = false;
    const response = await POST(request({ event: "app_opened" }));

    expect(response.status).toBe(204);
    expect(state.writes).toEqual([]);
  });

  it("rejects identifiers and arbitrary activity", async () => {
    expect((await POST(request({ event: "space_browsed", spaceId: "secret" }))).status).toBe(400);
    expect((await POST(request({ event: "checkout" }))).status).toBe(400);
    expect(state.writes).toEqual([]);
  });

  it("stops reading bodies that exceed the fixed privacy envelope", async () => {
    const response = await POST(request({ event: "app_opened", padding: "x".repeat(200) }));
    expect(response.status).toBe(413);
    expect(state.writes).toEqual([]);
  });
});
