"use client";

import { useEffect, useRef } from "react";

/**
 * A section that arrives as you reach it.
 *
 * The page this was added to was static in the dull sense as well as the
 * technical one: nine sections of the same weight, nothing marking that you
 * had moved from one to the next. A short lift as each comes into view gives
 * the scroll a rhythm, and costs a reader nothing.
 *
 * Three things it must not do, and all three are the usual ways this is got
 * wrong.
 *
 * It must not hide content from anybody who does not run the animation. The
 * starting state is written to the element after mount rather than rendered
 * into the markup — so the server HTML, a crawler, and a reader whose
 * JavaScript failed all get the finished page with nothing faded out. The
 * common implementation ships `opacity: 0` from the server and reveals it on
 * the client, which turns a JavaScript error into a blank page.
 *
 * It must not move for somebody who asked things not to. `prefers-reduced-
 * motion` is not a preference about taste — vestibular disorders make
 * animation genuinely unpleasant — so when it is set this does nothing at all.
 *
 * And it must not go through React state. An animation is not application
 * state; putting it there means a render per section per scroll, and setting
 * it from inside an effect is the cascading-update pattern the lint rule in
 * this repo exists to refuse. This writes to the node it already has a ref to.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  /** Milliseconds, for staggering a row of cards. Keep it under ~200. */
  delay?: number;
  className?: string;
}) {
  const node = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = node.current;
    if (!element) return;

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    /*
     * Already on screen when the page loads — the first section or two. Arming
     * those would flash them out and back in, which is worse than leaving them
     * alone.
     */
    if (element.getBoundingClientRect().top < window.innerHeight * 0.9) return;

    element.style.opacity = "0";
    element.style.transform = "translateY(18px)";
    element.style.willChange = "opacity, transform";

    const show = () => {
      element.style.transition = `opacity 620ms ease ${delay}ms, transform 620ms cubic-bezier(.22,.61,.36,1) ${delay}ms`;
      element.style.opacity = "1";
      element.style.transform = "none";
      // Dropped once it has run: leaving it on promotes every section to its
      // own compositor layer for the rest of the session.
      window.setTimeout(() => {
        element.style.willChange = "";
      }, 620 + delay);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          show();
          observer.disconnect();
        }
      },
      // Fires a little before the edge, so the movement finishes about as the
      // section comes properly into view rather than starting then.
      { rootMargin: "0px 0px -12% 0px" },
    );

    observer.observe(element);

    /*
     * The safety net, and it is not hypothetical.
     *
     * IntersectionObserver delivery is tied to the rendering lifecycle, and
     * while checking this I watched a freshly created observer on a plainly
     * visible element never fire at all — the page was not compositing frames.
     * Whatever the cause in that instance, the failure mode is the worst one
     * available: content armed to invisible and a callback that never arrives,
     * which is a blank page nobody can scroll back into existence.
     *
     * So the arming has an expiry. If nothing has reported an intersection by
     * then, everything is shown regardless. It costs an animation somebody was
     * not going to see anyway — the element is off screen — and it means the
     * worst case is a page that did not animate rather than a page that is not
     * there.
     */
    const failsafe = window.setTimeout(() => {
      show();
      observer.disconnect();
    }, 2500);

    return () => {
      observer.disconnect();
      window.clearTimeout(failsafe);
    };
  }, [delay]);

  return (
    <div ref={node} className={className}>
      {children}
    </div>
  );
}
