"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The spaces, one at a time.
 *
 * A single photograph says "here is a room". Four of them moving says "there
 * are rooms of different kinds, and you might find yours" — which is the thing
 * the homepage has to get across before anybody scrolls. The label over each
 * is the same treatment a listing gets inside the app, so the two sides of the
 * product look like one company.
 *
 * It advances on its own, and it stops the moment somebody touches it. An
 * automatic carousel that keeps moving under a person's hand is the reason
 * carousels have the reputation they do: you reach for the thing you wanted
 * and it has already gone.
 */

export interface Slide {
  src: string;
  label: string;
  alt: string;
}

const INTERVAL_MS = 5000;

export function SpaceCarousel({ slides }: { slides: Slide[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [motionOk, setMotionOk] = useState(false);

  /*
   * Read after mount rather than during render. `matchMedia` does not exist on
   * the server, and a value read during the first client render disagrees with
   * the HTML that was already sent — so it starts still and begins moving once
   * we know the reader has not asked it not to.
   */
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setMotionOk(!query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const advance = useCallback(() => {
    setIndex((current) => (current + 1) % slides.length);
  }, [slides.length]);

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!motionOk || paused) return;
    timer.current = setInterval(advance, INTERVAL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [advance, motionOk, paused]);

  const goTo = (next: number) => {
    setIndex(next);
    // Somebody has chosen a slide. Taking it away from them a moment later is
    // the whole complaint about carousels.
    setPaused(true);
  };

  return (
    /*
      One frame, whatever shape the photograph is.
      
      The active slide used to sit in normal flow and set the height itself, so
      the box grew and shrank as the rotation passed between a 16:9 room and a
      4:3 one — the page jumping every six seconds. Every slide is absolute
      now and the container holds the ratio, so they all crop to the same
      window.
    */
    <div
      className="relative aspect-[4/3] overflow-hidden rounded-3xl sm:aspect-[3/2]"
      onMouseEnter={() => setPaused(true)}
      onFocus={() => setPaused(true)}
      role="group"
      aria-roledescription="carousel"
      aria-label="Spaces you can book"
    >
      {slides.map((slide, position) => (
        <div
          key={slide.src}
          className="absolute inset-0"
          style={{
            opacity: position === index ? 1 : 0,
            transition: "opacity 600ms ease",
            pointerEvents: position === index ? "auto" : "none",
          }}
          aria-hidden={position !== index}
        >
          <Image
            src={slide.src}
            alt={slide.alt}
            fill
            priority={position === 0}
            sizes="(min-width: 1024px) 58vw, 100vw"
            className="object-cover"
          />

          {/*
            A wash under the label rather than over the whole picture. The
            photographs are the point; darkening all of them to make eleven
            characters legible would be paying for the label with the thing it
            is labelling.
          */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3"
            style={{ background: "linear-gradient(to top, rgba(15,47,85,.55), transparent)" }}
          />

          <span
            className="absolute bottom-5 left-5 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-white backdrop-blur-sm"
            style={{ backgroundColor: "rgba(15,47,85,.55)" }}
          >
            {slide.label}
          </span>
        </div>
      ))}

      <div className="absolute bottom-5 right-5 flex gap-2">
        {slides.map((slide, position) => (
          <button
            key={slide.src}
            type="button"
            onClick={() => goTo(position)}
            aria-label={`Show ${slide.label}`}
            aria-current={position === index}
            className="h-2.5 w-2.5 rounded-full transition-colors"
            style={{
              backgroundColor:
                position === index ? "rgba(255,255,255,.95)" : "rgba(255,255,255,.45)",
            }}
          />
        ))}
      </div>
    </div>
  );
}
