/**
 * What may be uploaded, and what it is allowed to be called.
 *
 * Pure functions, so the rules can be tested without a storage backend — and
 * because these are the rules, not a convenience wrapper around them. The
 * storage policies in 0003_storage.sql decide *where* a file may be written by
 * reading the first path segment; this decides what reaches that path at all.
 */

export type UploadKind = "image" | "video" | "document";

/**
 * Extension is derived from the type, never from the name the browser gave us.
 *
 * This mapping is the whole reason the upload path contains no user-supplied
 * bytes. A file called `../other-space/cover.jpg` would change which folder
 * `storage.foldername(name)[1]` reports, and that value is exactly what the
 * RLS policy compares against the host's own space id — so a crafted filename
 * is a write into somebody else's listing. Generating the name removes the
 * class of bug rather than filtering for it.
 */
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "application/pdf": "pdf",
};

const ALLOWED: Record<UploadKind, string[]> = {
  image: ["image/jpeg", "image/png", "image/webp", "image/heic"],
  video: ["video/mp4", "video/quicktime", "video/webm"],
  // A photo of a lease is as common as a scan of one, so images count.
  document: ["application/pdf", "image/jpeg", "image/png", "image/heic"],
};

/**
 * Ceilings, not targets.
 *
 * Generous enough that a phone photo or a short room tour never fails, low
 * enough that a single upload cannot fill a bucket. Video is the outlier
 * because a 30-second walkthrough off a modern phone is genuinely tens of
 * megabytes.
 */
export const MAX_BYTES: Record<UploadKind, number> = {
  image: 12 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  document: 20 * 1024 * 1024,
};

export interface UploadCandidate {
  type: string;
  size: number;
}

/** Null when the file is acceptable; otherwise what to tell the person. */
export function rejectionReason(file: UploadCandidate, kind: UploadKind): string | null {
  // Lowercased and stripped of parameters: browsers send `image/jpeg` and
  // sometimes `image/jpeg; charset=binary`, and the two are the same type.
  const type = file.type.split(";")[0].trim().toLowerCase();

  if (!ALLOWED[kind].includes(type)) {
    return kind === "document"
      ? "That file type isn't accepted — please upload a PDF or a photo."
      : `That file type isn't accepted for ${kind === "image" ? "photos" : "video"}.`;
  }

  if (file.size <= 0) return "That file appears to be empty.";

  if (file.size > MAX_BYTES[kind]) {
    return `That file is too large — the limit is ${formatBytes(MAX_BYTES[kind])}.`;
  }

  return null;
}

/**
 * The name a file is stored under: a fresh id and the extension its type
 * implies. Nothing the uploader chose survives.
 */
export function storageName(type: string, id: string): string {
  const normalized = type.split(";")[0].trim().toLowerCase();
  const extension = EXTENSIONS[normalized];
  if (!extension) throw new Error(`No extension known for ${type}`);
  return `${id}.${extension}`;
}

/** Path inside the space-media bucket, matching the policy in 0003. */
export function spaceMediaPath(spaceId: string, type: string, id: string): string {
  return `${spaceId}/${storageName(type, id)}`;
}

/** Path inside verification-docs for a space's sublease proof. */
export function spaceDocPath(spaceId: string, type: string, id: string): string {
  return `space/${spaceId}/${storageName(type, id)}`;
}

/** Path inside verification-docs for a practitioner's own certificate. */
export function practitionerDocPath(userId: string, type: string, id: string): string {
  return `practitioner/${userId}/${storageName(type, id)}`;
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${Math.round(mb)} MB`;
}
