/**
 * The contract for the authenticated media-signing route.
 *
 * Listing media lives in a private bucket; the only way to read it is a
 * short-lived signed URL minted server-side, after the server has checked
 * against database truth that the caller may see that path (see
 * /api/spaces/media/sign). The client sends the storage paths it needs and gets
 * back a path→URL map for the ones it is allowed. Shared here so the route and
 * the repository agree on the batch ceiling and the shapes.
 */

/**
 * The most paths one request may ask to sign.
 *
 * Bounds the work a single call can demand. The repository chunks anything
 * larger into successive requests, so a busy Discover never silently loses
 * images to the cap.
 */
export const MEDIA_SIGN_MAX_BATCH = 100;

/** How long a signed listing-media URL stays valid — long enough to browse. */
export const MEDIA_SIGN_TTL_SECONDS = 60 * 60;

export interface MediaSignRequest {
  paths: string[];
}

export interface MediaSignResponse {
  /** Storage path → signed URL, only for the paths the caller was allowed. */
  urls: Record<string, string>;
}
