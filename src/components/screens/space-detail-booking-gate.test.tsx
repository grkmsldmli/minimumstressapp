// @vitest-environment jsdom

/**
 * The booking screen's one scroll, its compact action bar, and the gate.
 *
 * The purpose list, the attendee count and the cadence controls used to live in
 * an absolute bar pinned to the bottom. Once a slot was chosen that bar grew
 * taller than the screen: it pushed its own top (where the gate sits) off the
 * viewport and covered — and swallowed every scroll over — the content beneath.
 *
 * The fix is structural, not a nested scroll: those controls moved into the
 * page's own scroll, and the pinned bar holds only the action (the Book button,
 * and the insurance gate when a booking is refused for cover). These pin that
 * architecture down. jsdom has no layout, so the pixel coverage is verified by
 * hand and reported with the fix; what is asserted here is the structure that
 * makes one clean vertical scroll possible and keeps the bar compact.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { SpaceDetail } from "@/components/screens/space-detail";
import { MockRepository } from "@/lib/mock-repository";
import type { PublicSpace } from "@/lib/domain";

beforeAll(() => {
  window.scrollTo = vi.fn();
  if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => "blob:test");
});

afterEach(cleanup);

/** The seeded reformer studio, opened up to every use so a test can pick one. */
async function seeded(): Promise<PublicSpace> {
  const [first] = await new MockRepository().listPublicSpaces();
  return { ...first, allowedUses: [] };
}

/** A slot in the future, so the bar renders its full booking form. */
function futureSlot(): Date {
  return new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
}

const PENDING = "Your liability insurance is being reviewed. You can book once it is verified.";
const REQUIRED = "Active liability coverage is required before you can book a space for professional use.";

/**
 * The sticky action footer and the one scroll container, by their stable
 * classes. The footer is `sticky bottom-0`, which also tells it apart from the
 * gallery's own `absolute bottom-0` gradient overlay.
 */
function regions(container: HTMLElement) {
  return {
    bar: container.querySelector<HTMLElement>(".sticky.bottom-0"),
    scrollers: container.querySelectorAll<HTMLElement>(".overflow-y-auto"),
  };
}

describe("the booking screen's structure", () => {
  // 1 — the declaration controls are in the page scroll, not the pinned bar.
  it("keeps purpose/attendee controls in the page scroll, out of the CTA bar", async () => {
    const { container } = render(
      <SpaceDetail
        space={await seeded()}
        isPro={false}
        reviews={[]}
        onBack={vi.fn()}
        onGoPro={vi.fn()}
        onBook={vi.fn()}
        startAt={futureSlot()}
      />,
    );

    const { bar, scrollers } = regions(container);
    const declare = screen.getByText("What will you use the space for?");

    expect(bar).not.toBeNull();
    expect(scrollers).toHaveLength(1);
    // The declaration UI is inside the one scroller and NOT inside the CTA bar.
    expect(scrollers[0].contains(declare)).toBe(true);
    expect(bar!.contains(declare)).toBe(false);
  });

  // 3 — one primary scroll container, and the CTA is a sticky, in-flow footer
  //     inside it rather than an absolute overlay compensated with padding.
  it("keeps one scroll container with the CTA as a sticky, in-flow footer", async () => {
    const { container } = render(
      <SpaceDetail
        space={await seeded()}
        isPro={false}
        reviews={[]}
        onBack={vi.fn()}
        onGoPro={vi.fn()}
        onBook={vi.fn()}
        startAt={futureSlot()}
      />,
    );

    const { bar, scrollers } = regions(container);
    expect(scrollers).toHaveLength(1);
    // Sticky and in flow — not an absolute overlay.
    expect(bar!.className).toMatch(/sticky/);
    expect(bar!.className).not.toMatch(/absolute/);
    // It lives inside the one scroll container, and is not itself a scroller.
    expect(scrollers[0].contains(bar!)).toBe(true);
    expect(bar!.className).not.toMatch(/overflow-y-auto/);
    expect(bar!.style.maxHeight).toBe("");
  });

  // 4 — the CTA bar stays the compact action area (the Book button), so it
  //     cannot grow to cover the viewport the way the old one did.
  it("keeps the CTA bar to the action, not the whole booking form", async () => {
    const { container } = render(
      <SpaceDetail
        space={await seeded()}
        isPro={false}
        reviews={[]}
        onBack={vi.fn()}
        onGoPro={vi.fn()}
        onBook={vi.fn()}
        startAt={futureSlot()}
      />,
    );

    const { bar } = regions(container);
    // The Book action is in the bar…
    expect(bar!.querySelector("button")).not.toBeNull();
    expect(bar!.textContent).toMatch(/·\s*\$/);
    // …but the tall declaration UI is not.
    expect(bar!.textContent).not.toMatch(/What will you use the space for/);
  });
});

