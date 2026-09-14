"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { captureAnalytics, websiteSurface } from "@/lib/analytics/client";

/** First-party, cookie-free page counts for the public content site. */
export function WebsiteAnalytics() {
  const pathname = usePathname();

  useEffect(() => {
    const surface = websiteSurface(pathname);
    if (!surface) return;
    void captureAnalytics({ event: "page_viewed", platform: "site_web", surface });
  }, [pathname]);

  return null;
}
