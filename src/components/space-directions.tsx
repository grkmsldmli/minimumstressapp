"use client";

import { Check, Copy, MapPin, Navigation } from "lucide-react";
import { useEffect, useState } from "react";

import type { SpaceAccessDetails } from "@/lib/domain";

import { LocationMap } from "./location-map";

/**
 * Where the room is, and how to get there — shown only once a booking exists.
 *
 * Everything here is served by `space_access_details`, which performs its own
 * booking check in the database. There is no client-side gate to get wrong:
 * before a booking the address never leaves the server, and after one it is
 * exactly what the practitioner needs to find a door they have never seen.
 */

/**
 * The maps link, built from coordinates when we have them.
 *
 * Coordinates rather than the address string wherever possible, because a
 * geocoder run by a maps app on a hand-typed line is one more chance to land
 * on the wrong building — and we already resolved this one exactly.
 *
 * Apple Maps on Apple platforms: it is the default there, and sending someone
 * to a Google Maps web page when their phone has a maps app that opens
 * natively is a worse first step of a journey.
 */
export function directionsUrl(access: SpaceAccessDetails, isApple: boolean): string {
  const hasPoint = access.lat !== null && access.lng !== null;
  const destination = hasPoint ? `${access.lat},${access.lng}` : access.addressLine;

  return isApple
    ? `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

/** True on iPhone, iPad and Mac, where Apple Maps is the native default. */
function detectApple(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
}

export function SpaceDirections({
  access,
  tone = "light",
  showMap = false,
}: {
  access: SpaceAccessDetails;
  tone?: "light" | "dark";
  showMap?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(access.addressLine);
      setCopied(true);
    } catch {
      // Clipboard access can be refused outright. The address is on screen and
      // selectable, so there is nothing to recover from and nothing to say.
    }
  };

  const dark = tone === "dark";
  const muted = dark ? "text-white/70" : "text-ink-soft";
  const faint = dark ? "text-white/50" : "text-ink-faint";

  return (
    <div>
      <p
        className={`flex items-start gap-2 font-body font-normal text-[14px] leading-relaxed ${muted}`}
      >
        <MapPin size={12} className="mt-0.5 shrink-0" color={dark ? "#8FC6F5" : "#3B9BE8"} />
        {access.addressLine}
      </p>

      {access.entryInstructions && (
        <p className={`font-body font-normal text-[13.5px] mt-1.5 leading-relaxed ${faint}`}>
          {access.entryInstructions}
        </p>
      )}

      {showMap && access.lat !== null && access.lng !== null && (
        <div className="mt-3">
          <LocationMap point={{ lat: access.lat, lng: access.lng }} height={130} />
        </div>
      )}

      <div className="flex gap-2 mt-3">
        {/*
          The href is the universal one, so this stays a real link — openable
          in a new tab, long-pressable, readable by a screen reader as a
          destination. The Apple variant is swapped in at click time rather
          than at render, because the server has no user agent to check and a
          value that changes on hydration changes the link under the user.
        */}
        <a
          href={directionsUrl(access, false)}
          onClick={(event) => {
            if (!detectApple()) return;
            event.preventDefault();
            window.open(directionsUrl(access, true), "_blank", "noopener,noreferrer");
          }}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-full font-body font-medium text-[15px] press"
          style={
            dark
              ? { backgroundColor: "rgba(255,255,255,0.14)", color: "#fff" }
              : { backgroundColor: "#2578C2", color: "#fff" }
          }
        >
          <Navigation size={12} />
          Directions
        </a>

        <button
          type="button"
          onClick={() => void copy()}
          aria-label="Copy address"
          className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full font-body font-medium text-[15px] press"
          style={
            dark
              ? { backgroundColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.75)" }
              : { border: "1px solid #DCE7F2", color: "#16304E" }
          }
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
