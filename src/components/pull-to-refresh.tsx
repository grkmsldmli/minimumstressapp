"use client";

import { useEffect, useRef, useState } from "react";

import { PawLoader } from "./paw-loader";

/**
 * Pull-to-refresh for the app's single per-screen scroll container.
 *
 * It does NOT reload the page — it calls the screen's own refresh callback,
 * which re-fetches that screen's data in place. The gesture only arms when the
 * container is already at the top, it owns the drag by preventing the native
 * scroll only while pulling down from there, and it never nests a second scroll
 * container: the indicator is a spacer at the very top of the same scroller.
 *
 * The decision pieces (`visiblePull`, `pullPhase`, `createRefreshRunner`) are
 * pure and exported so the resistance, threshold, and the "no duplicate / never
 * stuck" guarantees can be tested without a touch harness.
 */

export const PTR_THRESHOLD = 70;
export const PTR_MAX_PULL = 90;
export const PTR_RESISTANCE = 0.5;

export type PtrPhase = "idle" | "pulling" | "ready" | "refreshing" | "complete";

/** Drag resistance plus a hard cap, so a long drag never runs away. */
export function visiblePull(rawDy: number, resistance = PTR_RESISTANCE, max = PTR_MAX_PULL): number {
  if (rawDy <= 0) return 0;
  return Math.min(max, rawDy * resistance);
}

/** Whether the current pull has reached the release threshold. */
export function pullPhase(pull: number, threshold = PTR_THRESHOLD): "pulling" | "ready" {
  return pull >= threshold ? "ready" : "pulling";
}

/**
 * Guards a refresh: it runs at most one at a time (a second call while one is in
 * flight is ignored), and it can never get stuck — a rejected refresh is
 * swallowed and the runner returns to idle in a `finally`.
 */
export function createRefreshRunner(onRefresh: () => Promise<unknown> | unknown) {
  let running = false;
  return {
    get running() {
      return running;
    },
    async run(): Promise<void> {
      if (running) return;
      running = true;
      try {
        await onRefresh();
      } catch {
        // Swallowed on purpose: a failed refresh must still release the loader.
      } finally {
        running = false;
      }
    },
  };
}

/**
 * Wires the pull gesture to a scroll element. Returns the live pull distance and
 * phase for rendering the indicator.
 */
export function usePullToRefresh(
  scrollRef: React.RefObject<HTMLElement | null>,
  onRefresh: () => Promise<unknown> | unknown,
) {
  const [pull, setPull] = useState(0);
  const [phase, setPhase] = useState<PtrPhase>("idle");

  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const runner = createRefreshRunner(() => onRefreshRef.current());
    let startY: number | null = null;
    let pullNow = 0;
    let active = false;

    const set = (p: number) => {
      pullNow = p;
      setPull(p);
    };

    const onStart = (e: TouchEvent) => {
      if (runner.running || e.touches.length !== 1) {
        active = false;
        return;
      }
      if (el.scrollTop <= 0) {
        startY = e.touches[0].clientY;
        active = true;
      } else {
        startY = null;
        active = false;
      }
    };

    const onMove = (e: TouchEvent) => {
      if (!active || runner.running || startY === null) return;
      // The finger reached the top then pushed content up: stand down.
      if (el.scrollTop > 0) {
        active = false;
        set(0);
        setPhase("idle");
        return;
      }
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) {
        if (pullNow !== 0) {
          set(0);
          setPhase("idle");
        }
        return;
      }
      // We own the gesture now — stop native scroll and overscroll refresh.
      e.preventDefault();
      const v = visiblePull(dy);
      set(v);
      setPhase(pullPhase(v));
    };

    const finish = () => {
      if (!active) return;
      active = false;
      startY = null;
      if (pullNow >= PTR_THRESHOLD) {
        setPhase("refreshing");
        set(PTR_THRESHOLD);
        void runner.run().then(() => {
          setPhase("complete");
          set(0);
          window.setTimeout(() => setPhase("idle"), 320);
        });
      } else {
        set(0);
        setPhase("idle");
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", finish, { passive: true });
    el.addEventListener("touchcancel", finish, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", finish);
      el.removeEventListener("touchcancel", finish);
    };
  }, [scrollRef]);

  return { pull, phase };
}

/**
 * The one scroll container for a screen, with pull-to-refresh built in. Pass the
 * screen's own refresh callback as `onRefresh`; everything else stays exactly as
 * a plain `overflow-y-auto` div — no nested scrolling, sticky footers inside it
 * keep working.
 */
export function PullToRefresh({
  onRefresh,
  className = "",
  children,
  style,
}: {
  onRefresh: () => Promise<unknown> | unknown;
  className?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { pull, phase } = usePullToRefresh(scrollRef, onRefresh);

  const refreshing = phase === "refreshing";
  const dragging = phase === "pulling" || phase === "ready";
  const height = refreshing ? PTR_THRESHOLD : pull;

  return (
    <div
      ref={scrollRef}
      className={`overflow-y-auto ${className}`}
      style={{ overscrollBehaviorY: "contain", ...style }}
    >
      <div
        className="flex items-center justify-center overflow-hidden"
        style={{
          height,
          transition: dragging ? "none" : "height 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        aria-hidden={height === 0}
      >
        <div style={{ opacity: refreshing ? 1 : Math.min(1, pull / 55) }}>
          {refreshing ? (
            <PawLoader size={13} label="Updating…" />
          ) : (
            <PawLoader
              size={13}
              animate={false}
              label={phase === "ready" ? "Release to refresh" : "Pull to refresh"}
            />
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
