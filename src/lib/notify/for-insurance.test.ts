import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two promises this helper makes, checked without a provider or a database:
 * it keys the message on the certificate so one decision cannot send twice, and
 * it swallows every failure so an email can never undo a review that landed.
 */

// Hoisted so the (hoisted) module mocks can close over them.
const { notify, recipientFor } = vi.hoisted(() => ({
  notify: vi.fn(),
  recipientFor: vi.fn(),
}));

vi.mock("./send", () => ({ notify }));
vi.mock("./for-booking", () => ({ recipientFor }));

import { notifyInsuranceReviewed } from "./for-insurance";

const admin = {} as never;
const CERT = "practitioner/11111111-1111-4111-8111-111111111111/doc.pdf";

beforeEach(() => {
  notify.mockReset();
  recipientFor.mockReset();
  notify.mockResolvedValue({ email: "sent" });
});

describe("notifyInsuranceReviewed", () => {
  it("emails the verified template, keyed on the certificate and carrying the expiry", async () => {
    recipientFor.mockResolvedValue({ userId: "u1", email: "sam@example.com", name: "Sam" });

    await notifyInsuranceReviewed(admin, "u1", {
      outcome: "verified",
      certificate: CERT,
      expiresLabel: "May 2, 2027",
    });

    expect(notify).toHaveBeenCalledTimes(1);
    const request = notify.mock.calls[0][0];
    expect(request.kind).toBe("insurance_verified");
    // The dedupe subject is the certificate, so a retry collides and a genuinely
    // new upload (a different path) does not.
    expect(request.subjectId).toBe(CERT);
    expect(request.context.until).toBe("May 2, 2027");
    expect(request.recipient.email).toBe("sam@example.com");
  });

  it("emails the rejected template with the reviewer's note", async () => {
    recipientFor.mockResolvedValue({ userId: "u1", email: "sam@example.com" });

    await notifyInsuranceReviewed(admin, "u1", {
      outcome: "rejected",
      certificate: CERT,
      note: "The second page is cut off.",
    });

    const request = notify.mock.calls[0][0];
    expect(request.kind).toBe("insurance_rejected");
    expect(request.subjectId).toBe(CERT);
    expect(request.context.note).toBe("The second page is cut off.");
  });

  it("sends nothing when the practitioner has no address to reach", async () => {
    recipientFor.mockResolvedValue({ userId: "u1", email: null });

    await notifyInsuranceReviewed(admin, "u1", {
      outcome: "verified",
      certificate: CERT,
      expiresLabel: null,
    });

    expect(notify).not.toHaveBeenCalled();
  });

  it("never throws when the provider fails — a decision must not ride on an email", async () => {
    recipientFor.mockResolvedValue({ userId: "u1", email: "sam@example.com" });
    notify.mockRejectedValue(new Error("resend is down"));

    await expect(
      notifyInsuranceReviewed(admin, "u1", {
        outcome: "verified",
        certificate: CERT,
        expiresLabel: null,
      }),
    ).resolves.toBeUndefined();
  });

  it("never throws when the recipient lookup itself fails", async () => {
    recipientFor.mockRejectedValue(new Error("auth admin unreachable"));

    await expect(
      notifyInsuranceReviewed(admin, "u1", {
        outcome: "rejected",
        certificate: CERT,
        note: "Certificate is unreadable.",
      }),
    ).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });
});
