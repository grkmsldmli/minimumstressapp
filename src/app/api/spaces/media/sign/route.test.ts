import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEDIA_SIGN_MAX_BATCH } from "@/lib/media-sign";

/**
 * Signing listing media is authorised by database truth, not by the path.
 *
 * The bucket is private; this route is the only way a client reads a listing
 * photo, and it signs a path only when the media row exists and its space is
 * active or owned by the caller. Anonymous callers get nothing; a path that is
 * not one of theirs to see is simply absent from the reply, along with anything
 * about the space, its host, or the storage layer.
 */

vi.mock("server-only", () => ({}));

// The auth verdict the route sees, swapped per test. requireUser itself (cookie
// vs native bearer) is proven in require-user.test.ts.
const state = vi.hoisted(() => ({ auth: null as unknown }));
vi.mock("@/lib/api/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/session")>();
  return { ...actual, requireUser: vi.fn(async () => state.auth) };
});

// A tiny stand-in for the service-role reads and the signer. The dataset is one
// host with an active, a pending and a delisted room, plus a second host's
// active and pending rooms; "unknown" paths belong to no media row.
vi.mock("@/lib/supabase/server", () => {
  const SPACES = [
    { id: "sp-active", host_id: "host-A", status: "active" },
    { id: "sp-pending", host_id: "host-A", status: "pending" },
    { id: "sp-delisted", host_id: "host-A", status: "delisted" },
    { id: "sp-active-B", host_id: "host-B", status: "active" },
    { id: "sp-pending-B", host_id: "host-B", status: "pending" },
  ];
  // Image rows carry a card variant (0066); the "old" one predates it and has
  // only its original in storage_path.
  const MEDIA = [
    { storage_path: "host-A/sp-active/a.jpg", card_path: "host-A/sp-active/a-card.webp", space_id: "sp-active" },
    { storage_path: "host-A/sp-active/old.jpg", card_path: null, space_id: "sp-active" },
    { storage_path: "host-A/sp-pending/p.jpg", card_path: "host-A/sp-pending/p-card.webp", space_id: "sp-pending" },
    { storage_path: "host-A/sp-delisted/d.jpg", card_path: "host-A/sp-delisted/d-card.webp", space_id: "sp-delisted" },
    { storage_path: "host-B/sp-active-B/b.jpg", card_path: "host-B/sp-active-B/b-card.webp", space_id: "sp-active-B" },
    { storage_path: "host-B/sp-pending-B/pb.jpg", card_path: "host-B/sp-pending-B/pb-card.webp", space_id: "sp-pending-B" },
  ];
  const table = (rows: Record<string, unknown>[]) => ({
    select: () => ({
      // .in() on a column with null values simply never matches null (as Postgres).
      in: (column: string, values: unknown[]) =>
        Promise.resolve({
          data: rows.filter((r) => r[column] != null && values.includes(r[column])),
          error: null,
        }),
    }),
  });
  return {
    supabaseAdmin: () => ({
      from: (name: string) => table(name === "space_media" ? MEDIA : SPACES),
      storage: {
        from: () => ({
          createSignedUrls: async (paths: string[]) => ({
            // The signed URL is opaque; a token stands in for the real one. The
            // point is which paths get one, not the token.
            data: paths.map((p) => ({ path: p, signedUrl: `https://cdn.example/sign/${p}?token=t` })),
            error: null,
          }),
        }),
      },
    }),
  };
});

const { POST } = await import("./route");

const post = (paths: unknown) =>
  POST(
    new Request("https://minimumstress.app/api/spaces/media/sign", {
      method: "POST",
      body: JSON.stringify({ paths }),
      headers: { "content-type": "application/json" },
    }) as NextRequest,
  );

const signedFor = async (paths: unknown): Promise<Record<string, string>> => {
  const response = await post(paths);
  expect(response.status).toBe(200);
  return ((await response.json()) as { urls: Record<string, string> }).urls;
};

const asPractitioner = () => (state.auth = { user: { id: "prac-1" }, db: {} });
const asHostA = () => (state.auth = { user: { id: "host-A" }, db: {} });

