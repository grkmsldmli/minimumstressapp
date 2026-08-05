"use client";

import { MapPin, Navigation, Search } from "lucide-react";
import { useState } from "react";

import { isPostalCode } from "@/lib/distance";

/**
 * Asking where somebody is, before the browser does.
 *
 * The browser's own permission dialog gives no reason and no alternative — it
 * is a yes/no with no context, and a "no" there is remembered by the browser
 * and hard to undo. So the explanation comes first, in our own words, and the
 * native prompt only appears once someone has chosen to see it.
 *
 * The postal code is not a consolation prize. Someone who does not want to
 * share a precise location gets the same feature, ordered the same way, from a
 * five-digit number — which is deliberately coarse and is the point.
 */

export type LocationChoice =
  | { kind: "coords"; lat: number; lng: number }
  | { kind: "postal"; postalCode: string };

export function LocationPrompt({
  onChoose,
  onDismiss,
}: {
  onChoose: (choice: LocationChoice) => void;
  onDismiss: () => void;
}) {
  const [postal, setPostal] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const askBrowser = () => {
    if (!("geolocation" in navigator)) {
      setError("This browser can't share a location. A ZIP code works just as well.");
      return;
    }

    setAsking(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setAsking(false);
        onChoose({
          kind: "coords",
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (failure) => {
        setAsking(false);
        /**
         * A refusal is not an error to apologise for — it is an answer, and
         * the ZIP field below is already the response to it. Only the cases
         * where something actually went wrong get a message.
         */
        if (failure.code === failure.PERMISSION_DENIED) {
          setError("No problem — a ZIP code works just as well.");
          return;
        }
        setError("We couldn't get a location just now. Try a ZIP code instead.");
      },
      { timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  };

  const valid = isPostalCode(postal);

  return (
    <div
      className="rounded-2xl p-4 card-in"
      style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
    >
      <div className="flex items-start gap-2.5">
        <MapPin size={15} color="#3B9BE8" className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="font-body font-medium text-[14.5px] text-navy">Show me what&apos;s close</p>
          <p className="font-body font-normal text-[14px] mt-1 leading-relaxed text-ink-soft">
            We use your location once, to put the nearest rooms first. It is not saved, not shared,
            and never attached to your account.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={askBrowser}
        disabled={asking}
        className="w-full mt-3 flex items-center justify-center gap-1.5 py-2.5 rounded-full font-body font-medium text-[13.5px] text-white press"
        style={{ backgroundColor: "#2578C2", opacity: asking ? 0.6 : 1 }}
      >
        <Navigation size={13} />
        {asking ? "Asking your browser…" : "Use my location"}
      </button>

      <div className="flex items-center gap-3 my-3">
        <div className="flex-1 h-px" style={{ backgroundColor: "#DCE7F2" }} />
        <span className="font-body font-normal text-[10.5px] uppercase tracking-wide text-ink-faint">
          or
        </span>
        <div className="flex-1 h-px" style={{ backgroundColor: "#DCE7F2" }} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onChoose({ kind: "postal", postalCode: postal.trim() });
        }}
        className="flex gap-2"
      >
        <div
          className="flex-1 flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-white"
          style={{ border: "1px solid #DCE7F2" }}
        >
          <Search size={13} color="#8CA3BD" />
          <input
            value={postal}
            onChange={(e) => setPostal(e.target.value)}
            placeholder="ZIP code"
            aria-label="ZIP code"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={10}
            className="font-body text-[14.5px] outline-none w-full text-navy bg-transparent"
          />
        </div>
        <button
          type="submit"
          disabled={!valid}
          className="px-4 rounded-xl font-body font-medium text-[13.5px] press"
          style={
            valid
              ? { backgroundColor: "#16304E", color: "#fff" }
              : { border: "1px solid #DCE7F2", color: "#7B93AE" }
          }
        >
          Go
        </button>
      </form>

      {error && (
        <p className="font-body font-normal text-[13.5px] mt-2.5 text-ink-soft">{error}</p>
      )}

      <button
        type="button"
        onClick={onDismiss}
        className="w-full mt-3 font-body font-normal text-[13.5px] press text-ink-faint"
      >
        Not now — show me everything
      </button>
    </div>
  );
}
