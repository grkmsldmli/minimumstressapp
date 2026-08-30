/**
 * Resized, compressed image variants, made in the browser before upload.
 *
 * A host's phone produces photos up to 12 MB, and Discover was rendering them
 * into 145px cards at full resolution — megabytes to paint a thumbnail. So on
 * the way in we make two smaller variants and store those instead of the giant
 * original: a card thumbnail for lists, and a detail image for the gallery.
 * WebP where the browser can encode it, JPEG where it cannot, so the format
 * never blocks an upload; either way the win is the resize.
 *
 * The dimension maths is pure and lives here so it can be tested without a
 * canvas; the encoding needs a DOM and runs only in the browser.
 */

export interface VariantSpec {
  label: "card" | "detail";
  /** The longest edge the variant may have; smaller images are never upscaled. */
  maxEdge: number;
  /** Encoder quality, 0–1. */
  quality: number;
}

/**
 * Card first, then detail. A 600px long edge is ample for a 145px card at any
 * pixel density; 1600px is enough for a full-bleed gallery on a phone or tablet
 * without shipping a desktop-poster-sized file.
 */
export const IMAGE_VARIANTS: readonly VariantSpec[] = [
  { label: "card", maxEdge: 600, quality: 0.78 },
  { label: "detail", maxEdge: 1600, quality: 0.82 },
] as const;

/**
 * The variant's dimensions: scaled to fit within `maxEdge` on its longest side,
 * aspect preserved, and never enlarged — a small photo stays its own size
 * rather than being blown up to the ceiling.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= 0 || longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * One variant as a Blob, WebP if the browser will encode it, JPEG otherwise.
 *
 * Safari only learned to encode WebP through a canvas recently, so a null or
 * wrong-typed result is a real possibility, not a defensive nicety — falling
 * back to JPEG keeps the resize (the part that matters) even on an older shell.
 */
async function encodeVariant(bitmap: ImageBitmap, spec: VariantSpec): Promise<Blob> {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, spec.maxEdge);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not get a 2D canvas context");
  context.drawImage(bitmap, 0, 0, width, height);

  const webp = await toBlob(canvas, "image/webp", spec.quality);
  if (webp && webp.type === "image/webp") return webp;

  const jpeg = await toBlob(canvas, "image/jpeg", spec.quality);
  if (jpeg) return jpeg;

  throw new Error("Could not encode image variant");
}

export interface ImageVariants {
  card: Blob;
  detail: Blob;
}

/**
 * Both variants for one uploaded image, decoding the source a single time.
 *
 * Throws if the browser cannot decode the file (a format canvas will not take,
 * say) — the caller falls back to uploading the original so an upload never
 * fails for the sake of the optimisation.
 */
export async function buildImageVariants(file: Blob): Promise<ImageVariants> {
  const bitmap = await createImageBitmap(file);
  try {
    const card = await encodeVariant(bitmap, IMAGE_VARIANTS[0]);
    const detail = await encodeVariant(bitmap, IMAGE_VARIANTS[1]);
    return { card, detail };
  } finally {
    bitmap.close();
  }
}
