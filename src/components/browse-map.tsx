"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crosshair } from "lucide-react";

import { CatIcon } from "@/components/brand";
import { TILE_ATTRIBUTION, tileUrl } from "@/lib/map-tiles";
import type { CategoryKey } from "@/lib/taxonomy";
import {
  ADDRESS_ZOOM,
  type LatLng,
  TILE_SIZE,
  latToTileY,
  lngToTileX,
  pixelToPoint,
  pointToPixel,
  tileXToLng,
  tileYToLat,
  tileGrid,
} from "@/lib/geo";

/**
 * A real map of where each room is, and one somebody can move around in.
 *
 * What this replaces was a drawing: painted roads, painted parks, and pins
 * placed by two decorative numbers carried over from the prototype. It looked
 * like a map, so anybody reading it believed they were being told where a room
 * was, and they were not.
 *
 * It was then a real map that could not be moved — one fixed frame around
 * whatever was listed. That reads as a picture of a map rather than a map: a
 * practitioner deciding where to work wants to look at the next neighbourhood
 * over, and there was no way to ask. Dragging pans it, two fingers or the
 * wheel zoom it, and the button returns to where it started.
 *
 * Still tiles as plain images rather than a mapping library. The library would
 * bring a few hundred kilobytes and a second rendering model; what it would do
 * for us is the projection in geo.ts, which is a dozen tested lines, plus the
 * gesture handling below.
 */

/** Wide enough to hold a few neighbourhoods, which is the scale this opens at. */
const BROWSE_ZOOM = ADDRESS_ZOOM - 3;

/**
 * How far out and in somebody may go.
 *
 * Out stops at the point where a city is a smudge and there is nothing left to
 * decide from; in stops one short of the address map's zoom, because this view
 * is about which neighbourhood, and the room's own page is where the door is.
 */
const MIN_ZOOM = 9;
const MAX_ZOOM = ADDRESS_ZOOM;

/**
 * Where the map opens when there is nothing to anchor it to — no listings yet
 * and no shared location. The middle of the service area (San Mateo, on the
 * peninsula), so a first-time or empty view shows the region the app covers
 * rather than a blank square.
 */
const FALLBACK_CENTRE: LatLng = { lat: 37.563, lng: -122.3255 };

/** Past this, a press was a drag and must not also count as a tap on a pin. */
const DRAG_SLOP = 6;

/** The centre that puts `anchor` back under `pixel`, at the given zoom. */
function centreAnchoring(
  anchor: LatLng,
  pixel: { x: number; y: number },
  zoom: number,
  width: number,
  height: number,
): LatLng {
  const tileX = lngToTileX(anchor.lng, zoom) - (pixel.x - width / 2) / TILE_SIZE;
  const tileY = latToTileY(anchor.lat, zoom) - (pixel.y - height / 2) / TILE_SIZE;
  return { lat: tileYToLat(tileY, zoom), lng: tileXToLng(tileX, zoom) };
}

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export interface MapPin {
  id: string;
  name: string;
  point: LatLng;
  /** Drawn inside the pin, so a glance tells movement from meditation. */
  category: CategoryKey;
  active: boolean;
}

interface View {
  centre: LatLng;
  zoom: number;
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

  /** Where the map opens: the practitioner when known, otherwise the listings. */
  const home = useMemo<LatLng | null>(() => {
    if (you) return you;
    // No listings and no shared location: fall back to the service area so the
    // map shows the region rather than an empty square.
    if (pins.length === 0) return FALLBACK_CENTRE;

    return {
      lat: pins.reduce((sum, p) => sum + p.point.lat, 0) / pins.length,
      lng: pins.reduce((sum, p) => sum + p.point.lng, 0) / pins.length,
    };
  }, [you, pins]);

