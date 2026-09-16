import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  booking: null as Record<string, unknown> | null,
  reviewCount: 0,
  reviewRows: [] as Record<string, unknown>[],
  escalationRows: [] as Record<string, unknown>[],
}));

vi.mock("./admin/access", () => ({ safetyRecipient: () => null }));
vi.mock("./notify/send", () => ({ notify: vi.fn() }));

import { submitReview } from "./review-service";

const HOST = "11111111-1111-4111-8111-111111111111";
const PRACTITIONER = "22222222-2222-4222-8222-222222222222";

function countQuery() {
  const chain: Record<string, unknown> = {};
  chain.eq = () => chain;
  chain.then = (
    resolve: (value: { count: number; error: null }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve({ count: state.reviewCount, error: null }).then(resolve, reject);
  return chain;
}

function admin() {
  return {
    from: (table: string) => {
      if (table === "bookings") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: state.booking, error: null }) }),
          }),
        };
      }
      if (table === "reviews") {
        return {
          select: () => countQuery(),
          insert: (row: Record<string, unknown>) => {
            state.reviewRows.push(row);
            return {
              select: () => ({
                single: async () => ({
                  data: { id: "33333333-3333-4333-8333-333333333333" },
                  error: null,
                }),
              }),
            };
          },
        };
      }
      if (table === "review_escalations") {
        return {
          insert: async (row: Record<string, unknown>) => {
            state.escalationRows.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  } as never;
}

beforeEach(() => {
  state.booking = {
    id: "44444444-4444-4444-8444-444444444444",
    space_id: "55555555-5555-4555-8555-555555555555",
    practitioner_id: PRACTITIONER,
    ends_at: "2026-09-15T10:00:00.000Z",
    status: "completed",
    captured_at: "2026-09-15T08:00:00.000Z",
    spaces: { host_id: HOST, name: "Willow Studio" },
  };
  state.reviewCount = 0;
  state.reviewRows = [];
  state.escalationRows = [];
});

describe("review authorship and public-copy safety", () => {
  it("rejects a booking whose two parties are the same account", async () => {
    state.booking = {
      ...state.booking!,
      practitioner_id: HOST,
      spaces: { host_id: HOST, name: "Willow Studio" },
    };

    await expect(
      submitReview(
        admin(),
        HOST,
        { bookingId: state.booking.id as string, overall: 5, comment: "Great", safetyConcern: false },
        new Date("2026-09-16T10:00:00.000Z"),
      ),
    ).resolves.toEqual({ ok: false, reason: "not_your_booking" });
    expect(state.reviewRows).toEqual([]);
  });

  it("derives subject and role from the booking and ignores the other side's fields", async () => {
    const result = await submitReview(
      admin(),
      PRACTITIONER,
      {
        bookingId: state.booking!.id as string,
        overall: 5,
        comment: "Clean and accurate",
        safetyConcern: false,
        practitioner: { accessOnTime: true, cleanliness: 5, accuracy: 5, wouldBookAgain: true },
        host: { leftAsFound: 1, respectedHouseRules: false, onTime: false, wouldHostAgain: false },
      },
      new Date("2026-09-16T10:00:00.000Z"),
    );

    expect(result).toEqual({ ok: true, escalated: false });
    expect(state.reviewRows[0]).toMatchObject({
      author_id: PRACTITIONER,
      subject_id: HOST,
      role: "practitioner",
      access_on_time: true,
      cleanliness: 5,
      accuracy: 5,
      would_book_again: true,
    });
    expect(state.reviewRows[0]).not.toHaveProperty("left_as_found");
    expect(state.reviewRows[0]).not.toHaveProperty("would_host_again");
  });

  it("removes contact details and drops off-platform solicitation from review copy", async () => {
    await submitReview(
      admin(),
      PRACTITIONER,
      {
        bookingId: state.booking!.id as string,
        overall: 5,
        comment: "The building contact was desk@example.com",
        safetyConcern: false,
      },
      new Date("2026-09-16T10:00:00.000Z"),
    );
    expect(state.reviewRows[0].comment).toBe("The building contact was");

    state.reviewRows = [];
    await submitReview(
      admin(),
      HOST,
      {
        bookingId: state.booking!.id as string,
        overall: 5,
        comment: "Send me your number for next time",
        safetyConcern: false,
      },
      new Date("2026-09-16T10:00:00.000Z"),
    );
    expect(state.reviewRows[0].comment).toBe("");
  });

  it("creates a highest-priority escalation even when the star rating is positive", async () => {
    const result = await submitReview(
      admin(),
      HOST,
      {
        bookingId: state.booking!.id as string,
        overall: 5,
        comment: "A safety issue needs review",
        safetyConcern: true,
      },
      new Date("2026-09-16T10:00:00.000Z"),
    );

    expect(result).toEqual({ ok: true, escalated: true });
    expect(state.escalationRows[0]).toMatchObject({ priority: "safety" });
  });
});
