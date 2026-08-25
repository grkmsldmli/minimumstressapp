// @vitest-environment jsdom

/**
 * The paw loader and the pull-to-refresh core.
 *
 * The gesture itself (touch drag at scrollTop 0) needs a real touch surface, so
 * what is pinned here is the decision logic behind it — drag resistance, the
 * threshold, and the "runs once / never stuck" guarantees — plus the loader's
 * rendered states and the single-scroll structure. The live drag is verified by
 * hand at 375×812 and reported with the implementation.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PawLoader } from "./paw-loader";
import {
  PTR_SLOP,
  PTR_THRESHOLD,
  PullToRefresh,
  createRefreshRunner,
  pullPhase,
  resolveGestureAxis,
  visiblePull,
} from "./pull-to-refresh";

afterEach(cleanup);

describe("PawLoader", () => {
  it("renders two hidden paws as a polite status with its label", () => {
    render(<PawLoader label="Updating…" />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByText("Updating…")).toBeDefined();
    const paws = status.querySelectorAll("svg");
    expect(paws).toHaveLength(2);
    paws.forEach((p) => expect(p.getAttribute("aria-hidden")).toBe("true"));
  });

  it("kneads when animating and stays static otherwise", () => {
    const { container: animated } = render(<PawLoader animate />);
    expect(animated.querySelectorAll(".paw-knead").length).toBeGreaterThan(0);
    cleanup();
    // The pulling phase (and the reduced-motion path) render static paws.
    const { container: still } = render(<PawLoader animate={false} />);
    expect(still.querySelectorAll(".paw-knead").length).toBe(0);
  });

  it("still announces something when given no label", () => {
    render(<PawLoader />);
    expect(screen.getByText("Loading")).toBeDefined();
  });
});

describe("pull-to-refresh math", () => {
  it("applies drag resistance and caps the visible pull", () => {
    expect(visiblePull(100, 0.5, 90)).toBe(50);
    expect(visiblePull(300, 0.5, 90)).toBe(90); // capped
    expect(visiblePull(-20)).toBe(0); // an upward drag is not a pull
    expect(visiblePull(0)).toBe(0);
  });

  it("reaches 'ready' only once the threshold is crossed", () => {
    expect(pullPhase(PTR_THRESHOLD - 1)).toBe("pulling");
    expect(pullPhase(PTR_THRESHOLD)).toBe("ready");
    expect(pullPhase(PTR_THRESHOLD + 25)).toBe("ready");
  });
});

describe("createRefreshRunner", () => {
  it("calls the screen's refresh callback once, then returns to idle", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const runner = createRefreshRunner(onRefresh);
    await runner.run();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(runner.running).toBe(false);
  });

  it("will not start a second refresh while one is in flight", async () => {
    let release!: () => void;
    const onRefresh = vi.fn(() => new Promise<void>((r) => (release = r)));
    const runner = createRefreshRunner(onRefresh);
    const first = runner.run();
    expect(runner.running).toBe(true);
    await runner.run(); // ignored — one is already running
    expect(onRefresh).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(runner.running).toBe(false);
  });

  it("never stays stuck after the refresh rejects", async () => {
    const onRefresh = vi.fn().mockRejectedValue(new Error("network"));
    const runner = createRefreshRunner(onRefresh);
    await expect(runner.run()).resolves.toBeUndefined(); // swallows the error
    expect(runner.running).toBe(false); // and releases
  });
});

/**
 * The direction rule that lets the pull and the horizontal listing rail share
 * one scroll container. The freeze it fixes: the pull's non-passive touchmove
 * cancelled the first move of a horizontal swipe, which cancels the rail's
 * native scroll for the whole gesture. So a horizontal drag must be recognised
 * and handed over — never claimed as a pull.
 */
describe("resolveGestureAxis", () => {
  it("says nothing until the finger passes the slop", () => {
    expect(resolveGestureAxis(0, 0)).toBeNull();
    expect(resolveGestureAxis(PTR_SLOP - 1, PTR_SLOP - 1)).toBeNull();
    // A tap or the first pixel of jitter must not lock a direction — and, while
    // null, the caller prevents nothing, so the rail can start scrolling.
    expect(resolveGestureAxis(3, 2)).toBeNull();
  });

  it("hands a horizontal drag to the carousel", () => {
    expect(resolveGestureAxis(40, 5)).toBe("horizontal");
    expect(resolveGestureAxis(-40, 5)).toBe("horizontal");
    // The exact bug: a horizontal swipe with a little downward drift used to be
    // treated as a downward pull and frozen. It is horizontal.
    expect(resolveGestureAxis(30, 12)).toBe("horizontal");
  });

  it("keeps a vertical drag for the pull", () => {
    expect(resolveGestureAxis(5, 40)).toBe("vertical");
    expect(resolveGestureAxis(-5, 40)).toBe("vertical");
    expect(resolveGestureAxis(12, 30)).toBe("vertical");
  });

  it("resolves the moment either axis crosses the slop", () => {
    expect(resolveGestureAxis(PTR_SLOP, 0)).toBe("horizontal");
    expect(resolveGestureAxis(0, PTR_SLOP)).toBe("vertical");
  });
});

describe("PullToRefresh", () => {
  it("is a single scroll container that contains its children and its overscroll", () => {
    const { container } = render(
      <PullToRefresh onRefresh={() => Promise.resolve()} className="flex-1">
        <div data-testid="content">rows</div>
      </PullToRefresh>,
    );
    const scrollers = container.querySelectorAll(".overflow-y-auto");
    expect(scrollers).toHaveLength(1); // one scroll container, no nesting
    expect(screen.getByTestId("content")).toBeDefined();
    expect((scrollers[0] as HTMLElement).style.overscrollBehaviorY).toBe("contain");
  });
});
