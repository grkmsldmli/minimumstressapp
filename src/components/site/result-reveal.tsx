"use client";

import { useEffect, useState } from "react";

/**
 * A beat between the last answer and the result.
 *
 * Without one the panel simply appears under the question somebody has just
 * tapped, and it reads as though nothing happened — the eye has no reason to
 * move, and the score arrives with no more ceremony than a fourth option.
 *
 * The pause is short and it is not theatre. A minute of a spinning circle
 * pretending to think is the trick a hundred quiz sites use to make a lookup
 * table feel like analysis, and it is a lie about what the page is doing. This
 * is long enough to mark the change of state and no longer.
 *
 * Nothing happens at all for a reader who has asked for reduced motion. They
 * get the result on the same frame, which is what that setting is for.
 */

const THINKING_MS = 900;

export function ResultReveal({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  /*
   * One effect and one timer, rather than reading the media query into state
   * and reacting to it. Two effects means the first one sets state
   * synchronously and the second runs off it — a cascading render for a value
   * that never changes after mount, and it is what the linter is objecting to.
   *
   * A zero-length timeout for a reader who has asked for reduced motion, which
   * still fires on the next tick rather than during the effect body. They see
   * the result immediately; the pulse never paints.
   */
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => setReady(true), reduced ? 0 : THINKING_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!ready) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-2xl py-16"
        style={{ border: "1px solid #e7eef6" }}
        role="status"
        aria-live="polite"
      >
        <div className="flex gap-2">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="h-2.5 w-2.5 rounded-full"
              style={{
                backgroundColor: "#0EA5E9",
                animation: `reveal-pulse 1.1s ${dot * 0.14}s ease-in-out infinite`,
              }}
            />
          ))}
        </div>
        <p className="mt-5 text-[15px]" style={{ color: "#5f6673" }}>
          Working out your result…
        </p>
      </div>
    );
  }

  return <div className="reveal-in">{children}</div>;
}

/**
 * A number that counts up to where it lands.
 *
 * The score is the one thing on the page somebody is waiting for, and a digit
 * that arrives already finished gives the eye nothing to follow. Eased out, so
 * it slows into the answer rather than stopping dead on it.
 */
export function CountUp({
  to,
  className,
  style,
}: {
  to: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  /*
   * Starts at the final number rather than at zero, so the server renders the
   * answer and a reader with JavaScript off or reduced motion on sees it. The
   * animation, when it runs, drops to zero on its first frame — inside a
   * requestAnimationFrame callback, not synchronously in the effect.
   */
  const [value, setValue] = useState(to);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let started: number | null = null;
    const duration = 700;

    const tick = (now: number) => {
      if (started === null) started = now;
      const progress = Math.min((now - started) / duration, 1);
      // Cubic ease-out: quick at first, settling into the final number.
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(to * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to]);

  return (
    <span className={className} style={style}>
      {value}
    </span>
  );
}
