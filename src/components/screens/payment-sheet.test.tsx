// @vitest-environment jsdom

/**
 * The booking paw loader lives on the one real wait in the flow: confirming the
 * payment. These pin that it shows only while that confirm is in flight, clears
 * on success and on failure (never stuck), and does not change what the confirm
 * does — same call, same success/error handling.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Defined via hoisted so the (hoisted) module mock can close over it.
const { confirmPayment } = vi.hoisted(() => ({ confirmPayment: vi.fn() }));

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => ({ confirmPayment }),
  useElements: () => ({}),
}));

vi.mock("@/lib/stripe/browser", () => ({
  stripeBrowser: () => null,
  STRIPE_APPEARANCE: {},
}));

import { PaymentSheet } from "./payment-sheet";

const money = {
  hostRateCents: 5000,
  serviceFeeCents: 400,
  instantFeeCents: 0,
  proDiscountCents: 0,
  totalCents: 5400,
  platformCents: 400,
};

function show(onPaid = vi.fn()) {
  render(
    <PaymentSheet
      clientSecret="cs_test"
      money={money}
      spaceName="Willow"
      startsAt={new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)}
      timeZone="America/Los_Angeles"
      onBack={vi.fn()}
      onPaid={onPaid}
    />,
  );
  return { onPaid };
}

afterEach(() => {
  cleanup();
  confirmPayment.mockReset();
});

describe("PaymentSheet — booking paw loader", () => {
  it("shows the Pay button and no loader at rest", () => {
    show();
    expect(screen.getByRole("button", { name: /^Pay / })).toBeDefined();
    expect(screen.queryByText("Processing your booking…")).toBeNull();
  });

  it("shows the loader only while processing, and clears it on success", async () => {
    let resolve!: (v: unknown) => void;
    confirmPayment.mockReturnValue(new Promise((r) => (resolve = r)));
    const { onPaid } = show();

    fireEvent.click(screen.getByRole("button", { name: /^Pay / }));
    // In flight: loader up, button gone.
    expect(screen.getByText("Processing your booking…")).toBeDefined();
    expect(screen.queryByRole("button", { name: /^Pay / })).toBeNull();

    resolve({}); // no error → success
    await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(1));
  });

  it("clears the loader and restores the button on failure — never stuck", async () => {
    confirmPayment.mockResolvedValue({ error: { message: "Card declined." } });
    const { onPaid } = show();

    fireEvent.click(screen.getByRole("button", { name: /^Pay / }));
    await waitFor(() => expect(screen.getByText("Card declined.")).toBeDefined());

    expect(screen.queryByText("Processing your booking…")).toBeNull();
    expect(screen.getByRole("button", { name: /^Pay / })).toBeDefined();
    expect(onPaid).not.toHaveBeenCalled();
  });

  it("still runs the same confirm (booking behaviour unchanged)", async () => {
    confirmPayment.mockResolvedValue({});
    show();
    fireEvent.click(screen.getByRole("button", { name: /^Pay / }));
    await waitFor(() => expect(confirmPayment).toHaveBeenCalledTimes(1));
    expect(confirmPayment.mock.calls[0][0]).toMatchObject({ redirect: "if_required" });
  });
});
