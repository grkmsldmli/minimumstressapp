import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { recordAdminAction } = await import("./audit");

function fakeAdmin(insert: (row: Record<string, unknown>) => unknown) {
  return {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        expect(table).toBe("admin_audit_log");
        return insert(row);
      },
    }),
  } as never;
}

describe("recordAdminAction", () => {
  it("writes an attributed row with the mapped columns", async () => {
    let written: Record<string, unknown> | null = null;
    const admin = fakeAdmin((row) => {
      written = row;
      return Promise.resolve({ error: null });
    });

    await recordAdminAction(admin, {
      adminUserId: "u9",
      adminEmail: "staff@example.com",
      action: "decide_refund",
      targetType: "refund_request",
      targetId: "rr-1",
      reason: "duplicate charge",
      metadata: { outcome: "approved", refundedCents: 5000 },
    });

    expect(written).toEqual({
      admin_user_id: "u9",
      admin_email: "staff@example.com",
      action: "decide_refund",
      target_type: "refund_request",
      target_id: "rr-1",
      reason: "duplicate charge",
      metadata: { outcome: "approved", refundedCents: 5000 },
    });
  });

  it("defaults optional fields and never throws when the insert fails", async () => {
    const admin = fakeAdmin(() => Promise.resolve({ error: { message: "boom" } }));
    await expect(
      recordAdminAction(admin, { adminUserId: null, adminEmail: null, action: "approve_listing" }),
    ).resolves.toBeUndefined();
  });

  it("swallows a thrown insert — a lost audit row must not look like a failed action", async () => {
    const admin = fakeAdmin(() => {
      throw new Error("network");
    });
    await expect(
      recordAdminAction(admin, { adminUserId: "u1", adminEmail: "s@x.com", action: "resolve_escalation" }),
    ).resolves.toBeUndefined();
  });
});
