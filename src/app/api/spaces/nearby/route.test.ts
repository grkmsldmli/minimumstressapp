import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetForTests } from "@/lib/api/rate-limit";

/**
 * Distance ranking is inside the signed-in marketplace now (migration 0064).
 *
 * The route reads the exact coordinates no client may see and answers with only
 * ids and coarse labels — so two things have to hold at once: an anonymous
 * caller is turned away before any of that, and an authenticated one still gets
 * back nothing that narrows a room to a point.
 */

vi.mock("server-only", () => ({}));

// The auth verdict the route sees, swapped per test. requireUser itself (cookie
// vs native bearer) is proven in require-user.test.ts; here it stands in for
// "signed in" or "signed out" so the route's own behaviour is what is tested.
let authResult: { user: unknown; db: unknown } | { response: Response };
vi.mock("@/lib/api/session", () => ({
  requireUser: vi.fn(async () => authResult),
}));

// The rows the service-role read returns. Only the route ever sees these
// coordinates; the assertions below prove they do not reach the response.
const activeSpaces = vi.fn(async () => ({
  data: [
    { id: "s1", lat: 37.5502, lng: -122.3131 },
    { id: "s2", lat: 37.4849, lng: -122.2364 },
  ],
  error: null as { message: string } | null,
}));
vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => activeSpaces() }) }),
  }),
}));

const { GET } = await import("./route");

const get = (qs: string, ip = "203.0.113.9") =>
  GET(
    new NextRequest(`https://minimumstress.app/api/spaces/nearby?${qs}`, {
      headers: { "x-forwarded-for": ip },
    }),
  );

describe("nearby is for signed-in callers only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetForTests();
    authResult = { user: { id: "u1" }, db: {} };
  });

  it("turns away an anonymous caller with 401, before reading any coordinate", async () => {
    authResult = { response: Response.json({ error: "Sign in to continue" }, { status: 401 }) };

    const response = await get("lat=37.55&lng=-122.31");

    expect(response.status).toBe(401);
    // No coordinate was read: the service-role query never ran.
    expect(activeSpaces).not.toHaveBeenCalled();
  });

  it("accepts an authenticated caller and ranks by distance", async () => {
    const response = await get("lat=37.55&lng=-122.31");
    const body = (await response.json()) as { spaces?: { id: string; distanceLabel: string }[] };

    expect(response.status).toBe(200);
    expect(activeSpaces).toHaveBeenCalledOnce();
    expect(body.spaces?.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });

  it("answers with ids and coarse labels only — no coordinates or bearing", async () => {
    const response = await get("lat=37.55&lng=-122.31");
    const text = await response.text();
    const body = JSON.parse(text) as { spaces: { id: string; distanceLabel: string }[] };

    for (const space of body.spaces) {
      expect(Object.keys(space).sort()).toEqual(["distanceLabel", "id"]);
    }
    // Nothing that narrows a room to a point survives into the payload.
    for (const leak of ["lat", "lng", "latitude", "longitude", "bearing", "radius"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("still validates input for a signed-in caller", async () => {
    // Unparseable coordinates and no ZIP: nothing to sort from.
    expect((await get("lat=abc&lng=def")).status).toBe(400);
    // On the number line but not on Earth.
    expect((await get("lat=999&lng=0")).status).toBe(400);
  });
});
