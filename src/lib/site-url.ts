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
 * That window has now closed: the domain is pointed and serving. So the
 * intended address is simply the right answer, and Vercel's own deployment
 * hostname is the fallback rather than the preference — it kept reporting the
 * project's .vercel.app name after the custom domain went live, which put the
 * wrong host in every link preview.
 *
 * The explicit override stays first, as the way to move the whole app to a new
 * address without a deploy.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  if (APP_URL) return APP_URL;

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return vercel ? `https://${vercel.replace(/\/$/, "")}` : "http://localhost:3000";
}
