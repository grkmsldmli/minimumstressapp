import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { APP_URL } from "./company";
import type { ReferralSummary } from "./domain";
import {
  REFERRAL_PARAM,
  REFERRAL_REWARD_CENTS,
  REFERRAL_STATUS_LABEL,
  REWARD_STATE_LABEL,
  type PendingReferral,
  planAttribution,
  referralLink,
  rewardLabel,
  rewardsEarnedCents,
  rewardsPaidCents,
  rewardsSummaryLabel,
  runAttribution,
} from "./referrals";

/** A referral summary with sensible reward defaults for the tests below. */
function ref(over: Partial<ReferralSummary> = {}): ReferralSummary {
  return {
    id: over.id ?? "r1",
    status: over.status ?? "joined",
    joinedAt: over.joinedAt ?? new Date(),
    rewardCents: over.rewardCents ?? 0,
    rewardState: over.rewardState ?? null,
  };
}

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

describe("referral rewards", () => {
  it("is $25, and the app constant matches the SQL ledger", () => {
    expect(REFERRAL_REWARD_CENTS).toBe(2500);
    // Pin to migration 0062 so the shown amount and the frozen ledger amount
    // can never drift apart.
    const sql = readFileSync(
      join(import.meta.dirname, "../../supabase/migrations/0062_referral_rewards.sql"),
      "utf8",
    ).replace(/\r/g, "");
    const amount = REFERRAL_REWARD_CENTS;
    expect(sql).toContain(`default ${amount} check`); // the column default
    expect(sql).toMatch(new RegExp(`values \\(new\\.id, new\\.referrer_id, ${amount}\\)`)); // the trigger
    expect(sql).toMatch(new RegExp(`select r\\.id, r\\.referrer_id, ${amount}, r\\.qualified_at`)); // the backfill
  });

  it("labels a per-referral reward without ever implying payment", () => {
    expect(rewardLabel(REFERRAL_REWARD_CENTS)).toBe("$25 reward");
    expect(REWARD_STATE_LABEL.earned).toBe("earned");
    expect(REWARD_STATE_LABEL.paid).toBe("paid");
  });

  it("sums earned and paid strictly from the ledger rows", () => {
    const list = [
      ref({ id: "a", status: "qualified", rewardCents: 2500, rewardState: "earned" }),
      ref({ id: "b", status: "qualified", rewardCents: 2500, rewardState: "paid" }),
      ref({ id: "c", status: "space_live", rewardCents: 0, rewardState: null }),
    ];
    expect(rewardsEarnedCents(list)).toBe(5000); // both qualified rewards
    expect(rewardsPaidCents(list)).toBe(2500); // only the one marked paid
  });

  it("shows a summary only when something is earned", () => {
    expect(rewardsSummaryLabel([])).toBeNull();
    expect(rewardsSummaryLabel([ref({ status: "joined" }), ref({ status: "space_live" })])).toBeNull();
    expect(
      rewardsSummaryLabel([
        ref({ id: "a", status: "qualified", rewardCents: 2500, rewardState: "earned" }),
        ref({ id: "b", status: "qualified", rewardCents: 2500, rewardState: "earned" }),
      ]),
    ).toBe("$50 earned from referrals");
  });

  it("shows no reward wording before a referral qualifies", () => {
    // Joined and space-live referrals carry no reward, so nothing to display.
    for (const r of [ref({ status: "joined" }), ref({ status: "space_live" })]) {
      expect(r.rewardCents).toBe(0);
      expect(r.rewardState).toBeNull();
    }
    // And the status words themselves never mention money.
    for (const label of Object.values(REFERRAL_STATUS_LABEL)) {
      expect(label).not.toMatch(/\$|reward|earned|paid|cash|payout/i);
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
