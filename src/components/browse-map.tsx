"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ADDRESS_ZOOM, type LatLng, pointToPixel, tileGrid } from "@/lib/geo";

/**
 * A real map of roughly where each room is.
 *
 * What this replaces was a drawing: painted roads, painted parks, and pins
 * placed by two decorative numbers carried over from the prototype. It looked
 * like a map, so anybody reading it believed they were being told where a room
 * was, and they were not.
 *
 * The reason it was a drawing is sound and has not changed — a listing's exact
 * position is private until it is booked. What changed is that the server now
 * publishes a point offset 250–450m in a direction fixed per listing, so there
 * is something real to draw that is not the address. Each room is a circle rather
 * than a pin, because a pin is a claim about a doorway and a circle is a claim
 * about an area, which is all we are entitled to make.
 *
 * Tiles as plain images, the same approach as the host's confirmation map. A
 * mapping library would add a few hundred kilobytes and a second rendering
 * model for a view that does not pan.
 */

const TILE_HOST = "https://tile.openstreetmap.org";

/** Wide enough to hold a few neighbourhoods, which is the scale this works at. */
const BROWSE_ZOOM = ADDRESS_ZOOM - 3;

export interface MapPin {
  id: string;
  name: string;
  point: LatLng;
  active: boolean;
}

export function BrowseMap({
  pins,
  you,
  onSelect,
}: {
  pins: MapPin[];
  /** Where the practitioner is, when they have shared it. */
  you: LatLng | null;
  onSelect: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = box.current;
    if (!element) return;

    const measure = () =>
      setSize({ width: element.clientWidth, height: element.clientHeight });

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** Centred on the practitioner when known, otherwise on the listings. */
  const centre = useMemo<LatLng | null>(() => {
    if (you) return you;
    if (pins.length === 0) return null;

    return {
      lat: pins.reduce((sum, p) => sum + p.point.lat, 0) / pins.length,
      lng: pins.reduce((sum, p) => sum + p.point.lng, 0) / pins.length,
    };
  }, [you, pins]);

  const layout = useMemo(() => {
    if (!centre || size.width === 0) return null;
    return tileGrid(centre, BROWSE_ZOOM, size.width, size.height);
  }, [centre, size]);

  /** Where a point lands in the box, using the same projection as the tiles. */
  const place = (point: LatLng) => {
    if (!layout || !centre) return null;
    const at = pointToPixel(point, centre, BROWSE_ZOOM, size.width, size.height);
    return { left: at.x, top: at.y };
  };

  return (
    /*
      Absolute, not flex-1.
      This sat inside a `relative` box rather than a flex column, so `flex-1`
      gave it no height at all: the tiles are positioned from a measured size,
      and a measured size of zero draws nothing. The old drawing survived that
      because an SVG with `inset-0` fills its parent whatever the parent's
      layout is, which is exactly why the bug did not exist until the map was
      real.
    */
    <div
      ref={box}
      className="absolute inset-0 overflow-hidden"
      style={{ backgroundColor: "#EAF1F7" }}
    >
      {layout?.tiles.map((tile) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={tile.key}
          src={`${TILE_HOST}/${BROWSE_ZOOM}/${tile.x}/${tile.y}.png`}
          alt=""
          aria-hidden="true"
          className="absolute select-none"
          style={{ left: tile.left, top: tile.top, width: 256, height: 256 }}
          draggable={false}
        />
      ))}

      {pins.map((pin) => {
        const at = place(pin.point);
        if (!at) return null;

        return (
          <button
            key={pin.id}
            type="button"
            onClick={() => onSelect(pin.id)}
            aria-label={pin.name}
            className="absolute rounded-full press"
            style={{
              /*
               * A circle, not a pin. Its size is the uncertainty: the room is
               * somewhere inside, and drawing a point would say we know which
               * doorway.
               */
              left: at.left - 34,
              top: at.top - 34,
              width: 68,
              height: 68,
              backgroundColor: pin.active ? "rgba(37,120,194,0.32)" : "rgba(37,120,194,0.18)",
              border: `2px solid ${pin.active ? "#2578C2" : "rgba(37,120,194,0.45)"}`,
            }}
          />
        );
      })}

      {you &&
        (() => {
          const at = place(you);
          if (!at) return null;
          return (
            <span
              className="absolute rounded-full"
              aria-hidden="true"
              style={{
                left: at.left - 7,
                top: at.top - 7,
                width: 14,
                height: 14,
                backgroundColor: "#2578C2",
                border: "2px solid #fff",
                boxShadow: "0 0 0 3px rgba(37,120,194,0.25)",
              }}
            />
          );
        })()}

      <p
        className="absolute left-3 bottom-3 px-2 py-1 rounded-md font-body text-[12px] text-ink-soft"
        style={{ backgroundColor: "rgba(255,255,255,0.9)" }}
      >
        Tap a studio to see it
      </p>

      <span
        className="absolute right-1 bottom-1 px-1.5 py-0.5 font-body text-[12px] text-ink-faint"
        style={{ backgroundColor: "rgba(255,255,255,0.75)" }}
      >
        © OpenStreetMap
      </span>
    </div>
  );
}