describe("the booking screen's insurance gate", () => {
  // 2 & 6 — pending cover: the gate is a visible answer in the bar, and showing
  //         it books nothing.
  it("shows the pending-insurance gate as a visible state, and books nothing", async () => {
    const onBook = vi.fn();
    const { container } = render(
      <SpaceDetail
        space={await seeded()}
        isPro={false}
        reviews={[]}
        onBack={vi.fn()}
        onGoPro={vi.fn()}
        onBook={onBook}
        insuranceGate={PENDING}
        onAddInsurance={vi.fn()}
      />,
    );

    const { bar } = regions(container);
    expect(screen.getByText("Liability insurance required")).toBeDefined();
    expect(screen.getByText(PENDING)).toBeDefined();
    expect(screen.getByRole("button", { name: /add insurance/i })).toBeDefined();
    // The gate lives in the compact bar, above the CTA.
    expect(bar!.textContent).toMatch(/being reviewed/i);
    // Showing the gate is not making a booking.
    expect(onBook).not.toHaveBeenCalled();
  });

  // 2 — insurance-required cover shows its own visible state.
  it("shows the insurance-required gate text", async () => {
    render(
      <SpaceDetail
        space={await seeded()}
        isPro={false}
        reviews={[]}
        onBack={vi.fn()}
        onGoPro={vi.fn()}
        onBook={vi.fn()}
        insuranceGate={REQUIRED}
        onAddInsurance={vi.fn()}
      />,
    );

    expect(screen.getByText(REQUIRED)).toBeDefined();
  });

  // 5 — cover in hand (no gate): pressing Book proceeds to the booking.
  it("continues to booking when there is no gate", async () => {
    const onBook = vi.fn();
    render(
      <SpaceDetail
        space={await seeded()}
        isPro={false}
        reviews={[]}
        onBack={vi.fn()}
        onGoPro={vi.fn()}
        onBook={onBook}
        startAt={futureSlot()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Consultation or coaching" }));
    fireEvent.click(screen.getByRole("button", { name: /^(Book|Request)\b/ }));

    expect(onBook).toHaveBeenCalledTimes(1);
    expect(onBook.mock.calls[0][0]).toBeInstanceOf(Date);
  });

  // D — a slow booking attempt must release the button, never leave it stuck.
  it("releases the Book button after the attempt settles", async () => {
    let finish!: () => void;
    const onBook = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(
      <SpaceDetail
        space={await seeded()}
        isPro={false}
        reviews={[]}
        onBack={vi.fn()}
        onGoPro={vi.fn()}
        onBook={onBook}
        startAt={futureSlot()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Consultation or coaching" }));
    fireEvent.click(screen.getByRole("button", { name: /^(Book|Request)\b/ }));

    expect(screen.getByText("One moment…")).toBeDefined();
    finish();
    await waitFor(() => expect(screen.queryByText("One moment…")).toBeNull());
    expect(screen.getByRole("button", { name: /^(Book|Request)\b/ })).toBeDefined();
  });
});
