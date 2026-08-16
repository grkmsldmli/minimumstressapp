"use client";

import { useCallback, useRef } from "react";

/**
 * Bring a result into view the first time it appears, and only then.
 *
 * Every one of these pages is longer than a screen — fifteen questions is
 * about seven thousand pixels on a phone — so answering the last question
 * opens a panel far below the fold and nothing moves. The last option is under
 * your thumb and the answer is thousands of pixels down, with no sign it
 * arrived.
 *
 * The scroll hangs off the ref rather than off a `requestAnimationFrame` at
 * the call site. The panel is created in the same commit as the call, so at
 * that moment it is not in the document and has no position — one frame later
 * it usually is, and "usually" is how this fails on a slow phone. Waiting for
 * React to hand back the node is not a guess about timing.
 *
 * The jump is immediate rather than smooth, which is a choice and not a
 * shortcut. Seven thousand pixels of smooth scrolling takes several seconds
 * and reads as the page having got stuck; the animation is also the first
 * thing dropped when a tab is backgrounded or a device is struggling, and a
 * scroll that quietly does not happen leaves somebody staring at the question
 * they just answered wondering whether it worked.
 *
 * Only the first time, because these results keep tracking as answers change.
 * Scrolling on every tap would yank the page away from whichever question
 * somebody went back to reconsider.
 */
export function useRevealOnce(): {
  ref: (node: HTMLElement | null) => void;
  reveal: () => void;
  reset: () => void;
} {
  const pending = useRef(false);
  const shown = useRef(false);

  const ref = useCallback((node: HTMLElement | null) => {
    if (!node || !pending.current) return;
    pending.current = false;
    node.scrollIntoView({ behavior: "auto", block: "start" });
  }, []);

  const reveal = useCallback(() => {
    if (shown.current) return;
    shown.current = true;
    pending.current = true;
  }, []);

  const reset = useCallback(() => {
    shown.current = false;
    pending.current = false;
  }, []);

  return { ref, reveal, reset };
}
