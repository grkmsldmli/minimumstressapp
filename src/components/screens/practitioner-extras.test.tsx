// @vitest-environment jsdom

/**
 * The insurance detail screen once printed the raw storage path — an owner id,
 * a document id, an extension — straight onto the file card. These pin that it
 * never does that again, and that a verified certificate shows its cover window
 * in words a person reads rather than a date a timezone can shift.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InsuranceUpload, ProScreen, proView } from "./practitioner-extras";

const CERT_PATH = "practitioner/11111111-1111-4111-8111-111111111111/9f2c.pdf";

afterEach(cleanup);

describe("InsuranceUpload — a file already on record", () => {
  it("never shows the raw storage path", () => {
    render(
      <InsuranceUpload
        onContinue={vi.fn().mockResolvedValue(undefined)}
        initialDocName={CERT_PATH}
        status="verified"
        effectiveDate={new Date("2026-05-02")}
        expiresAt={new Date("2027-05-02")}
      />,
    );

    expect(screen.queryByText(CERT_PATH)).toBeNull();
    // Not even the account-id folder, on its own, anywhere on screen.
    expect(document.body.textContent).not.toContain("11111111-1111-4111-8111-111111111111");
  });

  it("names the file by type, the way host documents are shown", () => {
    render(
      <InsuranceUpload
        onContinue={vi.fn().mockResolvedValue(undefined)}
        initialDocName={CERT_PATH}
        status="verified"
        effectiveDate={new Date("2026-05-02")}
        expiresAt={new Date("2027-05-02")}
      />,
    );

    expect(screen.getByText("Uploaded PDF")).toBeTruthy();
  });

  it("shows the verified cover window in readable dates", () => {
    render(
      <InsuranceUpload
        onContinue={vi.fn().mockResolvedValue(undefined)}
        initialDocName={CERT_PATH}
        status="verified"
        effectiveDate={new Date("2026-05-02")}
        expiresAt={new Date("2027-05-02")}
      />,
    );

    expect(screen.getByText("May 2, 2026")).toBeTruthy();
    expect(screen.getByText("May 2, 2027")).toBeTruthy();
  });

  it("does not show a cover window while the certificate is still in review", () => {
    render(
      <InsuranceUpload
        onContinue={vi.fn().mockResolvedValue(undefined)}
        initialDocName={CERT_PATH}
        status="pending_review"
        effectiveDate={null}
        expiresAt={null}
      />,
    );

    expect(screen.queryByText("Expires")).toBeNull();
    expect(screen.getByText("Uploaded PDF")).toBeTruthy();
  });
});

/**
 * The one rule the false-Pro bug broke: "You're Pro" is shown only when the
 * server says so, never because a checkout was opened or the app came back to
 * the foreground.
 */
describe("proView — what decides the Pro screen", () => {
  it("stays on the offer when Free with nothing in flight (a cancelled/closed checkout)", () => {
    expect(proView({ isPro: false })).toBe("offer");
    expect(proView({ isPro: false, confirming: false })).toBe("offer");
  });

  it("shows a client success flag alone can never grant Pro", () => {
    // celebrate is a stray client flag here; without server isPro it is ignored.
    expect(proView({ isPro: false, celebrate: true })).toBe("offer");
  });

  it("waits, without claiming Pro, while confirming a real return", () => {
    expect(proView({ isPro: false, confirming: true })).toBe("confirming");
    // Even mid-confirmation, a client celebrate flag cannot fabricate success.
    expect(proView({ isPro: false, confirming: true, celebrate: true })).toBe("confirming");
  });

  it("shows Pro when the server confirms it — with confetti only on a fresh upgrade", () => {
    expect(proView({ isPro: true })).toBe("active"); // existing Pro reopening
    expect(proView({ isPro: true, celebrate: false })).toBe("active");
    expect(proView({ isPro: true, celebrate: true })).toBe("celebrate"); // just upgraded
  });
});

describe("ProScreen — success is server-truth only", () => {
  const confetti = (c: HTMLElement) => c.querySelector("canvas");
  // "Pro." is in both the "Go Pro" offer and the "You're Pro" success headings,
  // so the success body — which appears only on the success screen — is the
  // reliable marker.
  const successShown = () => screen.queryByText(/No limit on how many sessions you hold/);

  it("shows the offer to a Free user, not success", () => {
    const { container } = render(
      <ProScreen isPro={false} onBack={vi.fn()} onSubscribe={vi.fn().mockResolvedValue(undefined)} />,
    );
    expect(screen.getByRole("button", { name: /Start Pro/ })).toBeTruthy();
    expect(successShown()).toBeNull();
    expect(confetti(container)).toBeNull();
  });

  it("opening checkout does NOT show success — even after onSubscribe resolves", async () => {
    const onSubscribe = vi.fn().mockResolvedValue(undefined);
    render(<ProScreen isPro={false} onBack={vi.fn()} onSubscribe={onSubscribe} />);

    fireEvent.click(screen.getByRole("button", { name: /Start Pro/ }));

    await waitFor(() => expect(onSubscribe).toHaveBeenCalledTimes(1));
    // The bug: checkout opening used to flip the screen to "You're Pro". It must not.
    expect(successShown()).toBeNull();
  });

  it("shows a failure, still not success, when the checkout cannot open", async () => {
    const onSubscribe = vi.fn().mockRejectedValue(new Error("network"));
    render(<ProScreen isPro={false} onBack={vi.fn()} onSubscribe={onSubscribe} />);

    fireEvent.click(screen.getByRole("button", { name: /Start Pro/ }));

    await screen.findByRole("alert");
    expect(successShown()).toBeNull();
  });

  it("shows Pro without confetti for an existing subscriber reopening the screen", () => {
    const { container } = render(
      <ProScreen isPro onBack={vi.fn()} onSubscribe={vi.fn()} celebrate={false} />,
    );
    expect(successShown()).not.toBeNull();
    expect(confetti(container)).toBeNull();
  });

  it("celebrates once, with confetti, on a fresh confirmed upgrade", () => {
    const { container } = render(<ProScreen isPro onBack={vi.fn()} onSubscribe={vi.fn()} celebrate />);
    expect(successShown()).not.toBeNull();
    expect(confetti(container)).not.toBeNull();
  });

  it("shows a neutral confirming state — no success, no error — while awaiting the webhook", () => {
    render(<ProScreen isPro={false} confirming onBack={vi.fn()} onSubscribe={vi.fn()} />);
    expect(screen.getByText(/Confirming your subscription/)).toBeTruthy();
    expect(successShown()).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /Start Pro/ })).toBeNull();
  });
});
