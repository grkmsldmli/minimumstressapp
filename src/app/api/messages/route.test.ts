import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  auth: null as unknown,
  booking: null as Record<string, unknown> | null,
  block: null as Record<string, unknown> | null,
  inserted: [] as Record<string, unknown>[],
  insertError: null as { code?: string; message?: string } | null,
  after: [] as Array<() => unknown>,
  worker: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (callback: () => unknown) => state.after.push(callback),
  };
});

vi.mock("@/lib/api/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/session")>();
  return { ...actual, requireUser: vi.fn(async () => state.auth) };
});

vi.mock("@/lib/notify/message-jobs", () => ({
  processMessageNotificationJobs: (...args: unknown[]) => state.worker(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "bookings") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: state.booking, error: null }) }),
          }),
        };
      }
      if (table === "blocked_users") {
        return {
          select: () => ({
            or: () => ({
              limit: () => ({ maybeSingle: async () => ({ data: state.block, error: null }) }),
            }),
          }),
        };
      }
      if (table === "messages") {
        return {
          insert: (row: Record<string, unknown>) => {
            state.inserted.push(row);
            return {
              select: () => ({
                single: async () => ({
                  data: state.insertError ? null : { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
                  error: state.insertError,
                }),
              }),
            };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

import { NextRequest } from "next/server";

import { GET, POST } from "./route";

const BOOKING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HOST = "host-id";
const PRACTITIONER = "practitioner-id";

const post = (body: unknown) =>
  POST(
    new NextRequest("https://minimumstress.app/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  state.auth = { user: { id: PRACTITIONER }, db: {} };
  state.booking = {
    id: BOOKING,
    practitioner_id: PRACTITIONER,
    status: "upcoming",
    captured_at: "2026-09-01T00:00:00.000Z",
    spaces: { host_id: HOST },
  };
  state.block = null;
  state.inserted = [];
  state.insertError = null;
  state.after = [];
  state.worker.mockResolvedValue({ claimed: 1, completed: 1, retrying: 0, failed: 0 });
});

describe("POST /api/messages", () => {
  it("stops a request for contact details before it reaches the thread", async () => {
    const response = await post({ bookingId: BOOKING, body: "Can I get your phone number?" });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/phone numbers.*private/i);
    expect(state.inserted).toEqual([]);
  });

  it("masks actual contact data, retains the original only server-side, and schedules its durable job", async () => {
    const response = await post({
      bookingId: BOOKING,
      body: "The parking contact email is desk@example.com",
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.body).toContain("[hidden]");
    expect(payload.body).not.toContain("desk@example.com");
    expect(state.inserted[0]).toMatchObject({
      booking_id: BOOKING,
      sender_id: PRACTITIONER,
      body: "The parking contact email is [hidden]",
      original_body: "The parking contact email is desk@example.com",
      redacted_kinds: ["email"],
    });
    expect(state.after).toHaveLength(1);

    await state.after[0]();
    expect(state.worker).toHaveBeenCalledWith(
      expect.anything(),
      { limit: 1, messageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    );
  });

  it("does not create a useless message made only of hidden contact data", async () => {
    const response = await post({ bookingId: BOOKING, body: "desk@example.com" });
    expect(response.status).toBe(400);
    expect(state.inserted).toEqual([]);
  });

  it("returns the same closed-composer state for either direction of a block", async () => {
    state.block = { blocker_id: HOST };
    const response = await post({ bookingId: BOOKING, body: "Where should I park?" });
    expect(response.status).toBe(409);
    expect(state.inserted).toEqual([]);
  });

  it("does not reveal a booking to a non-participant", async () => {
    state.auth = { user: { id: "stranger" }, db: {} };
    const response = await post({ bookingId: BOOKING, body: "Hello" });
    expect(response.status).toBe(404);
    expect(state.inserted).toEqual([]);
  });

  it("keeps uncaptured and cancelled bookings read-only", async () => {
    state.booking = { ...state.booking!, captured_at: null };
    expect((await post({ bookingId: BOOKING, body: "Hello" })).status).toBe(409);

    state.booking = {
      ...state.booking!,
      captured_at: "2026-09-01T00:00:00.000Z",
      status: "cancelled_by_host",
    };
    expect((await post({ bookingId: BOOKING, body: "Hello" })).status).toBe(409);
    expect(state.inserted).toEqual([]);
  });
});

describe("GET /api/messages", () => {
  it("returns participant-only server block truth without any message body", async () => {
    state.block = { blocker_id: PRACTITIONER };
    const response = await GET(
      new NextRequest(`https://minimumstress.app/api/messages?bookingId=${BOOKING}`),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ blocked: true });
  });
});
