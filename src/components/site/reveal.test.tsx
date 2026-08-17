// @vitest-environment jsdom

/**
 * The animation, and the three ways this kind of animation goes wrong.
 *
 * It could not be checked in the browser here — the preview pane is not
 * displayed, so the page composites no frames, and IntersectionObserver
 * delivery is tied to the rendering lifecycle. A freshly created observer on a
 * plainly visible element never fired. That is the harness, not the code, but
 * it means the real verification has to be here: the observer is driven by
 * hand, which tests the part that is ours rather than the part that is the
 * browser's.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Reveal } from "@/components/site/reveal";

/** Every observer made during a render, so a test can fire one. */
let observers: { callback: IntersectionObserverCallback; elements: Element[] }[] = [];

function stubObserver() {
  observers = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      elements: Element[] = [];
      constructor(public callback: IntersectionObserverCallback) {
        observers.push(this as never);
      }
      observe(element: Element) {
        this.elements.push(element);
      }
      disconnect() {}
    },
  );
}

/** Below the fold, so the component arms rather than leaving it alone. */
function farDown() {
  Element.prototype.getBoundingClientRect = vi.fn(
    () => ({ top: 5000, height: 200 }) as DOMRect,
  );
}

function intersect() {
  for (const observer of observers) {
    observer.callback(
      observer.elements.map((target) => ({ target, isIntersecting: true }) as never),
      null as never,
    );
  }
}

beforeEach(() => {
  stubObserver();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Reveal", () => {
  it("renders what it wraps", () => {
    render(<Reveal>Something worth reading</Reveal>);
    expect(screen.getByText("Something worth reading")).toBeDefined();
  });

  /**
   * The one that matters most.
   *
   * The usual implementation ships `opacity: 0` from the server and reveals it
   * on the client, which turns any JavaScript failure — a bad network, a
   * blocked bundle, a crawler that does not run scripts — into a blank page.
   * Here the starting state is written after mount, so the markup React
   * produces has nothing hidden in it.
   */
  it("hides nothing before its effect runs", () => {
    // Top of the viewport, which is also what jsdom returns by default: the
    // component leaves an element alone rather than flashing it out and back.
    const { container } = render(<Reveal>Visible</Reveal>);
    const wrapper = container.firstElementChild as HTMLElement;

    expect(wrapper.style.opacity).toBe("");
    expect(wrapper.getAttribute("style")).toBeNull();
  });

  it("arms an element below the fold, then shows it when it is reached", () => {
    farDown();
    const { container } = render(<Reveal>Down the page</Reveal>);
    const wrapper = container.firstElementChild as HTMLElement;

    expect(wrapper.style.opacity).toBe("0");
    expect(wrapper.style.transform).toBe("translateY(18px)");

    intersect();

    expect(wrapper.style.opacity).toBe("1");
    expect(wrapper.style.transform).toBe("none");
    expect(wrapper.style.transition).toContain("620ms");
  });

  /**
   * Reduced motion is not a preference about taste. Vestibular disorders make
   * animation genuinely unpleasant, so when it is asked for this does nothing
   * at all — it does not animate faster, and it certainly does not arm and
   * wait for a scroll that may never come.
   */
  it("does not touch anything when less motion was asked for", () => {
    farDown();
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({ matches: query.includes("reduce") })),
    );

    const { container } = render(<Reveal>Still</Reveal>);
    const wrapper = container.firstElementChild as HTMLElement;

    expect(wrapper.getAttribute("style")).toBeNull();
    expect(observers).toHaveLength(0);
  });

  /**
   * The failure this guards against was observed rather than imagined: a
   * freshly created observer on a plainly visible element never fired, because
   * the page was not compositing frames. Armed content and no callback is a
   * blank page nobody can scroll back into existence.
   */
  it("shows itself anyway if the observer never reports", () => {
    vi.useFakeTimers();
    farDown();

    const { container } = render(<Reveal>Never observed</Reveal>);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.opacity).toBe("0");

    // No intersect() — the observer stays silent, as it did in the browser.
    vi.advanceTimersByTime(2600);

    expect(wrapper.style.opacity).toBe("1");
    vi.useRealTimers();
  });

  it("staggers with the delay it is given", () => {
    farDown();
    const { container } = render(<Reveal delay={140}>Third card</Reveal>);
    intersect();

    expect((container.firstElementChild as HTMLElement).style.transition).toContain("140ms");
  });
});
