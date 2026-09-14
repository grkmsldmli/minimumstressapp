import { isNativeApp } from "@/lib/native";

/**
 * The only analytics facts a browser is allowed to report.
 *
 * Money, bookings, verification and account state are server facts and never
 * pass through this client. Even these two events carry no arbitrary property
 * bag: the route receives one enumerated surface, one enumerated platform and
 * a random id that lasts only for the current tab/WebView session.
 */
export const CLIENT_ANALYTICS_EVENTS = ["page_viewed", "app_opened"] as const;
export type ClientAnalyticsEvent = (typeof CLIENT_ANALYTICS_EVENTS)[number];

export const ANALYTICS_PLATFORMS = ["site_web", "app_web", "ios", "android"] as const;
export type AnalyticsPlatform = (typeof ANALYTICS_PLATFORMS)[number];

/** App opens deliberately reveal no authenticated navigation state. */
export const APP_SURFACE = "app" as const;

/** Public route templates, never the values in their dynamic segments. */
export const SITE_SURFACES = [
  "/",
  "/about",
  "/assessments",
  "/assessments/[assessment]",
  "/contact",
  "/faq",
  "/for-hosts",
  "/for-practitioners",
  "/privacy-choices",
  "/rent-out-your",
  "/rent-out-your/[type]",
  "/spaces",
  "/spaces/[state]/[city]",
  "/spaces/[state]/[city]/[type]",
  "/trust",
] as const;

export type SiteSurface = (typeof SITE_SURFACES)[number];

const STATIC_SITE_SURFACES = new Set<SiteSurface>([
  "/",
  "/about",
  "/assessments",
  "/contact",
  "/faq",
  "/for-hosts",
  "/for-practitioners",
  "/privacy-choices",
  "/rent-out-your",
  "/spaces",
  "/trust",
]);

/**
 * Turn a visible content-site pathname into a bounded route template.
 *
 * `usePathname` does not include the query string, but this still strips one so
 * callers and tests cannot accidentally put search text into analytics. The
 * internal `/site` prefix is removed, dynamic values are replaced with their
 * template names, and everything outside the known public tree (especially
 * `/admin` and id-bearing paths) is refused.
 */
export function websiteSurface(pathname: string): SiteSurface | null {
  const withoutQuery = pathname.split(/[?#]/, 1)[0] || "/";
  let path = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  path = path.replace(/\/+$/, "") || "/";
  if (path === "/site") path = "/";
  else if (path.startsWith("/site/")) path = path.slice(5);

  if (path === "/admin" || path.startsWith("/admin/")) return null;
  if (STATIC_SITE_SURFACES.has(path as SiteSurface)) return path as SiteSurface;

  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "assessments" && parts.length === 2) {
    return "/assessments/[assessment]";
  }
  if (parts[0] === "rent-out-your" && parts.length === 2) {
    return "/rent-out-your/[type]";
  }
  if (parts[0] === "spaces" && parts.length === 3) {
    return "/spaces/[state]/[city]";
  }
  if (parts[0] === "spaces" && parts.length === 4) {
    return "/spaces/[state]/[city]/[type]";
  }

  return null;
}

/** Platform values are deliberately coarse: no model, device or advertising id. */
export function appAnalyticsPlatform(): Exclude<AnalyticsPlatform, "site_web"> {
  if (!isNativeApp()) return "app_web";

  const capacitor = (window as {
    Capacitor?: { getPlatform?: () => string };
  }).Capacitor;
  const platform = capacitor?.getPlatform?.();
  if (platform === "ios" || platform === "android") return platform;

  // Older shells may expose isNativePlatform without getPlatform. The user
  // agent is used only to choose one of two coarse labels and is never sent.
  if (/android/i.test(navigator.userAgent)) return "android";
  if (/iPad|iPhone|iPod/i.test(navigator.userAgent)) return "ios";

  // Unknown native shells are counted as app web rather than inventing an OS.
  return "app_web";
}

const SESSION_KEY = "minimumstress.analytics.session";
const APP_OPENED_KEY_PREFIX = "minimumstress.analytics.app-opened.";
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const openedSessions = new Set<string>();

function newSessionId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // RFC 4122 v4, solely so the server can validate a compact opaque shape.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * One random id per browser tab or native WebView session.
 *
 * There is deliberately no localStorage fallback: if sessionStorage is not
 * available, analytics is skipped rather than replacing it with a persistent
 * identifier.
 */
export function analyticsSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing && SESSION_ID.test(existing)) return existing;

    const created = newSessionId();
    sessionStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return null;
  }
}

export type ClientAnalyticsInput =
  | { event: "page_viewed"; platform: "site_web"; surface: SiteSurface }
  | {
      event: "app_opened";
      platform: Exclude<AnalyticsPlatform, "site_web">;
      surface: typeof APP_SURFACE;
    };

/** Best-effort and invisible: analytics must never interrupt the product. */
export async function captureAnalytics(input: ClientAnalyticsInput): Promise<boolean> {
  const sessionId = analyticsSessionId();
  if (!sessionId) return false;

  try {
    const response = await fetch("/api/analytics", {
      method: "POST",
      credentials: "omit",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: input.event,
        platform: input.platform,
        surface: input.surface,
        sessionId,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Count an app launch once per loaded tab/WebView, including under Strict Mode. */
export async function captureAppOpened(
  platform: Exclude<AnalyticsPlatform, "site_web">,
): Promise<boolean> {
  const sessionId = analyticsSessionId();
  if (!sessionId) return false;

  const key = `${sessionId}:${platform}`;
  if (openedSessions.has(key)) return true;
  try {
    if (sessionStorage.getItem(`${APP_OPENED_KEY_PREFIX}${platform}`) === sessionId) {
      openedSessions.add(key);
      return true;
    }
  } catch {
    return false;
  }
  openedSessions.add(key);

  const sent = await captureAnalytics({
    event: "app_opened",
    platform,
    surface: APP_SURFACE,
  });
  if (sent) {
    try {
      sessionStorage.setItem(`${APP_OPENED_KEY_PREFIX}${platform}`, sessionId);
    } catch {
      // The event already landed. Failure to persist only means a reload may
      // send it again; the admin KPI still de-duplicates by session id.
    }
  } else {
    openedSessions.delete(key);
  }
  return sent;
}