  /**
   * Null until somebody moves the map, and theirs from then on.
   *
   * Derived rather than seeded into state on mount, which keeps both halves
   * true at once: before it is touched the frame follows the listings, so
   * changing a category brings the map with it; after it is touched the view
   * belongs to the person holding it, and a filter no longer hauls them back
   * from wherever they went looking.
   */
  const [chosen, setChosen] = useState<View | null>(null);
  // Memoised because the tile grid keys off it, and a fresh object each render
  // would rebuild the grid — and refetch every tile — for no change at all.
  const view = useMemo<View | null>(
    () => chosen ?? (home ? { centre: home, zoom: BROWSE_ZOOM } : null),
    [chosen, home],
  );

  /** The current view even mid-gesture, where `chosen` may not have caught up. */
  const settle = (current: View | null): View | null =>
    current ?? (home ? { centre: home, zoom: BROWSE_ZOOM } : null);

  /**
   * Tiles exist at whole zooms only; a pinch does not.
   *
   * `/13.4/1310/3166.png` is a 404, so the grid is fetched at the nearest
   * whole level and the fraction is applied as a scale about the box centre —
   * which is the point the grid was built around, so the two stay registered.
   * Pins are placed from the fractional zoom directly and need no such help,
   * because pointToPixel is arithmetic rather than a picture.
   */
  const tileZoom = view ? Math.round(view.zoom) : BROWSE_ZOOM;
  const tileScale = view ? 2 ** (view.zoom - tileZoom) : 1;

  const layout = useMemo(() => {
    if (!view || size.width === 0) return null;
    return tileGrid(view.centre, tileZoom, size.width, size.height);
  }, [view, tileZoom, size]);

  /* ---------------- gestures ---------------- */

  /** Live pointers, by id. One is a drag, two are a pinch. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  /** How far this press has travelled, so a drag does not also tap a pin. */
  const travelled = useRef(0);
  const pinchStart = useRef<{ distance: number; view: View } | null>(null);

  const localPoint = (event: React.PointerEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const twoPointers = () => {
    const [a, b] = [...pointers.current.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    return { a, b, distance, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!view) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, localPoint(event));
    travelled.current = 0;

    if (pointers.current.size === 2) {
      const { distance } = twoPointers();
      pinchStart.current = { distance, view };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!view || !pointers.current.has(event.pointerId) || size.width === 0) return;

    const previous = pointers.current.get(event.pointerId)!;
    const next = localPoint(event);
    pointers.current.set(event.pointerId, next);
    travelled.current += Math.hypot(next.x - previous.x, next.y - previous.y);

    // Two fingers: zoom about the point between them, which is the one the
    // hand is holding still.
    if (pointers.current.size === 2 && pinchStart.current) {
      const { distance, mid } = twoPointers();
      const start = pinchStart.current;
      if (start.distance < 1) return;

      const zoom = clampZoom(start.view.zoom + Math.log2(distance / start.distance));
      const anchor = pixelToPoint(mid, start.view.centre, start.view.zoom, size.width, size.height);
      setChosen({ zoom, centre: centreAnchoring(anchor, mid, zoom, size.width, size.height) });
      return;
    }

    if (pointers.current.size !== 1) return;

    /*
     * One finger: the ground follows it, so the centre moves the other way.
     *
     * Read from the updater rather than the closed-over view, because several
     * pointermove events land between renders and the third would otherwise
     * be computed from where the map was two frames ago.
     */
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    setChosen((current) => {
      const base = settle(current);
      if (!base) return current;
      return {
        ...base,
        centre: pixelToPoint(
          { x: size.width / 2 - dx, y: size.height / 2 - dy },
          base.centre,
          base.zoom,
          size.width,
          size.height,
        ),
      };
    });
  };

  const endPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
  };

  /**
   * The wheel, for the desktop preview where there is no second finger.
   *
   * Non-passive because it has to preventDefault — otherwise the page scrolls
   * behind the map — and React's onWheel is registered passive, so this is
   * attached by hand.
   */
  const onWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      const element = box.current;
      if (!element) return;

