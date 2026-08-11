import { APP_URL } from "./company";

/**
 * The origin this deployment is actually reachable at.
 *
 * Distinct from `APP_URL`, which is where the app is *meant* to live. The two
 * differ for exactly as long as it takes DNS to be pointed, and during that
 * window they must not be confused: a link preview whose image URL is on a
 * domain that does not serve the app yet unfurls with a broken picture, which
 * is worse than no picture at all — and this is the window when the link is
 * being sent to studio owners.
 *
 * So: an explicit override first, then whatever Vercel says this deployment's
 * production domain is — which becomes the custom domain by itself the moment
 * it is attached — and the intended address last, for a local build that has
 * neither.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;

  return APP_URL;
}
