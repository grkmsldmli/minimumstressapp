import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetForTests } from "@/lib/api/rate-limit";

/**
 * An open endpoint that writes to a table.
 *
 * There is no sign-in in front of it on purpose — asking somebody to make an
 * account before telling us what room they wanted would collect nothing, which
 * would defeat the point of having it. So the care goes here instead: what a
 * caller can put in the row, how much of it they can send, and what happens to
 * the parts that are wrong.
 */

vi.mock("server-only", () => ({}));

/** The row the endpoint hands the database, and what it hands back. */
type Row = Record<string, unknown>;
type Result = { error: { message: string } | null };

const insert = vi.fn(async (_row: Row): Promise<Result> => ({ error: null }));
vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: () => ({ from: () => ({ insert: (row: Row) => insert(row) }) }),
}));

const { POST } = await import("./route");

const post = (body: unknown, ip = "203.0.113.7") =>
  POST(
    new Request("https://minimumstress.com/api/spaces/request", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "x-forwarded-for": ip },
    }) as NextRequest,
  );

/** The row as the database would have received it. */
const written = (): Row => insert.mock.calls[0][0];

describe("recording what somebody was looking for", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetForTests();
  });

  it("keeps the use, the town and the address", async () => {
    const response = await post({
      spaceType: "massage-room",
      lookingIn: "San Mateo",
      email: "Someone@Example.com ",
    });

    expect(response.status).toBe(200);
    expect(written()).toEqual({
      space_type: "massage-room",
      looking_in: "San Mateo",
      email: "someone@example.com",
    });
  });

  /*
   * The address is the optional part and the only one worth being careful
   * about. A typo means we cannot write back — a request wasted rather than a
   * request refused — so the address is dropped and the request is kept. The
   * count is what recruits a host, and it does not need an inbox.
   */
  it("keeps the request when the address is a typo", async () => {
    const response = await post({ lookingIn: "Belmont", email: "someone@example" });

    expect(response.status).toBe(200);
    expect(written().looking_in).toBe("Belmont");
    expect(written().email).toBeNull();
  });

  it("records one with no address at all", async () => {
    await post({ lookingIn: "Belmont" });
    expect(written().email).toBeNull();
  });

  /*
   * The use becomes a label on a demand page and the thing a host is told
   * about. An unrecognised one is dropped rather than stored: the database
   * would refuse the row outright, losing a real request to a stale tab.
   */
  it("drops a use that is not one of ours rather than the request", async () => {
    await post({ spaceType: "therapy-office", lookingIn: "San Mateo" });

    expect(written().space_type).toBeNull();
    expect(written().looking_in).toBe("San Mateo");
  });

  it("needs a town, since that is the whole point", async () => {
    for (const body of [{}, { lookingIn: "   " }, { lookingIn: 42 }]) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses an essay in place of a town", async () => {
    const response = await post({ lookingIn: "x".repeat(200) });
    expect(response.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  /*
   * The abuse worth stopping is not one person searching twice. It is a script
   * filling the demand numbers for a town it wants a host recruited in —
   * because those numbers are exactly what we will put in front of hosts.
   */
  it("stops one caller stuffing the numbers", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await post({ lookingIn: "San Mateo" })).status).toBe(200);
    }
    expect((await post({ lookingIn: "San Mateo" })).status).toBe(429);
  });

  it("counts each caller separately", async () => {
    for (let i = 0; i < 10; i++) await post({ lookingIn: "San Mateo" }, "198.51.100.1");
    expect((await post({ lookingIn: "San Mateo" }, "198.51.100.2")).status).toBe(200);
  });

  it("tells the reader nothing about why the database refused", async () => {
    insert.mockResolvedValueOnce({ error: { message: "space_requests_type_known" } });
    const response = await post({ lookingIn: "San Mateo" });

    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("space_requests_type_known");
  });
});
