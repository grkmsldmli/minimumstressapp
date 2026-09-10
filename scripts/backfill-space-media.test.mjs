import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { backfillSpaceMedia } from "./backfill-space-media.mjs";

/**
 * The one-time media backfill (0066). Exercised over its injected ports, so the
 * exact code that runs in production is what these assert — with no network,
 * database, or image library — plus a guard that it never became a public
 * endpoint.
 */

/** Mock ports that record what the loop uploaded and updated. */
function makePorts(overrides = {}) {
  const uploaded = [];
  const updated = [];
  let counter = 0;
  const ports = {
    rows: [],
    candidates: async () => ports.rows,
    download: async () => new Uint8Array([1, 2, 3]),
    encode: async () => ({ card: new Uint8Array([0xc]), detail: new Uint8Array([0xd]) }),
    upload: async (path, bytes) => {
      uploaded.push({ path, bytes });
    },
    update: async (id, patch) => {
      updated.push({ id, patch });
    },
    newPath: (prefix) => `${prefix}/generated-${(counter += 1)}.webp`,
    log: () => {},
    uploaded,
    updated,
    ...overrides,
  };
  return ports;
}

const imageRow = (over = {}) => ({
  id: "m1",
  space_id: "s1",
  storage_path: "host-1/space-1/old.jpg",
  card_path: null,
  kind: "image",
  ...over,
});

describe("backfillSpaceMedia", () => {
  it("gives an old image a card + detail variant and repoints the row", async () => {
    const ports = makePorts({ rows: [imageRow()] });

    const result = await backfillSpaceMedia(ports);

    expect(result).toEqual({ processed: 1, skipped: 0, failed: 0 });
    // Two new objects, both under the original's {host}/{space}/ prefix.
    expect(ports.uploaded).toHaveLength(2);
    expect(ports.uploaded.every((u) => u.path.startsWith("host-1/space-1/"))).toBe(true);
    // The row is repointed to a distinct detail and card path.
    expect(ports.updated).toHaveLength(1);
    expect(ports.updated[0].id).toBe("m1");
    expect(ports.updated[0].patch.storage_path).toBeTruthy();
    expect(ports.updated[0].patch.card_path).toBeTruthy();
    expect(ports.updated[0].patch.card_path).not.toBe(ports.updated[0].patch.storage_path);
  });

  it("skips video rows entirely", async () => {
    const ports = makePorts({
      rows: [imageRow({ id: "v1", storage_path: "host-1/space-1/tour.mp4", kind: "video" })],
    });

    const result = await backfillSpaceMedia(ports);

    expect(result).toEqual({ processed: 0, skipped: 1, failed: 0 });
    expect(ports.uploaded).toEqual([]);
    expect(ports.updated).toEqual([]);
  });

  it("skips a row that already has a card variant (idempotent)", async () => {
    const ports = makePorts({
      rows: [imageRow({ id: "m2", card_path: "host-1/space-1/card.webp" })],
    });

    const result = await backfillSpaceMedia(ports);

    expect(result).toEqual({ processed: 0, skipped: 1, failed: 0 });
    expect(ports.updated).toEqual([]);
  });

  it("re-running finds nothing to do once rows are backfilled", async () => {
    // A second pass: the query only returns already-done rows, all skipped.
    const ports = makePorts({
      rows: [
        imageRow({ id: "m3", card_path: "host-1/space-1/c1.webp" }),
        imageRow({ id: "m4", card_path: "host-1/space-1/c2.webp" }),
      ],
    });

    const result = await backfillSpaceMedia(ports);

    expect(result).toEqual({ processed: 0, skipped: 2, failed: 0 });
    expect(ports.updated).toEqual([]);
  });

  it("leaves the row untouched when the download fails", async () => {
    const ports = makePorts({
      rows: [imageRow()],
      download: async () => {
        throw new Error("object is gone");
      },
    });

    const result = await backfillSpaceMedia(ports);

    expect(result).toEqual({ processed: 0, skipped: 0, failed: 1 });
    expect(ports.uploaded).toEqual([]);
    expect(ports.updated).toEqual([]); // the DB row is never rewritten
  });

  it("does not repoint the row if the second upload fails", async () => {
    let uploads = 0;
    const ports = makePorts({
      rows: [imageRow()],
      upload: async () => {
        uploads += 1;
        if (uploads === 2) throw new Error("second upload failed");
      },
    });

    const result = await backfillSpaceMedia(ports);

    expect(result.failed).toBe(1);
    // The update runs only after BOTH uploads succeed.
    expect(ports.updated).toEqual([]);
  });

  it("processes the remaining rows after one fails", async () => {
    const ports = makePorts({
      rows: [
        imageRow({ id: "bad", storage_path: "host-1/space-1/a.jpg" }),
        imageRow({ id: "good", storage_path: "host-1/space-1/b.jpg" }),
      ],
      download: async (path) => {
        if (path.endsWith("a.jpg")) throw new Error("bad object");
        return new Uint8Array([1]);
      },
    });

    const result = await backfillSpaceMedia(ports);

    expect(result).toEqual({ processed: 1, skipped: 0, failed: 1 });
    expect(ports.updated.map((u) => u.id)).toEqual(["good"]);
  });
});

describe("the backfill is not a public endpoint", () => {
  it("is a staff CLI, with no API route wiring it up", () => {
    const apiRoot = join(process.cwd(), "src", "app", "api");

    const walk = (dir) => {
      const found = [];
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) found.push(...walk(path));
        else if (/\.(ts|tsx)$/.test(entry)) found.push(path);
      }
      return found;
    };

    const files = walk(apiRoot);
    // No API path is named for the backfill, and no route imports or calls it.
    for (const file of files) {
      expect(file.toLowerCase()).not.toContain("backfill");
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/backfill/i);
    }
  });
});
