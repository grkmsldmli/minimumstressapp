import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The Book → payment read-back. The bug: a just-created instant booking is a
 * hold (captured_at null, approval "not_required"), which listMyBookings hides,
 * so reading the new booking back through that list failed and the payment sheet
 * never opened. getBookingById reads it directly by id instead, so the sheet can
 * open, while the list still hides the hold.
 */

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("./api-fetch", () => ({ apiFetch }));

import { SupabaseRepository } from "./supabase-repository";

type Row = Record<string, unknown>;

/** A tiny stand-in for the query builder: filters on eq/in, resolves to rows. */
function makeDb(tables: Record<string, Row[]>): SupabaseClient {
  const chainFor = (rows: Row[]) => {
    let result = [...rows];
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (c: string, v: unknown) => {
        result = result.filter((r) => r[c] === v);
        return chain;
      },
      in: (c: string, vs: unknown[]) => {
        result = result.filter((r) => vs.includes(r[c]));
        return chain;
      },
      gt: () => chain,
      not: () => chain,
      order: () => chain,
      maybeSingle: async () => ({ data: result[0] ?? null, error: null }),
      single: async () => ({ data: result[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: result, error: null }),
    };
    return chain;
  };

  return {
    auth: { getUser: async () => ({ data: { user: { id: "me" } }, error: null }) },
    from: (table: string) => chainFor(tables[table] ?? []),
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
  } as unknown as SupabaseClient;
}

const bookingRow = (over: Row = {}): Row => ({
  id: "b1",
  space_id: "s1",
  practitioner_id: "me",
  starts_at: "2026-09-01T10:00:00Z",
  ends_at: "2026-09-01T11:00:00Z",
  status: "upcoming",
  is_instant: false,
  was_pro: false,
  host_rate_cents: 5000,
  service_fee_cents: 400,
  instant_fee_cents: 0,
  pro_discount_cents: 0,
  total_cents: 5400,
  platform_cents: 400,
  revealed_access_code: null,
  access_code_revealed_at: "2026-09-01T09:00:00Z",
  approval_state: "not_required",
  captured_at: null,
  authorized_at: "2026-08-01T00:00:00Z",
  ...over,
});

function repoWith(rows: Row[]): SupabaseRepository {
  const repo = new SupabaseRepository(makeDb({ bookings_with_access_code: rows }));
  // The space catalogue is a separate, heavier query; stub it — the mapping
  // falls back to a generic label when a space is absent, which is enough here.
  vi.spyOn(repo, "listPublicSpaces").mockResolvedValue([]);
  return repo;
}

beforeEach(() => apiFetch.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("reading a booking back", () => {
  it("getBookingById returns the in-flight instant hold the list hides", async () => {
    const repo = repoWith([bookingRow({ id: "b1" })]);
    const booking = await repo.getBookingById("b1");
    expect(booking?.id).toBe("b1");
  });

  it("listMyBookings hides that same unpaid hold", async () => {
    const repo = repoWith([bookingRow({ id: "b1" })]);
    expect(await repo.listMyBookings()).toEqual([]);
  });

  it("listMyBookings shows a captured booking", async () => {
    const repo = repoWith([bookingRow({ id: "b2", captured_at: "2026-08-20T00:00:00Z" })]);
    const list = await repo.listMyBookings();
    expect(list.map((b) => b.id)).toEqual(["b2"]);
  });
});

describe("createBooking → payment preparation", () => {
  const input = {
    spaceId: "s1",
    startsAt: new Date("2026-09-01T10:00:00Z"),
    declared: { purpose: "movement_session" as const, purposeNote: null, attendees: 1 },
  };

  it("returns the new hold and its clientSecret so the payment sheet can open", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ bookingId: "b1", clientSecret: "cs_live_1", money: {} }),
    });
    const repo = repoWith([bookingRow({ id: "b1" })]); // uncaptured hold, hidden from list

    const { booking, clientSecret } = await repo.createBooking(input);

    expect(booking.id).toBe("b1"); // read back despite being hidden from the list
    expect(clientSecret).toBe("cs_live_1"); // flows through to PaymentSheet
  });

  it("fails cleanly when the row genuinely cannot be read (no silent success)", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ bookingId: "missing", clientSecret: "cs", money: {} }),
    });
    const repo = repoWith([bookingRow({ id: "b1" })]); // "missing" is not present

    await expect(repo.createBooking(input)).rejects.toThrow(/could not be read back/);
  });

  it("surfaces the server's refusal (e.g. slot taken) verbatim", async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "That time was just booked. Choose another time to continue." }),
    });
    const repo = repoWith([]);

    await expect(repo.createBooking(input)).rejects.toThrow(/just booked/);
  });
});

describe("listing media is signed by the server, never the browser", () => {
  const spaceRow: Row = {
    id: "s1",
    host_id: "h1",
    name: "Willow Room",
    category: "physical",
    hourly_rate_cents: 5000,
    capacity: 3,
    access_type: "keypad",
    buffer_minutes: 0,
    timezone: "America/Los_Angeles",
    map_x: 50,
    map_y: 50,
    suitable_for: [],
  };
  const mediaRow: Row = { id: "m1", space_id: "s1", storage_path: "h1/s1/cover.jpg", kind: "image", position: 0 };

  const repoWithMedia = () =>
    new SupabaseRepository(makeDb({ spaces_public: [spaceRow], space_media_public: [mediaRow] }));

  it("gets media URLs from the authenticated sign route", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ urls: { "h1/s1/cover.jpg": "https://cdn.example/sign/h1/s1/cover.jpg?token=t" } }),
    });

    const [space] = await repoWithMedia().listPublicSpaces();

    expect(apiFetch).toHaveBeenCalledWith("/api/spaces/media/sign", expect.objectContaining({ method: "POST" }));
    const sent = JSON.parse((apiFetch.mock.calls[0][1] as { body: string }).body) as { paths: string[] };
    expect(sent.paths).toContain("h1/s1/cover.jpg");
    expect(space.media[0].url).toBe("https://cdn.example/sign/h1/s1/cover.jpg?token=t");
  });

  it("leaves an unauthorised path with no URL — never a public fallback", async () => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ urls: {} }) });

    const [space] = await repoWithMedia().listPublicSpaces();

    expect(space.media[0].url).toBe("");
  });

  it("does not browser-sign space media or fall back to a public URL", () => {
    // The bucket is private and a browser cannot authorise itself; guarded here
    // so nobody reintroduces client-side signing or a public URL for it.
    const source = readFileSync(join(import.meta.dirname, "supabase-repository.ts"), "utf8");
    expect(source).not.toMatch(/createSignedUrls?/);
    expect(source).not.toMatch(/publicUrl\(\s*["']space-media["']/);
    expect(source).not.toMatch(/getPublicUrl[^\n]*space-media/);
  });
});
