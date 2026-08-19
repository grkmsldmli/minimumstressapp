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
