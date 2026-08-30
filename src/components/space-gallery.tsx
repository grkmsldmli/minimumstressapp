"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CatIcon, categoryGradient } from "@/components/brand";
import type { SpaceMedia } from "@/lib/domain";
import type { CategoryKey } from "@/lib/taxonomy";

/**
 * The room, as a full-bleed gallery.
 *
 * Hosts were uploading photos of their space and the app was showing a
 * coloured gradient with an icon on it. Every listing looked identical, and
 * the one thing a practitioner actually wants before booking a room — what
 * does it look like — was collected, stored, and never put on screen.
 *
 * Scroll-snap rather than a JavaScript carousel: it is one CSS property, it
 * inherits the platform's own momentum and rubber-banding, and it keeps
 * working under a finger that moves faster than any listener. The dots follow
 * it rather than driving it, so they can never disagree with what is on
 * screen.
 */
export function SpaceGallery({
  media,
  category,
  height,
  children,
}: {
  media: SpaceMedia[];
  /** The fallback, when a listing has no photos yet. */
  category: CategoryKey;
  height: number;
  /** Overlaid on the media — the back button, the title, a badge. */
  children?: React.ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const [track, setTrack] = useState<HTMLDivElement | null>(null);
  const slides = useRef<(HTMLDivElement | null)[]>([]);

  const [from, to] = categoryGradient(category);

  /**
   * Which frame is on screen, asked of the browser rather than worked out
   * from a scroll offset.
   *
   * The first version listened for `scroll` and divided scrollLeft by the
   * width. It read correctly and still went wrong: scroll events are
   * coalesced under fast momentum and are not dispatched at all for some
   * programmatic scrolls, so the dots could sit on frame one while frame
   * three was in view — the one thing an indicator must never do.
   *
   * An observer answers the actual question. It fires when a slide crosses
   * the halfway mark, whatever moved it and however fast.
   *
   * The scroll handler stays alongside it, and the two are not redundant:
   * they are unavailable in different conditions. Both compute the same
   * number from the same geometry, so whichever arrives last agrees with
   * whichever arrived first.
   */
  const attach = useCallback((el: HTMLDivElement | null) => setTrack(el), []);

  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    // Rounded from the actual offset, so a half-swipe that springs back does
    // not leave the dots pointing at a frame nobody is looking at.
    setIndex(Math.round(el.scrollLeft / el.clientWidth));
  };

  useEffect(() => {
    if (!track || media.length < 2) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const at = slides.current.indexOf(entry.target as HTMLDivElement);
          if (at !== -1) setIndex(at);
        }
      },
      // Against the track, not the viewport: the gallery may be part-scrolled
      // off the top of the page and the dots should still be right.
      { root: track, threshold: 0.6 },
    );

    for (const slide of slides.current) if (slide) observer.observe(slide);
    return () => observer.disconnect();
  }, [track, media.length]);

  return (
    /*
     * Height is the passed number by default, but yields to `--hero-h` when an
     * ancestor sets it — which is how the detail screen collapses the hero as
     * the page scrolls, without this component knowing anything about scrolling.
     * Where no ancestor sets the variable, the fallback keeps every other caller
     * at exactly the height it asked for.
     */
    <div
      className="relative shrink-0 overflow-hidden"
      style={{ height: `var(--hero-h, ${height}px)` }}
    >
      {media.length === 0 ? (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: `radial-gradient(150% 130% at 20% 0%, ${from} 0%, ${to} 85%)` }}
        >
          <CatIcon cat={category} size={30} color="rgba(255,255,255,0.9)" />
        </div>
      ) : (
        <div
          ref={attach}
          onScroll={onScroll}
          className="flex h-full overflow-x-auto no-scrollbar"
          style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
        >
          {media.map((item, i) => (
            <div
              key={item.id}
              ref={(el) => {
                slides.current[i] = el;
              }}
              className="w-full h-full shrink-0 relative"
              style={{ scrollSnapAlign: "center", scrollSnapStop: "always" }}
            >
              {item.kind === "video" ? (
                <video
                  src={item.url}
                  className="w-full h-full object-cover"
                  muted
                  loop
                  playsInline
                  autoPlay
                  // A room tour is furniture and light, not a story. Never
                  // sound, never a control that competes with the back button.
                  preload="metadata"
                />
              ) : (
                /*
                 * A plain img, deliberately. These are Supabase storage URLs
                 * on a host next/image would have to be configured for, and
                 * the gallery is already full-bleed at one size — the loader
                 * round trip buys nothing here. `url` is the detail variant
                 * (0066); only the first frame is on screen at rest, so it loads
                 * eagerly and the rest defer until swiped to.
                 */
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.url}
                  alt=""
                  className="w-full h-full object-cover"
                  loading={i === 0 ? "eager" : "lazy"}
                  decoding="async"
                  fetchPriority={i === 0 ? "high" : "auto"}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/*
        Two scrims, top and bottom, not one flat overlay.
        A white back button over a photo of a white wall is invisible, and so
        is a title over a bright window. These darken only where something is
        written, so the middle of the picture is left alone.
      */}
      <div
        className="absolute inset-x-0 top-0 pointer-events-none"
        style={{
          height: 110,
          background: "linear-gradient(to bottom, rgba(10,26,44,0.45), transparent)",
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{
          height: 160,
          background: "linear-gradient(to top, rgba(10,26,44,0.72), transparent)",
        }}
      />

      {media.length > 1 && (
        <div className="absolute top-4 right-4 flex gap-1.5 pointer-events-none">
          {media.map((item, i) => (
            <span
              key={item.id}
              style={{
                width: i === index ? 16 : 5,
                height: 5,
                borderRadius: 99,
                backgroundColor: i === index ? "#fff" : "rgba(255,255,255,0.5)",
                transition: "width 200ms",
              }}
            />
          ))}
        </div>
      )}

      <div className="absolute inset-0 flex flex-col justify-between p-6 pointer-events-none">
        {/*
          The overlay itself ignores pointers so a swipe passes through to the
          gallery underneath; the controls inside it take them back. Without
          this the whole picture is a dead zone and nothing scrolls.
        */}
        <div className="contents [&_button]:pointer-events-auto [&_a]:pointer-events-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
