import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LIMITS, check, identify, resetForTests, tooManyRequests } from "./rate-limit";

const limit = { limit: 3, windowMs: 1000 };

beforeEach(() => {
  resetForTests();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-04T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("check", () => {
  it("allows requests up to the ceiling", () => {
    expect(check("b", "u", limit).ok).toBe(true);
    expect(check("b", "u", limit).ok).toBe(true);
    expect(check("b", "u", limit).ok).toBe(true);
  });

  it("refuses the one after", () => {
    for (let i = 0; i < 3; i++) check("b", "u", limit);
    expect(check("b", "u", limit).ok).toBe(false);
  });

  it("counts down what is left", () => {
    expect(check("b", "u", limit).remaining).toBe(2);
    expect(check("b", "u", limit).remaining).toBe(1);
    expect(check("b", "u", limit).remaining).toBe(0);
  });

  it("says how long until it will answer again", () => {
    for (let i = 0; i < 4; i++) check("b", "u", limit);
    expect(check("b", "u", limit).retryAfter).toBeGreaterThan(0);
  });

  it("forgives once the window passes", () => {
    for (let i = 0; i < 4; i++) check("b", "u", limit);
    expect(check("b", "u", limit).ok).toBe(false);

    vi.advanceTimersByTime(1001);
    expect(check("b", "u", limit).ok).toBe(true);
  });

  /** One person hitting a ceiling must not lock anybody else out. */
  it("counts each caller separately", () => {
    for (let i = 0; i < 4; i++) check("b", "noisy", limit);
    expect(check("b", "noisy", limit).ok).toBe(false);
    expect(check("b", "quiet", limit).ok).toBe(true);
  });

  /** Spending the geocode allowance must not stop someone booking. */
  it("counts each endpoint separately", () => {
    for (let i = 0; i < 4; i++) check("geocode", "u", limit);
    expect(check("geocode", "u", limit).ok).toBe(false);
    expect(check("booking", "u", limit).ok).toBe(true);
  });
});

describe("identify", () => {
  const request = (headers: Record<string, string> = {}) =>
    new Request("https://example.test/api/x", { headers });

  /**
   * The id comes from a verified token, never from the request body, so it
   * cannot be swapped for someone else's bucket — and it survives a caller
   * changing address mid-session.
   */
  it("counts a signed-in caller by their user id", () => {
    expect(identify(request({ "x-forwarded-for": "1.2.3.4" }), "user-1")).toBe("user:user-1");
  });

  it("falls back to the forwarded address when nobody is signed in", () => {
    expect(identify(request({ "x-forwarded-for": "1.2.3.4" }))).toBe("ip:1.2.3.4");
  });

  it("takes the first entry, which is the real peer", () => {
    expect(identify(request({ "x-forwarded-for": "1.2.3.4, 10.0.0.1, 10.0.0.2" }))).toBe(
      "ip:1.2.3.4",
    );
  });

  it("still returns something when there is no address at all", () => {
    expect(identify(request())).toBe("ip:unknown");
  });

  /** Null and undefined both mean "not signed in", not "a user called null". */
  it.each([null, undefined])("treats %s as anonymous", (userId) => {
    expect(identify(request({ "x-forwarded-for": "9.9.9.9" }), userId)).toBe("ip:9.9.9.9");
  });
});

describe("tooManyRequests", () => {
  it("answers 429 and says when to come back", async () => {
    const response = tooManyRequests({ ok: false, remaining: 0, retryAfter: 42 });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
  });

  /** Retry-After of zero tells a client to retry immediately, which is a loop. */
  it("never tells a caller to come back in zero seconds", () => {
    const response = tooManyRequests({ ok: false, remaining: 0, retryAfter: 0 });
    expect(response.headers.get("Retry-After")).toBe("1");
  });

  /*
   * The body is what a person reads. It used to say only "please slow down",
   * which is a telling-off that leaves them guessing whether to wait a second
   * or give up on the feature — and it was read by a host who had been shut
   * out of their own bank details.
   */
  it("puts the wait in the message, in words rather than a bare number", async () => {
    const cases: [number, string][] = [
      [1, "a few seconds"],
      [5, "a few seconds"],
      [42, "42 seconds"],
      [60, "a minute"],
      [150, "3 minutes"],
    ];

    for (const [retryAfter, expected] of cases) {
      const body = (await tooManyRequests({ ok: false, remaining: 0, retryAfter }).json()) as {
        error: string;
      };
      expect(body.error, `retryAfter ${retryAfter}`).toContain(expected);
    }
  });
});

describe("the configured limits", () => {
  it("gives every endpoint a positive ceiling and a real window", () => {
    for (const [name, limit] of Object.entries(LIMITS)) {
      expect(limit.limit, name).toBeGreaterThan(0);
      expect(limit.windowMs, name).toBeGreaterThanOrEqual(1000);
    }
  });

  /**
   * Address lookup is debounced and fires while someone types; booking
   * authorises a card. The first should be the more generous of the two by a
   * wide margin, and if that ever inverts something has been mis-set.
   */
  it("is more generous to typing than to spending", () => {
    expect(LIMITS.geocode.limit).toBeGreaterThan(LIMITS.booking.limit);
  });
});
