import { describe, expect, it, vi } from "vitest";

import { runWithIndependentRetention } from "./cron-runner";

describe("runWithIndependentRetention", () => {
  it("keeps operational work first, then runs retention", async () => {
    const order: string[] = [];

    const result = await runWithIndependentRetention(
      async () => {
        order.push("operations");
        return { paid: 2 };
      },
      async () => {
        order.push("retention");
        return { analyticsEventsPruned: 4 };
      },
    );

    expect(order).toEqual(["operations", "retention"]);
    expect(result).toEqual({
      operational: { ok: true, value: { paid: 2 } },
      retention: { ok: true, value: { analyticsEventsPruned: 4 } },
    });
  });

  it("still attempts retention after operational work throws", async () => {
    const retention = vi.fn(async () => ({ analyticsEventsPruned: 3 }));
    const operationsError = new Error("payout query unavailable");

    const result = await runWithIndependentRetention(
      async () => {
        throw operationsError;
      },
      retention,
    );

    expect(retention).toHaveBeenCalledOnce();
    expect(result.operational).toEqual({ ok: false, error: operationsError });
    expect(result.retention).toEqual({
      ok: true,
      value: { analyticsEventsPruned: 3 },
    });
  });

  it("preserves both failures so retention errors cannot be hidden", async () => {
    const operationsError = new Error("operations failed");
    const retentionError = new Error("retention failed");

    const result = await runWithIndependentRetention(
      async () => {
        throw operationsError;
      },
      async () => {
        throw retentionError;
      },
    );

    expect(result.operational).toEqual({ ok: false, error: operationsError });
    expect(result.retention).toEqual({ ok: false, error: retentionError });
  });
});
