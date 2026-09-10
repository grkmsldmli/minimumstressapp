import type { NextRequest } from "next/server";

import { handled, jsonError, requireUser } from "@/lib/api/session";
import { MEDIA_SIGN_MAX_BATCH, MEDIA_SIGN_TTL_SECONDS, type MediaSignResponse } from "@/lib/media-sign";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Signs listing-media URLs for the caller, and only the ones they may see.
 *
 * The space-media bucket is private, so a browser cannot read a photo directly
 * and — because a storage.objects policy that subqueries `spaces` is subject to
 * that table's owner-only RLS (see migration 0017's note, confirmed again for
 * 0064) — it cannot mint its own signed URL either. So signing moves here, where
 * the service role can consult database truth before it hands anything out:
 *
 *   a media path is signable only when its row exists in space_media AND the
 *   space it belongs to is active, OR is owned by the caller.
 *
 * The path is never trusted on its own — a caller could ask for any string. It
 * is looked up in space_media, joined to its space, and allowed by status
 * and owner. Anything not allowed is simply absent from the reply; nothing
 * about a space, its address, its host, or the storage layer is returned, and
 * the service-role key never leaves the server.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;
    const { user } = auth;

    const body = (await request.json().catch(() => null)) as { paths?: unknown } | null;
    if (!body || !Array.isArray(body.paths)) {
      return jsonError("Send a paths array", 400);
    }
    if (body.paths.length > MEDIA_SIGN_MAX_BATCH) {
      return jsonError(`Too many paths — the limit is ${MEDIA_SIGN_MAX_BATCH}`, 400);
    }

    const requested = [...new Set(body.paths.filter((p): p is string => typeof p === "string"))];
    if (requested.length === 0) {
      return Response.json({ urls: {} } satisfies MediaSignResponse);
    }

    // Service role only after the caller is known, and only to read the truth
    // the authorisation turns on — no RLS involved, so no cross-table policy
    // subquery is needed. A requested path is real only if it is a media row's
    // storage_path or its card variant (0066), so both columns are looked up;
    // an arbitrary string matches neither and signs nothing.
    const admin = supabaseAdmin();

    type MediaRow = { storage_path: string; card_path: string | null; space_id: string };
    const [byStorage, byCard] = await Promise.all([
      admin.from("space_media").select("storage_path, card_path, space_id").in("storage_path", requested),
      admin.from("space_media").select("storage_path, card_path, space_id").in("card_path", requested),
    ]);
    if (byStorage.error || byCard.error) throw new Error("media lookup failed");

    // One row per media item, however it was matched.
    const rows = new Map<string, MediaRow>();
    for (const row of [...(byStorage.data ?? []), ...(byCard.data ?? [])] as MediaRow[]) {
      rows.set(row.storage_path, row);
    }
    const media = [...rows.values()];
    const spaceIds = [...new Set(media.map((m) => m.space_id))];
    if (spaceIds.length === 0) {
      return Response.json({ urls: {} } satisfies MediaSignResponse);
    }

    const { data: spaceRows, error: spaceError } = await admin
      .from("spaces")
      .select("id, status, host_id")
      .in("id", spaceIds);
    if (spaceError) throw new Error("space lookup failed");

    const spaceById = new Map(
      ((spaceRows ?? []) as { id: string; status: string; host_id: string }[]).map((s) => [s.id, s]),
    );

    // A media item is allowed when its space is active, or owned by the caller.
    // Only the requested columns of an allowed row are signed — never a path the
    // caller did not ask for, and never one tied to no record.
    const requestedSet = new Set(requested);
    const allowed = new Set<string>();
    for (const m of media) {
      const space = spaceById.get(m.space_id);
      if (!space || !(space.status === "active" || space.host_id === user.id)) continue;
      if (requestedSet.has(m.storage_path)) allowed.add(m.storage_path);
      if (m.card_path && requestedSet.has(m.card_path)) allowed.add(m.card_path);
    }

    if (allowed.size === 0) {
      return Response.json({ urls: {} } satisfies MediaSignResponse);
    }

    const { data: signed } = await admin.storage
      .from("space-media")
      .createSignedUrls([...allowed], MEDIA_SIGN_TTL_SECONDS);

    const urls: Record<string, string> = {};
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
    }

    return Response.json({ urls } satisfies MediaSignResponse);
  });
}
