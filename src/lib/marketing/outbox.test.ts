import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const TOKEN = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("marketing lifecycle facts", () => {
  it("uses only coarse activity and paid booking facts", async () => {
    const { marketingFactsFor } = await import("./outbox");
    const facts = marketingFactsFor(
      [
        {
          id: USER,
          account_type: "practitioner",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-08-01T00:00:00.000Z",
          profession: "yoga",
          search_postcode: "94612",
          terms_accepted_at: "2026-01-01T00:00:00.000Z",
          notify_offers: true,
          marketing_consent_at: "2026-01-01T00:00:00.000Z",
          marketing_unsubscribed_at: null,
          marketing_unsubscribe_token: TOKEN,
        },
      ],
      [],
      [
        {
          id: "booking-1",
          practitioner_id: USER,
          ends_at: "2026-08-15T12:00:00.000Z",
          created_at: "2026-08-01T00:00:00.000Z",
        },
        {
          id: "booking-1",
          practitioner_id: USER,
          ends_at: "2026-08-15T12:00:00.000Z",
          created_at: "2026-08-01T00:00:00.000Z",
        },
      ],
      [],
      [
        {
          user_id: USER,
          last_app_opened_at: "2026-09-01T00:00:00.000Z",
          last_space_browsed_at: "2026-09-14T00:00:00.000Z",
        },
      ],
      new Date("2026-09-16T00:00:00.000Z"),
    ).get(USER);

    expect(facts).toMatchObject({
      onboardingComplete: true,
      isHost: false,
      liveListings: 0,
      bookingCount: 1,
      lastBrowseAt: new Date("2026-09-14T00:00:00.000Z"),
      lastBookingAt: new Date("2026-08-15T12:00:00.000Z"),
      lastActiveAt: new Date("2026-09-01T00:00:00.000Z"),
    });
  });

  it("derives host onboarding and inventory from completed listings", async () => {
    const { marketingFactsFor } = await import("./outbox");
    const facts = marketingFactsFor(
      [
        {
          id: USER,
          account_type: "host",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
          profession: null,
          search_postcode: null,
          terms_accepted_at: "2026-01-01T00:00:00.000Z",
          notify_offers: true,
          marketing_consent_at: "2026-01-01T00:00:00.000Z",
          marketing_unsubscribed_at: null,
          marketing_unsubscribe_token: TOKEN,
        },
      ],
      [
        {
          host_id: USER,
          status: "active",
          created_at: "2026-02-01T00:00:00.000Z",
          updated_at: "2026-02-02T00:00:00.000Z",
          creation_completed_at: "2026-02-02T00:00:00.000Z",
        },
      ],
      [],
      [],
      [],
      new Date("2026-09-16T00:00:00.000Z"),
    ).get(USER);

    expect(facts).toMatchObject({
      onboardingComplete: true,
      isHost: true,
      liveListings: 1,
      firstLiveListingAt: new Date("2026-02-02T00:00:00.000Z"),
      bookingCount: 0,
    });
  });
});

describe("marketing outbox delivery", () => {
  function admin(consented = true, attempts = 1) {
    const updates: Record<string, unknown>[] = [];
    const acceptance = vi.fn(async () => ({ data: true, error: null }));
    const row = {
      id: "33333333-3333-4333-8333-333333333333",
      user_id: USER,
      campaign: "rebooking",
      dedupe_key: `marketing:v1:rebooking:${USER}:booking:2026-08-01T00:00:00.000Z`,
      subject: "Ready to book?",
      text_body: "Text",
      html_body: "<p>Text</p>",
      provider_correlation_id: "a".repeat(64),
      attempts,
      lease_token: "44444444-4444-4444-8444-444444444444",
      unsubscribe_token: TOKEN,
    };

    const client = {
      rpc: vi.fn(async (name: string) =>
        name === "claim_marketing_email_batch"
          ? { data: [row], error: null }
          : acceptance(),
      ),
      from: vi.fn((table: string) => {
        if (table === "profiles") {
          const chain: Record<string, unknown> = {};
          chain.select = vi.fn(() => chain);
          chain.eq = vi.fn(() => chain);
          chain.maybeSingle = vi.fn(async () => ({
            data: {
              notify_offers: consented,
              marketing_consent_at: "2026-01-01T00:00:00.000Z",
              marketing_unsubscribed_at: consented ? null : "2026-09-15T00:00:00.000Z",
            },
            error: null,
          }));
          return chain;
        }
        const chain: Record<string, unknown> = {};
        chain.update = vi.fn((value: Record<string, unknown>) => {
          updates.push(value);
          return chain;
        });
        chain.eq = vi.fn(() => chain);
        chain.then = (resolve: (value: unknown) => unknown) => resolve({ error: null });
        return chain;
      }),
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({
            data: {
              user: {
                email: "person@example.com",
                email_confirmed_at: "2026-01-01T00:00:00.000Z",
              },
            },
            error: null,
          })),
        },
      },
    };
    return { client, updates, acceptance };
  }

  it("rechecks consent immediately before the provider call", async () => {
    const state = admin(false);
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    const { processMarketingOutbox } = await import("./outbox");

    await expect(
      processMarketingOutbox(state.client as never, {
        now: new Date("2026-09-16T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ claimed: 1, sent: 0, suppressed: 1 });
    expect(provider).not.toHaveBeenCalled();
    expect(state.updates[0]).toMatchObject({
      state: "suppressed",
      subject: null,
      text_body: null,
      html_body: null,
    });
  });

  it("sends an immutable envelope and records provider acceptance", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    const state = admin(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: "email_accepted" }), { status: 200 })),
    );
    const { processMarketingOutbox } = await import("./outbox");

    await expect(
      processMarketingOutbox(state.client as never, {
        now: new Date("2026-09-16T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ claimed: 1, sent: 1, retrying: 0, failed: 0 });
    expect(state.acceptance).toHaveBeenCalledOnce();
  });

  it("closes an exhausted provider retry instead of reporting it as retrying", async () => {
    const state = admin(true, 8);
    const { processMarketingOutbox } = await import("./outbox");

    await expect(
      processMarketingOutbox(state.client as never, {
        now: new Date("2026-09-16T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ claimed: 1, sent: 0, retrying: 0, failed: 1 });
    expect(state.updates[0]).toMatchObject({
      state: "failed",
      subject: null,
      text_body: null,
      html_body: null,
      last_error: "marketing retry attempts exhausted",
    });
  });
});
