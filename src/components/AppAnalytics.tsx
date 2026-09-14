"use client";

import { useEffect } from "react";

import { appAnalyticsPlatform, captureAppOpened } from "@/lib/analytics/client";

/** Launch counts for the marketplace app, with no screen, route id or properties. */
export function AppAnalytics() {
  useEffect(() => {
    const platform = appAnalyticsPlatform();
    void captureAppOpened(platform);
  }, []);

  return null;
}
