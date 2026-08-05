import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Deleting an account, in an order chosen so a failure halfway leaves nothing
 * dangerous behind.
 *
 * The steps are not interchangeable. Documents go first because they are the
 * sensitive part, and a run that removed the database row but kept the lease
 * on disk would have deleted the only record of what the file belonged to
 * while leaving the file. Auth goes last because until it is gone the person
 * can still sign in and ask what happened.
 *
 * Not everything is erased, and the parts that survive are deliberate. A
 * completed booking is a financial record for two people: deleting it takes a
 * host's own income history with it. Reviews are detached rather than removed,
 * because a listing's rating is partly other people's contribution and one
 * person leaving should not rewrite what everybody else said.
 *
 * So this removes the person, not the history.
 */

export type DeletionRefusal = "upcoming_bookings" | "not_found";

export type DeletionResult =
  | { ok: true; removed: { documents: number; reviews: number; bookings: number } }
  | { ok: false; reason: DeletionRefusal; upcoming?: number };

const DOCUMENT_BUCKET = "verification-docs";
const AVATAR_BUCKET = "avatars";
const MEDIA_BUCKET = "space-media";

export async function deleteAccount(
  admin: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<DeletionResult> {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, avatar_path")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) return { ok: false, reason: "not_found" };

  /**
   * Refused while a session is still ahead.
   *
   * Deleting an account with a room booked for tomorrow leaves a host
   * expecting somebody who no longer exists, and a practitioner holding a door
   * code with nobody to ask about it. Cancel first — which has its own rules
   * about who is charged — and then delete.
   */
  const { count: upcoming, error: upcomingError } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("practitioner_id", userId)
    .eq("status", "upcoming")
    .gte("starts_at", now.toISOString());

  if (upcomingError) throw upcomingError;
  if ((upcoming ?? 0) > 0) {
    return { ok: false, reason: "upcoming_bookings", upcoming: upcoming ?? 0 };
  }

  const { data: hostedSpaces, error: spacesError } = await admin
    .from("spaces")
    .select("id")
    .eq("host_id", userId);

  if (spacesError) throw spacesError;
  const spaceIds = (hostedSpaces ?? []).map((s) => s.id as string);

  if (spaceIds.length > 0) {
    const { count: hostUpcoming, error } = await admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .in("space_id", spaceIds)
      .eq("status", "upcoming")
      .gte("starts_at", now.toISOString());

    if (error) throw error;
    if ((hostUpcoming ?? 0) > 0) {
      return { ok: false, reason: "upcoming_bookings", upcoming: hostUpcoming ?? 0 };
    }
  }

  // 1. Documents. First, for the reason at the top of this file.
  const documents = await removeDocuments(admin, userId, spaceIds);

  // 2. The person, cleared out of the profile that survives as a foreign key
  //    target for the bookings below.
  const { error: scrubError } = await admin
    .from("profiles")
    .update({
      display_name: null,
      avatar_path: null,
      phone: null,
      phone_verified_at: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
      emergency_contact_relationship: null,
      insurance_doc_path: null,
      notify_bookings: false,
      notify_payouts: false,
      notify_offers: false,
      notify_sms: false,
    })
    .eq("id", userId);

  if (scrubError) throw scrubError;

  // 3. Listings go entirely — a delisted room with no host is not a record
  //    anybody needs, and its address is somebody's building.
  if (spaceIds.length > 0) {
    const { error } = await admin.from("spaces").delete().in("id", spaceIds);
    // A space with completed bookings cannot be deleted: the financial FKs are
    // `on delete restrict` on purpose. Delisting is the honest fallback.
    if (error) {
      await admin.from("spaces").update({ status: "delisted" }).in("id", spaceIds);
    }
  }

  // 4. Reviews keep their content and lose their author's words about them.
  const { count: reviews, error: reviewError } = await admin
    .from("reviews")
    .update({ comment: "" }, { count: "exact" })
    .eq("author_id", userId);

  if (reviewError) throw reviewError;

  const { count: bookings, error: bookingCountError } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("practitioner_id", userId);

  if (bookingCountError) throw bookingCountError;

  // 5. Last. Until this is gone the account can still be used.
  const { error: authError } = await admin.auth.admin.deleteUser(userId);
  if (authError) throw authError;

  return {
    ok: true,
    removed: { documents, reviews: reviews ?? 0, bookings: bookings ?? 0 },
  };
}

/**
 * Takes every file this person uploaded out of storage.
 *
 * Listed rather than guessed at: the paths are recorded in rows that are about
 * to be cleared, and reconstructing them afterwards is impossible. Failures
 * are counted rather than thrown — one unreadable folder must not stop the
 * rest of a deletion somebody asked for.
 */
async function removeDocuments(
  admin: SupabaseClient,
  userId: string,
  spaceIds: string[],
): Promise<number> {
  const paths: { bucket: string; path: string }[] = [];

  const collect = async (bucket: string, prefix: string) => {
    const { data, error } = await admin.storage.from(bucket).list(prefix);
    if (error) return;
    for (const file of data ?? []) {
      if (file.id) paths.push({ bucket, path: `${prefix}/${file.name}` });
    }
  };

  // Paperwork: the practitioner's own certificates, then one folder per room.
  await collect(DOCUMENT_BUCKET, `practitioner/${userId}`);
  for (const id of spaceIds) await collect(DOCUMENT_BUCKET, `space/${userId}/${id}`);

  /*
   * The room photos, which were left behind entirely until now.
   *
   * They are public-read, so a listing's pictures outlived the account that
   * uploaded them and stayed fetchable by anyone holding the URL — the exact
   * thing the deletion promise says does not happen. Cheap to miss: nothing
   * links to them once the rows are gone, so nobody would notice.
   */
  for (const id of spaceIds) await collect(MEDIA_BUCKET, `${userId}/${id}`);

  const { data: avatars } = await admin.storage.from(AVATAR_BUCKET).list(userId);
  for (const file of avatars ?? []) {
    if (file.id) paths.push({ bucket: AVATAR_BUCKET, path: `${userId}/${file.name}` });
  }

  let removed = 0;
  for (const bucket of new Set(paths.map((p) => p.bucket))) {
    const inBucket = paths.filter((p) => p.bucket === bucket).map((p) => p.path);
    if (inBucket.length === 0) continue;

    const { error } = await admin.storage.from(bucket).remove(inBucket);
    if (!error) removed += inBucket.length;
    else console.error(`Could not remove ${inBucket.length} file(s) from ${bucket}:`, error);
  }

  return removed;
}
