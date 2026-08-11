import type { MetadataRoute } from "next";

import { BRAND } from "@/lib/company";

/**
 * What "Add to Home Screen" produces.
 *
 * The plan is web first — a native build would add weeks and, for the Pro
 * subscription, Apple's cut on top — so the installed web app is the mobile
 * app for now. Without this it installs as a browser bookmark: a screenshot
 * for an icon, the URL under it, and the address bar still covering the top of
 * every screen.
 *
 * `standalone` is the line that removes the browser chrome, which is most of
 * the difference between something that feels like an app and something that
 * feels like a website somebody saved.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND} — rooms by the hour`,
    short_name: BRAND,
    description:
      "Private rooms by the hour for every kind of practice — movement, coaching, meditation, and healing.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#16304E",
    theme_color: "#16304E",
    categories: ["health", "lifestyle", "business"],
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android draws its own shape over this one, so it needs the padding
      // that `maskable` promises — the same file without it gets its corners
      // cut off.
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
