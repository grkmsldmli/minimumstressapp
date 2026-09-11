import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The native shell for the App Store and Play Store.
 *
 * Minimum Stress is a server-rendered Next.js app, not a static bundle, so the
 * shell does not ship its own copy of the site. It loads the live app from
 * `server.url` — the native app IS the website, wrapped so it can be listed in
 * the stores and reach native capabilities the browser cannot (push
 * notifications, and a secure system-browser sign-in, since Google refuses
 * OAuth inside an embedded webview).
 *
 * `webDir` is a placeholder fallback (mobile/www), shown only if the network is
 * unreachable; the remote URL is what a user actually sees.
 *
 * appId is the permanent store identifier and must match the App Store /
 * Play Store listings once submitted. Change it before first submission, not
 * after.
 */
const config: CapacitorConfig = {
  appId: "com.minimumstress.app",
  appName: "Minimum Stress",
  webDir: "mobile/www",
  server: {
    url: "https://minimumstress.app",
    // Production is HTTPS only; never fall back to cleartext.
    cleartext: false,
  },
};

export default config;