      setChosen((current) => {
        const base = current ?? (home ? { centre: home, zoom: BROWSE_ZOOM } : null);
        if (!base) return current;

        const rect = element.getBoundingClientRect();
        const width = element.clientWidth;
        const height = element.clientHeight;
        if (width === 0) return current;

        const at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        const zoom = clampZoom(base.zoom - Math.sign(event.deltaY));
        if (zoom === base.zoom) return base;

        const anchor = pixelToPoint(at, base.centre, base.zoom, width, height);
        return { zoom, centre: centreAnchoring(anchor, at, zoom, width, height) };
      });
    },
    [home],
  );

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  /** Where a point lands in the box, using the same projection as the tiles. */
  const place = (point: LatLng) => {
    if (!layout || !view) return null;
    const at = pointToPixel(point, view.centre, view.zoom, size.width, size.height);
    return { left: at.x, top: at.y };
  };

  /** True once the view has been moved off the frame it opened at. */
  const strayed =
    view !== null &&
    home !== null &&
    (view.zoom !== BROWSE_ZOOM ||
      Math.abs(view.centre.lat - home.lat) > 1e-6 ||
      Math.abs(view.centre.lng - home.lng) > 1e-6);

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
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      className="absolute inset-0 overflow-hidden"
      style={{
        backgroundColor: "#EAF1F7",
        // Without this the browser claims the gesture first: a drag scrolls
        // the screen behind the map and a pinch zooms the whole page.
        touchAction: "none",
        cursor: "grab",
      }}
    >
      <div
        className="absolute inset-0"
        style={{ transform: `scale(${tileScale})`, transformOrigin: "50% 50%" }}
      >
        {layout?.tiles.map((tile) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={tile.key}
            src={tileUrl(layout.zoom, tile.x, tile.y)}
            alt=""
            aria-hidden="true"
            className="absolute select-none"
            style={{ left: tile.left, top: tile.top, width: 256, height: 256 }}
            draggable={false}
          />
        ))}
      </div>

      {pins.map((pin) => {
        const at = place(pin.point);
        if (!at) return null;

        const size = pin.active ? 38 : 30;

        return (
          /*
           * A pin, pointing at the door.
           *
           * This was a translucent circle 68px across, and the reason was
           * sound while it was true: the coordinates were deliberately fuzzed
           * 250-450m, so a point would have claimed a precision we did not
           * have. 0032 publishes the real address — the studios here are
           * retail premises whose address is on their own website — and once
           * the position is exact, a circle covering a city block is the
           * misleading shape. It reads as "somewhere around here" about a
           * building we could name.
           *
           * Same pin as the host sees confirming their own address, so the
           * two maps in this app agree about what a room looks like.
           */
          <button
            key={pin.id}
            type="button"
            onClick={() => {
              // A drag that happens to finish over a pin is still a drag.
              if (travelled.current > DRAG_SLOP) return;
              onSelect(pin.id);
            }}
            aria-label={pin.name}
            aria-pressed={pin.active}
            className="absolute pin-drop press"
            style={{ left: at.left, top: at.top, transform: "translate(-50%,-100%)" }}
          >
            <span
              className="pin-shape"
              style={{
                width: size,
                height: size,
                background: pin.active
                  ? "linear-gradient(135deg, #3B9BE8, #16304E)"
                  : "linear-gradient(135deg, #6FB3EA, #2A4F79)",
              }}
            >
              <span className="pin-icon flex">
                <CatIcon cat={pin.category} size={pin.active ? 15 : 12} color="#fff" />
              </span>
            </span>
          </button>
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

      {/*
        The way back. A map that can be moved is a map somebody can get lost
        in, and the listings they were looking at have no other route home.
      */}
      {strayed && home && (
        <button
          type="button"
          onClick={() => setChosen(null)}
          aria-label="Back to the listings"
          className="absolute right-3 top-3 w-9 h-9 rounded-full flex items-center justify-center press"
          style={{
            backgroundColor: "rgba(255,255,255,0.95)",
            border: "1px solid #DCE7F2",
            boxShadow: "0 4px 12px rgba(22,48,78,0.14)",
          }}
        >
          <Crosshair size={16} color="#2578C2" />
        </button>
      )}

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
        {TILE_ATTRIBUTION}
      </span>
    </div>
  );
}
