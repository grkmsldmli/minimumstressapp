import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  token: "" as string,
  error: null as { message: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      update: (row: Record<string, unknown>) => ({
        eq: async (_column: string, token: string) => {
          state.rows.push(row);
          state.token = token;
          return { error: state.error };
        },
      }),
    }),
  }),
}));

import { GET, POST } from "./route";

const TOKEN = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  state.rows = [];
  state.token = "";
  state.error = null;
});

describe("one-click marketing unsubscribe", () => {
  it("shows a confirmation that keeps transactional messages explicit", async () => {
    const response = await GET(
      new NextRequest(`https://minimumstress.app/api/marketing/unsubscribe?token=${TOKEN}`),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain("Booking, payment, safety and account messages will still arrive");
    expect(body).toContain(`value="${TOKEN}"`);
  });

  it("turns off marketing only and records the opt-out time", async () => {
    const response = await POST(
      new NextRequest("https://minimumstress.app/api/marketing/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: TOKEN }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.token).toBe(TOKEN);
    expect(state.rows[0]).toMatchObject({
      notify_offers: false,
      marketing_unsubscribed_at: expect.any(String),
      marketing_unsubscribe_reason: "one_click",
    });
    expect(await response.text()).toContain("Transactional booking, payment, safety and account messages are unchanged");
  });

  it("gives an invalid or unknown token the same non-enumerating success", async () => {
    const response = await POST(
      new NextRequest("https://minimumstress.app/api/marketing/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "not-a-token" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(state.rows).toEqual([]);
    expect(await response.text()).toContain("You're unsubscribed");
  });

  it("keeps a database failure retryable instead of claiming success", async () => {
    state.error = { message: "down" };
    const response = await POST(
      new NextRequest("https://minimumstress.app/api/marketing/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: TOKEN }),
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toContain("try again");
  });
});
