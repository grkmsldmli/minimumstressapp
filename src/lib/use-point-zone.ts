"use client";

import { useEffect, useState } from "react";

import type { LatLng } from "./geo";
import { FALLBACK_ZONE, isKnownZone, viewerZone } from "./timezone";

/**
 * The timezone of the pin a host has placed.
 *
 * Asked of the server, because the table that maps coordinates to zones is a
 * megabyte of boundary data and has no business on a phone. One call per
 * address chosen, cached for a day at the edge.
 *
 * Until the answer arrives — and if it never does — this is the host's own
 * zone. A host setting up their own studio is usually standing in the same
 * city as it, so that is a good guess rather than a shrug, and the resolved
 * answer replaces it a moment later either way.
 */
export function usePointZone(point: LatLng | null): string {
  const [zone, setZone] = useState(() => {
    const mine = viewerZone();
    return isKnownZone(mine) ? mine : FALLBACK_ZONE;
  });

  /*
   * The coordinates, not the object holding them. A parent that rebuilds
   * `{ lat, lng }` on every render would otherwise refetch on every render.
   */
  const lat = point?.lat ?? null;
  const lng = point?.lng ?? null;

  useEffect(() => {
    if (lat === null || lng === null) return;

    const abort = new AbortController();

    void (async () => {
      try {
        const response = await fetch(`/api/geocode/zone?lat=${lat}&lng=${lng}`, {
          signal: abort.signal,
        });
        if (!response.ok) return;

        const body = (await response.json()) as { timezone?: string };
        // Checked here as well as on the server: this string ends up in every
        // Intl call the listing makes, and an unresolvable one throws on render.
        if (body.timezone && isKnownZone(body.timezone)) setZone(body.timezone);
      } catch {
        // Offline, or the pin moved again before this finished. The zone that
        // is already in state is a usable answer, so nothing is reported.
      }
    })();

    return () => abort.abort();
  }, [lat, lng]);

  return zone;
}
