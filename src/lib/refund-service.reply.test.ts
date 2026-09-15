import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./money-operations", () => ({ claimRefundDecision: vi.fn() }));
vi.mock("./money-operation-service", () => ({
  executeMoneyOperation: vi.fn(),
  MoneyOperationExecutionError: class extends Error {},
}));
vi.mock("./notify/for-refund", () => ({ notifyRefundRequested: vi.fn() }));

import { replyToRefund } from "./refund-service";

function adminFor(updated: boolean) {
  const predicates: Array<[string, unknown]> = [];
  const selected = {
    data: {
      id: "request-1",
      state: "awaiting_host",
      bookings: { spaces: { host_id: "host-1" } },
    },
    error: null,
  };
  const updateResult = { data: updated ? { id: "request-1" } : null, error: null };

  return {
    predicates,
    admin: {
      from: () => ({
        select: () => {
          const chain = {
            eq: () => chain,
            maybeSingle: () => Promise.resolve(selected),
          };
          return chain;
        },
        update: () => {
          const chain = {
            eq: (column: string, value: unknown) => {
              predicates.push([column, value]);
              return chain;
            },
            select: () => chain,
            maybeSingle: () => Promise.resolve(updateResult),
          };
          return chain;
        },
      }),
    } as never,
  };
}

describe("host refund reply compare-and-set", () => {
  it("moves only the still-awaiting request", async () => {
    const { admin, predicates } = adminFor(true);
    await expect(replyToRefund(admin, "request-1", "host-1", "Host evidence"))
      .resolves.toBeUndefined();
    expect(predicates).toEqual([
      ["id", "request-1"],
      ["state", "awaiting_host"],
    ]);
  });

  it("returns 409 when another actor wins after the ownership read", async () => {
    const { admin } = adminFor(false);
    await expect(replyToRefund(admin, "request-1", "host-1", "Host evidence"))
      .rejects.toMatchObject({ status: 409 });
  });
});
