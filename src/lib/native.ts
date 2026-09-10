/**
 * True when the app is running inside the Capacitor native shell — the App
 * Store / Play Store build — rather than an ordinary browser.
 *
 * The shell loads the live site in a WebView and injects a `window.Capacitor`
 * global. We read that directly instead of importing `@capacitor/core`, so the
 * web bundle carries no native dependency and this costs nothing on the web.
 *
 * SSR-safe: `window` is undefined on the server, where the answer is always
 * false — the server render is the web one, and the native shell only differs
 * once its injected global exists in the browser.
 */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

/**
 * Send the user to a URL that must leave the app — a Stripe-hosted checkout,
 * portal, or identity/Connect page, or a legal page.
 *
 * On the web this is an ordinary navigation. In the native shell it must open in
 * the system browser rather than the WebView: an embedded purchase webview is
 * exactly what App Store Guideline 3.1.1 forbids, and Google likewise refuses
 * OAuth in a webview. `_blank` is how the Capacitor WebView routes an off-origin
 * URL to the system browser (payment hosts are kept out of the shell's
 * allowNavigation), so the purchase happens in Safari and the account's Pro
 * state is reconciled from server truth when the app is resumed.
 */
export function openExternal(url: string): void {
  if (typeof window === "undefined") return;
  if (isNativeApp()) {
    window.open(url, "_blank");
    return;
  }
  window.location.href = url;
}

/**
 * The URL the native OAuth flow returns to.
 *
 * A custom scheme the iOS/Android shell registers (CFBundleURLTypes /
 * intent-filter on the mobile-app branch), so the system browser hands control
 * back to the app after Apple/Google sign-in. The web uses `/auth/callback`
 * instead. Supabase must allowlist this exact value as a redirect URL.
 */
export const NATIVE_AUTH_REDIRECT = "com.minimumstress.app://auth-callback";

/**
 * A Capacitor plugin injected into the native shell, or null on the web / when
 * the plugin is not installed.
 *
 * Read from the `window.Capacitor.Plugins` global — the same reasoning as
 * `isNativeApp`: the web bundle carries no `@capacitor/*` dependency, and the
 * OAuth code that uses this (Browser, App) is dormant until the native build
 * ships those plugins. Callers must handle null (fail cleanly, never crash).
 */
export function capacitorPlugin<T = unknown>(name: string): T | null {
  if (typeof window === "undefined") return null;
  const cap = (window as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  return (cap?.Plugins?.[name] as T | undefined) ?? null;
}
