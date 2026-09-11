import { describe, expect, it } from "vitest";

import { acceptsInterest, effectiveRequestState, isCancellable, isFillable } from "./request-state";

const NOW = new Date("2026-06-15T12:00:00Z");
const FUTURE_START = new Date("2026-06-16T18:00:00Z");
const FUTURE_END = new Date("2026-06-16T19:00:00Z");
const PAST_START = new Date("2026-06-14T18:00:00Z");
const PAST_END = new Date("2026-06-14T19:00:00Z");

describe("effectiveRequestState", () => {
  it("leaves a future open request open", () => {
    expect(
      effectiveRequestState({ state: "open", startsAt: FUTURE_START, endsAt: FUTURE_END }, NOW),
    ).toBe("open");
  });

  it("treats an open request whose start has passed as expired", () => {
    expect(
      effectiveRequestState({ state: "open", startsAt: PAST_START, endsAt: PAST_END }, NOW),
    ).toBe("expired");
  });

  it("treats a filled request whose end has passed as completed", () => {
    expect(
      effectiveRequestState({ state: "filled", startsAt: PAST_START, endsAt: PAST_END }, NOW),
    ).toBe("completed");
  });

  it("leaves a filled future request filled, and never touches cancelled", () => {
    expect(
      effectiveRequestState({ state: "filled", startsAt: FUTURE_START, endsAt: FUTURE_END }, NOW),
    ).toBe("filled");
    expect(
      effectiveRequestState({ state: "cancelled", startsAt: PAST_START, endsAt: PAST_END }, NOW),
    ).toBe("cancelled");
  });
});

describe("lifecycle guards", () => {
  const future = { startsAt: FUTURE_START, endsAt: FUTURE_END };
  const past = { startsAt: PAST_START, endsAt: PAST_END };

  it("only a genuinely open request accepts interest and can be filled", () => {
    expect(isFillable({ state: "open", ...future }, NOW)).toBe(true);
    expect(acceptsInterest({ state: "open", ...future }, NOW)).toBe(true);
    // Past its start, it is effectively expired — neither fillable nor open to interest.
    expect(isFillable({ state: "open", ...past }, NOW)).toBe(false);
    expect(acceptsInterest({ state: "open", ...past }, NOW)).toBe(false);
    expect(isFillable({ state: "filled", ...future }, NOW)).toBe(false);
  });

  it("a draft or open request is cancellable; a filled or expired one is not", () => {
    expect(isCancellable({ state: "draft", ...future }, NOW)).toBe(true);
    expect(isCancellable({ state: "open", ...future }, NOW)).toBe(true);
    expect(isCancellable({ state: "filled", ...future }, NOW)).toBe(false);
    expect(isCancellable({ state: "open", ...past }, NOW)).toBe(false);
  });
});
