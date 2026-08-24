// @vitest-environment jsdom

/**
 * The insurance detail screen once printed the raw storage path — an owner id,
 * a document id, an extension — straight onto the file card. These pin that it
 * never does that again, and that a verified certificate shows its cover window
 * in words a person reads rather than a date a timezone can shift.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InsuranceUpload } from "./practitioner-extras";

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
