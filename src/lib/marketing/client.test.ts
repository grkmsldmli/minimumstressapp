import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn(async () => new Response(null, { status: 204 })));
vi.mock("../api-fetch", () => ({ apiFetch }));

import { recordMarketingActivity, resetMarketingActivityForTests } from "./client";

beforeEach(() => {
  vi.clearAllMocks();
  resetMarketingActivityForTests();
});

describe("marketing activity client", () => {
  it("sends no identifier or browsing detail", async () => {
    await expect(recordMarketingActivity("space_browsed")).resolves.toBe(true);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/marketing/activity",
      expect.objectContaining({ body: JSON.stringify({ event: "space_browsed" }) }),
    );
  });

  it("deduplicates app opens and short browse bursts", async () => {
    await recordMarketingActivity("app_opened");
    await recordMarketingActivity("app_opened");
    await recordMarketingActivity("space_browsed");
    await recordMarketingActivity("space_browsed");
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("allows a failed attempt to recover", async () => {
    apiFetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(recordMarketingActivity("app_opened")).resolves.toBe(false);
    await expect(recordMarketingActivity("app_opened")).resolves.toBe(true);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
