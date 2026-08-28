import { describe, expect, it, vi } from "vitest";

import { APP_URL } from "./company";
import {
  REFERRAL_PARAM,
  REFERRAL_STATUS_LABEL,
  type PendingReferral,
  planAttribution,
  referralLink,
  runAttribution,
} from "./referrals";

describe("the referral link", () => {
  it("builds a shareable link from the code, on the app origin", () => {
    expect(referralLink("MS7F2K9Q")).toBe(`${APP_URL}/?${REFERRAL_PARAM}=MS7F2K9Q`);
  });

  it("carries the code as the ref param and nothing else", () => {
    const url = new URL(referralLink("AB12CD34"));
    expect(url.origin).toBe(new URL(APP_URL).origin);
    expect(url.searchParams.get(REFERRAL_PARAM)).toBe("AB12CD34");
    expect([...url.searchParams.keys()]).toEqual([REFERRAL_PARAM]);
  });

  it("does not expose a raw id — only the opaque code appears", () => {
    const code = "MS7F2K9Q";
    expect(referralLink(code)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i); // no uuid
  });
});

describe("the status labels", () => {
  it("are calm and factual, with no reward or money language", () => {
    expect(REFERRAL_STATUS_LABEL.joined).toBe("Joined");
    expect(REFERRAL_STATUS_LABEL.space_live).toBe("Space live");
    expect(REFERRAL_STATUS_LABEL.qualified).toBe("Referral qualified");

    for (const label of Object.values(REFERRAL_STATUS_LABEL)) {
      expect(label).not.toMatch(/\$|earned|reward|payout|cash|credit/i);
    }
  });
});

describe("planAttribution binds a pending code to one account", () => {
  it("binds an unbound code to the account that first attempts it", () => {
    const plan = planAttribution({ code: "ABC", boundTo: null }, "user-A");
    expect(plan).toEqual({ kind: "attempt", code: "ABC", bound: { code: "ABC", boundTo: "user-A" } });
  });

  it("still attempts a code already bound to the same account", () => {
    const plan = planAttribution({ code: "ABC", boundTo: "user-A" }, "user-A");
    expect(plan.kind).toBe("attempt");
  });

  it("never applies a code bound to A when B is signed in", () => {
    expect(planAttribution({ code: "ABC", boundTo: "user-A" }, "user-B")).toEqual({ kind: "skip" });
  });

  it("skips when there is nothing pending", () => {
    expect(planAttribution(null, "user-A")).toEqual({ kind: "skip" });
  });
});

describe("runAttribution keeps the code until the server processes it", () => {
  function store(initial: PendingReferral | null) {
    let value = initial;
    return {
      read: () => value,
      write: (p: PendingReferral) => {
        value = p;
      },
      clear: () => {
        value = null;
      },
      get: () => value,
    };
  }

  it("clears the code on a successful attribution", async () => {
    const s = store({ code: "ABC", boundTo: null });
    const attribute = vi.fn().mockResolvedValue(undefined);
    const outcome = await runAttribution({ ...s, currentUserId: "user-A", attribute });
    expect(outcome).toBe("attributed");
    expect(attribute).toHaveBeenCalledWith("ABC");
    expect(s.get()).toBeNull(); // cleared
  });

  it("keeps the code, bound, on a transient failure", async () => {
    const s = store({ code: "ABC", boundTo: null });
    const attribute = vi.fn().mockRejectedValue(new Error("network"));
    const outcome = await runAttribution({ ...s, currentUserId: "user-A", attribute });
    expect(outcome).toBe("kept");
    expect(s.get()).toEqual({ code: "ABC", boundTo: "user-A" }); // kept and now bound
  });

  it("retries successfully on a later load after a failure", async () => {
    const s = store({ code: "ABC", boundTo: null });
    const failing = vi.fn().mockRejectedValue(new Error("network"));
    await runAttribution({ ...s, currentUserId: "user-A", attribute: failing });
    expect(s.get()).not.toBeNull();

    const succeeding = vi.fn().mockResolvedValue(undefined);
    const outcome = await runAttribution({ ...s, currentUserId: "user-A", attribute: succeeding });
    expect(outcome).toBe("attributed");
    expect(s.get()).toBeNull();
  });

  it("never applies a code bound to A to a different account B, and does not clear it", async () => {
    const s = store({ code: "ABC", boundTo: "user-A" });
    const attribute = vi.fn().mockResolvedValue(undefined);
    const outcome = await runAttribution({ ...s, currentUserId: "user-B", attribute });
    expect(outcome).toBe("skipped");
    expect(attribute).not.toHaveBeenCalled();
    expect(s.get()).toEqual({ code: "ABC", boundTo: "user-A" }); // left for A
  });
});
