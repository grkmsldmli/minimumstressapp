import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  update: vi.fn(),
  notify: vi.fn(),
  updates: [] as Record<string, unknown>[],
}));

vi.mock("../supabase/server", () => ({
  supabaseAdmin: () => ({ rpc: state.rpc, from: fromTable }),
}));
vi.mock("./for-booking", () => ({
  notifyNewMessage: (...args: unknown[]) => state.notify(...args),
}));

function fromTable() {
  return {
    update: (values: Record<string, unknown>) => {
      state.updates.push(values);
      const chain: Record<string, unknown> = {};
      chain.eq = vi.fn(() => chain);
      chain.then = (
        resolve: (value: { error: null }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve({ error: null }).then(resolve, reject);
      return chain;
    },
  };
}

import { processMessageNotificationJobs } from "./message-jobs";

const job = (attempts = 1) => ({
  message_id: "11111111-1111-4111-8111-111111111111",
  booking_id: "22222222-2222-4222-8222-222222222222",
  sender_id: "33333333-3333-4333-8333-333333333333",
  attempts,
  lease_token: "44444444-4444-4444-8444-444444444444",
});

beforeEach(() => {
  vi.clearAllMocks();
  state.updates = [];
  state.rpc.mockResolvedValue({ data: [job()], error: null });
  state.notify.mockResolvedValue(undefined);
});

describe("message notification jobs", () => {
  it("claims the specific durable row and completes it after outbox enqueue", async () => {
    const admin = { rpc: state.rpc, from: fromTable } as never;
    const result = await processMessageNotificationJobs(admin, {
      messageId: job().message_id,
      now: new Date("2026-09-16T10:00:00.000Z"),
    });

    expect(state.rpc).toHaveBeenCalledWith(
      "claim_message_notification_jobs",
      expect.objectContaining({ p_message_id: job().message_id, p_limit: 20 }),
    );
    expect(state.notify).toHaveBeenCalledWith(
      admin,
      job().booking_id,
      job().sender_id,
      job().message_id,
      { propagate: true },
    );
    expect(state.updates.at(-1)).toMatchObject({
      completed_at: expect.any(String),
      lease_token: null,
      lease_until: null,
      last_error: null,
    });
    expect(result).toEqual({ claimed: 1, completed: 1, retrying: 0, failed: 0 });
  });

  it("releases a failed lease for exponential retry without retaining exception text", async () => {
    state.notify.mockRejectedValue(new Error("person@example.com provider detail"));

    const result = await processMessageNotificationJobs(
      { rpc: state.rpc, from: fromTable } as never,
      { now: new Date("2026-09-16T10:00:00.000Z") },
    );

    expect(state.updates.at(-1)).toMatchObject({
      last_error: "notification enqueue failed",
      next_attempt_at: "2026-09-16T10:01:00.000Z",
      lease_token: null,
      lease_until: null,
    });
    expect(JSON.stringify(state.updates)).not.toContain("person@example.com");
    expect(result).toEqual({ claimed: 1, completed: 0, retrying: 1, failed: 0 });
  });

  it("makes the twelfth failed claim terminal", async () => {
    state.rpc.mockResolvedValue({ data: [job(12)], error: null });
    state.notify.mockRejectedValue(new Error("down"));

    const result = await processMessageNotificationJobs(
      { rpc: state.rpc, from: fromTable } as never,
      { now: new Date("2026-09-16T10:00:00.000Z") },
    );

    expect(state.updates.at(-1)).toMatchObject({ failed_at: "2026-09-16T10:00:00.000Z" });
    expect(result.failed).toBe(1);
  });
});
