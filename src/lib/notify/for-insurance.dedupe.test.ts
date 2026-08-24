import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The dedupe that keeps one decision from emailing twice, proven through the
 * real notification-history mechanism rather than a mock of it.
 *
 * The key send.ts writes is `${kind}:${subjectId}:${channel}`, and this helper
 * passes the certificate path as the subject — so the effective key is
 * `insurance_verified:{path}:email` / `insurance_rejected:{path}:email`. A retry
 * of the same decision collides on it; a different decision on the same
 * certificate is a different key and is allowed its own message.
 *
 * The stand-in below is the one thing that matters about the notifications
 * table: the unique index on dedupe_key, which turns a second claim of a key
 * into the 23505 that send.ts reads as "already sent".
 */

const { recipientFor, sendEmail, claimed, fakeAdmin } = vi.hoisted(() => {
  const claimed = new Set<string>();
  const fakeAdmin = {
    from: (table: string) => ({
      insert: (row: { dedupe_key: string }) => {
        if (table !== "notifications") return Promise.resolve({ error: null });
        if (claimed.has(row.dedupe_key)) return Promise.resolve({ error: { code: "23505" } });
        claimed.add(row.dedupe_key);
        return Promise.resolve({ error: null });
      },
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  };
  return { recipientFor: vi.fn(), sendEmail: vi.fn(), claimed, fakeAdmin };
});

vi.mock("../supabase/server", () => ({ supabaseAdmin: () => fakeAdmin }));
vi.mock("./transports", () => ({
  emailConfigured: () => true,
  smsConfigured: () => false,
  sendEmail: (...args: unknown[]) => sendEmail(...args),
  sendSms: vi.fn(),
}));
vi.mock("./for-booking", () => ({ recipientFor }));

import { notifyInsuranceReviewed } from "./for-insurance";

const admin = {} as never;
const CERT = "practitioner/11111111-1111-4111-8111-111111111111/doc.pdf";

const verify = () =>
  notifyInsuranceReviewed(admin, "u1", {
    outcome: "verified",
    certificate: CERT,
    expiresLabel: "May 2, 2027",
  });

const reject = () =>
  notifyInsuranceReviewed(admin, "u1", {
    outcome: "rejected",
    certificate: CERT,
    note: "The second page is cut off.",
  });

const subjectsSent = () =>
  sendEmail.mock.calls.map((call) => (call[1] as { subject: string }).subject);

beforeEach(() => {
  claimed.clear();
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ status: "sent" });
  recipientFor.mockResolvedValue({ userId: "u1", email: "sam@example.com", name: "Sam" });
});

describe("insurance review email — dedupe by kind + certificate", () => {
  it("verifying the same certificate twice sends one verified email", async () => {
    await verify();
    await verify();

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(subjectsSent()).toEqual(["Your insurance is verified"]);
  });

  it("rejecting the same certificate twice sends one rejected email", async () => {
    await reject();
    await reject();

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(subjectsSent()).toEqual(["Action needed for your insurance"]);
  });

  it("rejecting then verifying the same certificate sends both", async () => {
    await reject();
    await verify();

    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(subjectsSent()).toEqual([
      "Action needed for your insurance",
      "Your insurance is verified",
    ]);
  });
});
