"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ADDRESS_ZOOM, type LatLng, pixelToPoint, pointToPixel, tileGrid } from "@/lib/geo";

/**
 * A real map of one point, for the host confirming their own address.
 *
 * Deliberately not used anywhere a practitioner browses. The illustrated map
 * in `map.tsx` exists because a listing's address is private until it is
 * booked, and swapping a real one in there would undo that. Here the host is
 * looking at a building they already know — the whole value is being able to
 * see that the geocoder picked the right one.
 *
 * Raster tiles, laid out as plain images. A mapping library would bring a few
 * hundred kilobytes and a second rendering model for one static, non-panning
 * view; the projection it would do for us is a dozen lines in `geo.ts` and is
 * tested there.
 */

const TILE_HOST = "https://tile.openstreetmap.org";

export function LocationMap({
  point,
  height = 150,
  onPick,
}: {
  point: LatLng | null;
  height?: number;
  /** Given when the host is allowed to correct the pin by tapping. */
  onPick?: (point: LatLng) => void;
}) {
  const [width, setWidth] = useState(0);

  /**
   * Tiles are addressed in pixels, so nothing can be drawn until the box has
   * been measured.
   *
   * Measured on attach rather than waiting to be told. A ResizeObserver's first
   * callback is not guaranteed to arrive promptly — in a tab that is not
   * compositing it may never arrive — and a map that waits for it shows an
   * empty grey box forever. The observer is kept for what it is actually good
   * at, which is later changes.
   *
   * A callback ref rather than an effect because the box this measures is a
   * different element before and after a point exists, and an effect with a
   * stable dependency list would go on observing the one that was unmounted.
   */
  const observerRef = useRef<ResizeObserver | null>(null);

  const boxRef = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!element) return;

    const read = () => {
      const measured = element.getBoundingClientRect().width;
      if (measured > 0) setWidth((current) => (current === measured ? current : measured));
    };

    read();

    if (typeof ResizeObserver !== "undefined") {
      observerRef.current = new ResizeObserver(read);
      observerRef.current.observe(element);
    }
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  /**
   * The map follows the geocoder, but not the host's own corrections.
   *
   * Recentring on every tap would slide the ground out from under the finger
   * that just tapped it, so the centre is only reset when a *different* place
   * arrives — which is what choosing from the dropdown does.
   */
  const [centre, setCentre] = useState<LatLng | null>(point);
  const lastPicked = useRef<string | null>(null);
  const pointKey = point ? `${point.lat},${point.lng}` : null;

  useEffect(() => {
    if (!point) return;
    if (lastPicked.current === pointKey) return;
    setCentre(point);
  }, [point, pointKey]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onPick || !centre || width === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const picked = pixelToPoint(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      centre,
      ADDRESS_ZOOM,
      width,
      height,
    );
    lastPicked.current = `${picked.lat},${picked.lng}`;
    onPick(picked);
  };

  if (!centre || width === 0) {
    return (
      <div
        ref={boxRef}
        className="relative rounded-2xl overflow-hidden flex items-center justify-center"
        style={{ height, border: "1px solid #E7EEF6", backgroundColor: "#F1F6FB" }}
      >
        {!centre && (
          <span className="font-body font-light text-[11px] text-ink-faint px-6 text-center">
            Start typing an address above and pick it from the list.
          </span>
        )}
      </div>
    );
  }

  const { tiles } = tileGrid(centre, ADDRESS_ZOOM, width, height);
  const pin = point ? pointToPixel(point, centre, ADDRESS_ZOOM, width, height) : null;

  return (
    <div>
      <div
        ref={boxRef}
        onClick={handleClick}
        className={`relative rounded-2xl overflow-hidden ${onPick ? "cursor-crosshair" : ""}`}
        style={{ height, border: "1px solid #E7EEF6", backgroundColor: "#F1F6FB" }}
      >
        {tiles.map((tile) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={tile.key}
            src={`${TILE_HOST}/${ADDRESS_ZOOM}/${tile.x}/${tile.y}.png`}
            alt=""
            aria-hidden="true"
            width={256}
            height={256}
            draggable={false}
            className="absolute max-w-none select-none"
            style={{ left: tile.left, top: tile.top }}
          />
        ))}

        {pin && (
          <div
            className="absolute pin-drop"
            style={{ left: pin.x, top: pin.y, transform: "translate(-50%,-100%)" }}
            aria-hidden="true"
          >
            <div
              className="pin-shape"
              style={{
                width: 34,
                height: 34,
                background: "linear-gradient(135deg, #3B9BE8, #16304E)",
              }}
            >
              <div className="pin-icon">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2"
                >
                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </div>
            </div>
          </div>
        )}

        {/* Required by the tile provider's licence, and it is their work. */}
        <span
          className="absolute bottom-0 right-0 px-1.5 py-0.5 font-body text-[8px] text-ink-faint"
          style={{ backgroundColor: "rgba(255,255,255,0.75)" }}
        >
          © OpenStreetMap
        </span>
      </div>

      {/*
        With no pin the map is still showing wherever it last was, which on its
        own looks like nothing happened. Saying why the pin went is the
        difference between an obvious next step and a Continue button that is
        greyed out for no visible reason.
      */}
      <p className="font-body font-light text-[11px] mt-2 text-ink-faint">
        {point
          ? onPick && "Pin in the wrong spot? Tap the map to move it."
          : "Address edited — pick it from the list again to place the pin."}
      </p>
    </div>
  );
}
