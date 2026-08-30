/**
 * One-time backfill: give existing image media the card + detail variants that
 * new uploads get (migration 0066), so current production listings render fast
 * too instead of downloading their full-size originals into 145px cards.
 *
 * Server-only and staff-run — a Node CLI, never an HTTP endpoint, so no normal
 * user can trigger it. It reads with the service role (SUPABASE_SECRET_KEY),
 * which is why it lives here and not in the app. Idempotent: rows that already
 * have a card_path are skipped, so it is safe to re-run and safe to interrupt.
 *
 * Per row, images only (video is left untouched): download the current
 * storage_path from the private bucket, make a card (<=600px, WebP q0.78) and a
 * detail (<=1600px, WebP q0.82) with no upscaling, upload both under the same
 * {hostId}/{spaceId}/ prefix, and — only once BOTH uploads have succeeded —
 * update the row (storage_path = detail, card_path = card). The old original is
 * deliberately NOT deleted on this first pass. A failure on one row is counted
 * and skipped; because the row is updated last, a failure never repoints it at
 * bytes that are not there, and never stops the remaining rows.
 *
 * Run:
 *   SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/backfill-space-media.mjs [--limit N]
 *
 * Requires `sharp` (bundled with Next). Never delete the originals until a
 * second, separate pass once the variants are confirmed in production.
 *
 * @typedef {object} BackfillRow
 * @property {string} id
 * @property {string} space_id
 * @property {string} storage_path
 * @property {string | null} card_path
 * @property {string} kind
 *
 * @typedef {object} BackfillPorts
 * @property {(limit: number) => Promise<BackfillRow[]>} candidates
 * @property {(path: string) => Promise<Uint8Array>} download
 * @property {(bytes: Uint8Array) => Promise<{ card: Uint8Array; detail: Uint8Array }>} encode
 * @property {(path: string, bytes: Uint8Array) => Promise<void>} upload
 * @property {(id: string, patch: { storage_path: string; card_path: string }) => Promise<void>} update
 * @property {(prefix: string) => string} newPath
 * @property {(message: string) => void} [log]
 */

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const BUCKET = "space-media";
const CARD = { maxEdge: 600, quality: 0.78 };
const DETAIL = { maxEdge: 1600, quality: 0.82 };
const DEFAULT_LIMIT = 200;

/**
 * The backfill loop, over injected ports so it can be tested without a network,
 * a database, or an image library. Returns what it did, and throws nothing —
 * each row's failure is isolated and counted.
 *
 * @param {BackfillPorts} ports
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<{ processed: number; skipped: number; failed: number }>}
 */
export async function backfillSpaceMedia(ports, opts = {}) {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const rows = await ports.candidates(limit);

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    // Idempotent, and images only: a row already backfilled, or a video, is
    // left exactly as it is.
    if (row.card_path) {
      skipped += 1;
      continue;
    }
    if (row.kind !== "image") {
      skipped += 1;
      continue;
    }

    try {
      const original = await ports.download(row.storage_path);
      const { card, detail } = await ports.encode(original);

      // The same {hostId}/{spaceId}/ prefix as the original.
      const prefix = row.storage_path.split("/").slice(0, 2).join("/");
      const detailPath = ports.newPath(prefix);
      const cardPath = ports.newPath(prefix);

      // Both files must exist before the row is repointed, so an interruption or
      // a half-failed upload never leaves the row aimed at bytes that are absent.
      await ports.upload(detailPath, detail);
      await ports.upload(cardPath, card);
      await ports.update(row.id, { storage_path: detailPath, card_path: cardPath });

      processed += 1;
    } catch (error) {
      failed += 1;
      ports.log?.(
        `space_media ${row.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { processed, skipped, failed };
}

/** Wires the real service-role client and sharp, then runs the loop. */
async function main() {
  const limitFlag = process.argv.indexOf("--limit");
  const limit = limitFlag !== -1 ? Number(process.argv[limitFlag + 1]) : DEFAULT_LIMIT;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error("Set SUPABASE_URL and SUPABASE_SECRET_KEY (service role) to run the backfill.");
    process.exit(1);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const sharp = (await import("sharp")).default;
  const db = createClient(url, key, { auth: { persistSession: false } });

  /** @param {Uint8Array} bytes @param {{ maxEdge: number; quality: number }} spec */
  const encodeOne = async (bytes, spec) =>
    new Uint8Array(
      await sharp(bytes)
        // Bake in EXIF orientation so a rotated phone photo is not sideways.
        .rotate()
        .resize(spec.maxEdge, spec.maxEdge, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: Math.round(spec.quality * 100) })
        .toBuffer(),
    );

  /** @type {BackfillPorts} */
  const ports = {
    candidates: async (max) => {
      const { data, error } = await db
        .from("space_media")
        .select("id, space_id, storage_path, card_path, kind")
        .is("card_path", null)
        .eq("kind", "image")
        .order("created_at", { ascending: true })
        .limit(max);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    download: async (path) => {
      const { data, error } = await db.storage.from(BUCKET).download(path);
      if (error || !data) throw new Error(error?.message ?? "download returned nothing");
      return new Uint8Array(await data.arrayBuffer());
    },
    encode: async (bytes) => ({
      card: await encodeOne(bytes, CARD),
      detail: await encodeOne(bytes, DETAIL),
    }),
    upload: async (path, bytes) => {
      const { error } = await db.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: "image/webp", upsert: false });
      if (error) throw new Error(error.message);
    },
    update: async (id, patch) => {
      const { error } = await db.from("space_media").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    newPath: (prefix) => `${prefix}/${randomUUID()}.webp`,
    log: (message) => console.warn(message),
  };

  const result = await backfillSpaceMedia(ports, { limit });
  console.log(
    `Backfill complete: ${result.processed} processed, ${result.skipped} skipped, ${result.failed} failed.`,
  );
  if (result.failed > 0) process.exitCode = 1;
}

// Only when run directly as a CLI — importing this module (the tests) never runs it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