describe("signing listing media", () => {
  beforeEach(() => {
    asPractitioner();
  });

  it("turns away an anonymous caller with 401", async () => {
    state.auth = { response: Response.json({ error: "Sign in to continue" }, { status: 401 }) };
    const response = await post(["host-A/sp-active/a.jpg"]);
    expect(response.status).toBe(401);
  });

  it("signs an active listing's media for a practitioner", async () => {
    const urls = await signedFor(["host-A/sp-active/a.jpg"]);
    expect(urls["host-A/sp-active/a.jpg"]).toMatch(/^https:\/\/cdn\.example\/sign\//);
  });

  it("does not sign a pending or delisted listing for a practitioner", async () => {
    const urls = await signedFor(["host-A/sp-pending/p.jpg", "host-A/sp-delisted/d.jpg"]);
    expect(urls).toEqual({});
  });

  it("signs the host's own media at any status", async () => {
    asHostA();
    const urls = await signedFor([
      "host-A/sp-active/a.jpg",
      "host-A/sp-pending/p.jpg",
      "host-A/sp-delisted/d.jpg",
    ]);
    expect(Object.keys(urls).sort()).toEqual([
      "host-A/sp-active/a.jpg",
      "host-A/sp-delisted/d.jpg",
      "host-A/sp-pending/p.jpg",
    ]);
  });

  it("does not give a host another host's non-active media", async () => {
    asHostA();
    const urls = await signedFor(["host-B/sp-pending-B/pb.jpg"]);
    expect(urls).toEqual({});
    // …though another host's ACTIVE media is readable by any signed-in user.
    const active = await signedFor(["host-B/sp-active-B/b.jpg"]);
    expect(active["host-B/sp-active-B/b.jpg"]).toBeDefined();
  });

  it("never signs an unregistered path", async () => {
    const urls = await signedFor(["host-A/made-up/x.jpg"]);
    expect(urls).toEqual({});
  });

  it("signs the card variant of an active listing", async () => {
    const urls = await signedFor(["host-A/sp-active/a-card.webp"]);
    expect(urls["host-A/sp-active/a-card.webp"]).toMatch(/^https:\/\/cdn\.example\/sign\//);
  });

  it("signs the detail and card variant of a listing together", async () => {
    const urls = await signedFor(["host-A/sp-active/a.jpg", "host-A/sp-active/a-card.webp"]);
    expect(Object.keys(urls).sort()).toEqual(["host-A/sp-active/a-card.webp", "host-A/sp-active/a.jpg"]);
  });

  it("does not sign a pending listing's card variant for a practitioner", async () => {
    const urls = await signedFor(["host-A/sp-pending/p-card.webp"]);
    expect(urls).toEqual({});
  });

  it("still signs an old original that has no card variant", async () => {
    const urls = await signedFor(["host-A/sp-active/old.jpg"]);
    expect(urls["host-A/sp-active/old.jpg"]).toBeDefined();
  });

  it("never signs a card path tied to no media row", async () => {
    const urls = await signedFor(["host-A/sp-active/not-a-real-card.webp"]);
    expect(urls).toEqual({});
  });

  it("returns only the authorised paths from a mixed batch", async () => {
    const urls = await signedFor([
      "host-A/sp-active/a.jpg", // active → yes
      "host-A/sp-pending/p.jpg", // pending, not owner → no
      "host-A/made-up/x.jpg", // unknown → no
      "host-B/sp-active-B/b.jpg", // another host, active → yes
    ]);
    expect(Object.keys(urls).sort()).toEqual(["host-A/sp-active/a.jpg", "host-B/sp-active-B/b.jpg"]);
  });

  it("exposes only the url map — no space, host or storage detail", async () => {
    const response = await post(["host-A/sp-active/a.jpg"]);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["urls"]);
    const text = JSON.stringify(body);
    for (const leak of ["host_id", "status", "space_id", "service_role", "secret", "supabaseKey"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("rejects a batch over the limit", async () => {
    const tooMany = Array.from({ length: MEDIA_SIGN_MAX_BATCH + 1 }, (_, i) => `host-A/sp-active/${i}.jpg`);
    const response = await post(tooMany);
    expect(response.status).toBe(400);
  });

  it("rejects a body that is not a paths array", async () => {
    expect((await post("nope")).status).toBe(400);
    expect((await post(undefined)).status).toBe(400);
  });
});
