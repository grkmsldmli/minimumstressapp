import { describe, expect, it, vi } from "vitest";

import { deleteAccount } from "./account-deletion";

/**
 * The order of these steps is the safety property, so the tests assert the
 * order rather than only the outcome. A deletion that removes the row and
 * leaves the lease on disk has erased the only record of what the file was.
 */

const USER = "user-1";

/**
 * A stand-in Supabase client that records what was called, in sequence.
 *
 * Hand-built rather than mocked from a library, because what matters here is
 * the shape of the conversation — which table, in which order — and a generic
 * mock hides exactly that.
 */
function fakeAdmin(overrides: {
  upcomingPractitioner?: number;
  upcomingHost?: number;
  spaces?: string[];
  files?: Record<string, { name: string; id: string | null }[]>;
} = {}) {
  const calls: string[] = [];
  const removedPaths: string[] = [];

  const spaces = overrides.spaces ?? [];
  let bookingSelects = 0;

  const from = (table: string) => {
    const chain = {
      select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
        calls.push(`select:${table}`);
        const result = {
          eq: () => result,
          in: () => result,
          gte: () => result,
          maybeSingle: async () =>
            table === "profiles"
              ? { data: { id: USER, avatar_path: null }, error: null }
              : { data: null, error: null },
          then: undefined,
        };

        if (opts?.head && opts.count === "exact") {
          const counted = {
            eq: () => counted,
            in: () => counted,
            gte: () => counted,
            then: (resolve: (v: unknown) => void) => {
              bookingSelects += 1;
              // First count is the practitioner's own upcoming sessions, the
              // second is upcoming sessions on rooms they host.
              const count =
                bookingSelects === 1
                  ? (overrides.upcomingPractitioner ?? 0)
                  : bookingSelects === 2 && spaces.length > 0
                    ? (overrides.upcomingHost ?? 0)
                    : 0;
              resolve({ count, error: null });
            },
          };
          return counted;
        }

        if (table === "spaces") {
          return {
            eq: async () => ({ data: spaces.map((id) => ({ id })), error: null }),
          };
        }

        return result;
      },
      update: (_patch: unknown, opts?: { count?: string }) => {
        calls.push(`update:${table}`);
        const updated = {
          eq: (..._a: unknown[]) =>
            opts?.count === "exact"
              ? Promise.resolve({ count: 2, error: null })
              : Promise.resolve({ error: null }),
          in: () => Promise.resolve({ error: null }),
        };
        return updated;
      },
      delete: () => {
        calls.push(`delete:${table}`);
        return { in: async () => ({ error: null }), eq: async () => ({ error: null }) };
      },
    };
    return chain;
  };

  const storage = {
    from: (bucket: string) => ({
      list: async (prefix: string) => ({
        data: overrides.files?.[`${bucket}/${prefix}`] ?? [],
        error: null,
      }),
      remove: async (paths: string[]) => {
        calls.push(`storage-remove:${bucket}`);
        removedPaths.push(...paths);
        return { error: null };
      },
    }),
  };

  const auth = {
    admin: {
      deleteUser: async () => {
        calls.push("auth-delete");
        return { error: null };
      },
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from, storage, auth } as any, calls, removedPaths };
}

describe("deleteAccount", () => {
  it("refuses while the person still has a session ahead", async () => {
    const { client, calls } = fakeAdmin({ upcomingPractitioner: 2 });

    const result = await deleteAccount(client, USER);

    expect(result).toEqual({ ok: false, reason: "upcoming_bookings", upcoming: 2 });
    // Nothing was touched — a refusal must not be a partial deletion.
    expect(calls).not.toContain("auth-delete");
    expect(calls.some((c) => c.startsWith("storage-remove"))).toBe(false);
  });

  /**
   * A host with a room booked for tomorrow is the same problem from the other
   * side: somebody is expecting a door to open.
   */
  it("refuses while a room they host still has a session ahead", async () => {
    const { client } = fakeAdmin({ spaces: ["space-1"], upcomingHost: 1 });

    const result = await deleteAccount(client, USER);

    expect(result).toEqual({ ok: false, reason: "upcoming_bookings", upcoming: 1 });
  });

  it("removes documents before it touches the profile", async () => {
    const { client, calls } = fakeAdmin({
      spaces: ["space-1"],
      files: {
        "verification-docs/space/space-1": [{ name: "lease.pdf", id: "f1" }],
        "verification-docs/practitioner/user-1": [{ name: "cert.pdf", id: "f2" }],
      },
    });

    await deleteAccount(client, USER);

    const firstRemoval = calls.findIndex((c) => c.startsWith("storage-remove"));
    const profileUpdate = calls.indexOf("update:profiles");

    expect(firstRemoval).toBeGreaterThanOrEqual(0);
    expect(firstRemoval).toBeLessThan(profileUpdate);
  });

  /** Until the auth user is gone, the account can still be used to ask questions. */
  it("deletes the auth user last", async () => {
    const { client, calls } = fakeAdmin({ spaces: ["space-1"] });

    await deleteAccount(client, USER);

    expect(calls.at(-1)).toBe("auth-delete");
  });

  it("collects documents from both the host and practitioner folders", async () => {
    const { client, removedPaths } = fakeAdmin({
      spaces: ["space-1"],
      files: {
        "verification-docs/space/space-1": [{ name: "lease.pdf", id: "f1" }],
        "verification-docs/practitioner/user-1": [{ name: "cert.pdf", id: "f2" }],
        "avatars/user-1": [{ name: "me.jpg", id: "f3" }],
      },
    });

    await deleteAccount(client, USER);

    expect(removedPaths).toContain("space/space-1/lease.pdf");
    expect(removedPaths).toContain("practitioner/user-1/cert.pdf");
    expect(removedPaths).toContain("user-1/me.jpg");
  });

  /** A folder entry with no id is a prefix, not a file. */
  it("ignores folder entries when collecting files", async () => {
    const { client, removedPaths } = fakeAdmin({
      files: { "verification-docs/practitioner/user-1": [{ name: "subfolder", id: null }] },
    });

    await deleteAccount(client, USER);

    expect(removedPaths).not.toContain("practitioner/user-1/subfolder");
  });

  it("reports what it removed", async () => {
    const { client } = fakeAdmin({
      files: { "verification-docs/practitioner/user-1": [{ name: "cert.pdf", id: "f1" }] },
    });

    const result = await deleteAccount(client, USER);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.removed.documents).toBe(1);
      expect(result.removed.reviews).toBe(2);
    }
  });

  it("says so when there is no such account", async () => {
    const { client } = fakeAdmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).from = () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    });

    await expect(deleteAccount(client, USER)).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

/** Guards the claim in docs/documents-and-data.md that bookings survive. */
describe("what deliberately survives", () => {
  it("never deletes bookings", async () => {
    const { client, calls } = fakeAdmin({ spaces: ["space-1"] });

    await deleteAccount(client, USER);

    expect(calls).not.toContain("delete:bookings");
  });

  /**
   * A listing's rating is partly other people's contribution, so one person
   * leaving empties their own words rather than removing the review.
   */
  it("empties a review's comment rather than deleting the row", async () => {
    const { client, calls } = fakeAdmin();

    await deleteAccount(client, USER);

    expect(calls).toContain("update:reviews");
    expect(calls).not.toContain("delete:reviews");
  });
});

vi.mock("./supabase/server", () => ({ supabaseAdmin: () => ({}) }));
