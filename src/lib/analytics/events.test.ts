import { describe, expect, it } from "vitest";

import {
  ANALYTICS_EVENTS,
  isAnalyticsEvent,
  sanitizeProperties,
  validateEvent,
} from "./events";

describe("analytics event vocabulary", () => {
  it("recognizes known names and rejects unknown ones", () => {
    expect(isAnalyticsEvent("space_viewed")).toBe(true);
    expect(isAnalyticsEvent("definitely_not_an_event")).toBe(false);
  });

  it("has no duplicate names", () => {
    expect(new Set(ANALYTICS_EVENTS).size).toBe(ANALYTICS_EVENTS.length);
  });
});

describe("sanitizeProperties — keeps shapes, never secrets or PII", () => {
  it("drops forbidden keys and keeps safe scalars", () => {
    const out = sanitizeProperties({
      category: "movement",
      count: 3,
      urgent: true,
      nothing: null,
      // All of these must be stripped.
      password: "hunter2",
      access_token: "abc",
      stripe_secret: "sk_live_x",
      cardNumber: "4242424242424242",
      cvc: "123",
      email: "a@b.com",
      phone: "555",
      home_address: "1 Main St",
      messageBody: "private text",
      content: "more private text",
      medical_note: "x",
    });
    expect(out).toEqual({ category: "movement", count: 3, urgent: true, nothing: null });
  });

  it("drops non-scalar values and truncates long strings", () => {
    const long = "x".repeat(900);
    const out = sanitizeProperties({ nested: { a: 1 }, list: [1, 2], blurb: long, fn: () => {} });
    expect(out.nested).toBeUndefined();
    expect(out.list).toBeUndefined();
    expect((out.blurb as string).length).toBe(500);
  });

  it("returns an empty bag for non-objects rather than throwing", () => {
    expect(sanitizeProperties(null)).toEqual({});
    expect(sanitizeProperties("nope")).toEqual({});
    expect(sanitizeProperties([1, 2, 3])).toEqual({});
  });
});

describe("validateEvent", () => {
  it("rejects an unknown event name", () => {
    expect(validateEvent({ name: "bogus" }).ok).toBe(false);
  });

  it("refuses a server-only business fact from a client", () => {
    const r = validateEvent({ name: "payment_succeeded" }, false);
    expect(r.ok).toBe(false);
  });

  it("allows a server-only event when the server emits it", () => {
    const r = validateEvent({ name: "payment_succeeded", properties: { amountCents: 5400 } }, true);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.properties).toEqual({ amountCents: 5400 });
  });

  it("passes a client event and sanitizes its properties", () => {
    const r = validateEvent({ name: "space_viewed", properties: { spaceId: "s1", email: "x@y.z" } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe("space_viewed");
      expect(r.value.properties).toEqual({ spaceId: "s1" }); // email stripped
    }
  });
});
