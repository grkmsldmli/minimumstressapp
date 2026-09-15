import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  events: [] as string[],
  inCalls: [] as Array<[string, unknown[]]>,
}));

function emptyQuery() {
  const chain = {
    lte: () => chain,
    lt: () => chain,
    not: () => chain,
    eq: () => chain,
    is: () => chain,
    or: () => chain,
    in(column: string, values: unknown[]) {
      state.inCalls.push([column, values]);
      return chain;
    },
    then(resolve: (value: { data: never[]; error: null }) => unknown) {
      return Promise.resolve(resolve({ data: [], error: null }));
    },
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      select: (columns: string) => {
        if (table === "bookings" && columns.includes("spaces!inner(host_id)")) {
          state.events.push("payout-query");
        }
        return emptyQuery();
      },
    }),
  }),
}));

vi.mock("@/lib/financial-resolution", () => ({
  retryFinancialResolutions: vi.fn(async () => {
    state.events.push("financial-resolution");
    return { claimed: 0, resolved: 0, retrying: 0, manualReview: 0 };
  }),
}));

vi.mock("@/lib/approval-service", () => ({
  expireStaleRequests: vi.fn(async () => ({ expired: 0 })),
  remindWaitingHosts: vi.fn(async () => ({ reminded: 0 })),
}));

vi.mock("@/lib/api/stripe-gateway", () => ({ stripeGateway: {} }));
vi.mock("@/lib/admin/access", () => ({ safetyRecipient: () => null }));
vi.mock("@/lib/admin/attention", () => ({
  subjectFor: vi.fn(),
  waitingOn: vi.fn(() => []),
  waitingSignature: vi.fn(),
}));
vi.mock("@/lib/notify/for-booking", () => ({
  notifyAccessCodesReady: vi.fn(async () => ({ announced: 0 })),
  reconcileCancellationNotifications: vi.fn(async () => ({ reconciled: 0 })),
  reconcileRequestOutcomeNotifications: vi.fn(async () => ({ reconciled: 0 })),
}));
vi.mock("@/lib/notify/send", () => ({
  notify: vi.fn(),
  retryPending: vi.fn(async () => ({ sent: 0 })),
}));
vi.mock("@/lib/stripe/client", () => ({
  payHost: vi.fn(),
  settle: vi.fn(),
}));
vi.mock("@/lib/site-url", () => ({ siteUrl: () => "https://minimumstress.app" }));

import { payHostsForFinishedSessions, runOperationalTasks } from "./route";

beforeEach(() => {
  state.events.length = 0;
  state.inCalls.length = 0;
});

describe("the slow operational cron", () => {
  it("reconciles cancellation money before looking for host payouts", async () => {
    await runOperationalTasks(new Date("2026-09-15T12:00:00.000Z"));

    expect(state.events.slice(0, 2)).toEqual(["financial-resolution", "payout-query"]);
  });

  it("only selects payouts whose financial state is safe", async () => {
    await expect(
      payHostsForFinishedSessions(new Date("2026-09-15T12:00:00.000Z")),
    ).resolves.toEqual({ paid: 0, failed: 0 });

    expect(state.inCalls).toContainEqual([
      "financial_resolution_state",
      ["not_required", "resolved"],
    ]);
  });
});
