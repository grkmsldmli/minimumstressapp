import { describe, expect, it } from "vitest";

import { APP_URL } from "../company";
import { appEmailUrl, escapeHtml } from "./email-template";
import { NOTIFICATION_KINDS, render, toHtml } from "./messages";

const COMPLETE = {
  name: "Elena",
  summary: "Three decisions are waiting",
  items: "Insurance review\nRefund review",
  queueUrl: `${APP_URL}/admin/trust`,
  spaceName: "Willow Studio",
  when: "Tuesday, March 4 at 11:00 AM",
  address: "12 Alder Lane",
  accessCode: "4417",
  entryInstructions: "Use the keypad beside the blue door.",
  amountCents: 5_400,
  chargedCents: 5_400,
  refundedCents: 5_400,
  strikes: 3,
  limit: 3,
  until: "March 18",
  reason: "Bank account closed",
  note: "Reviewed by Operations",
  role: "host",
  purpose: "Small group class",
  attendees: 6,
  deadline: "Monday at 4:00 PM",
  className: "Reformer Flow",
};

describe("corporate notification email", () => {
  it.each(NOTIFICATION_KINDS)("gives %s the complete transactional structure", (kind) => {
    const message = render(kind, COMPLETE);
    const html = message.html ?? "";

    expect(message.body).not.toContain("<html");
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<meta name="viewport"');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('role="status"');
    expect(html).toContain('role="group" aria-label="Message details"');
    expect(html).toContain("<footer");
    expect(html.match(/<a\b/g)).toHaveLength(1);

    const href = html.match(/<a href="([^"]+)"/)?.[1];
    expect(href).toBeTruthy();
    expect(new URL(href!).origin).toBe(new URL(APP_URL).origin);
  });

  it.each(NOTIFICATION_KINDS)("keeps %s free of remote or executable assets", (kind) => {
    const html = render(kind, COMPLETE).html ?? "";

    expect(html).not.toMatch(/<(?:img|script|iframe|object|embed|link|style|svg)\b/i);
    expect(html).not.toMatch(/(?:src|background)\s*=/i);
    expect(html).not.toMatch(/url\s*\(/i);
    expect(html).not.toContain("tracking");
  });

  it("is fluid at small widths without a stylesheet or web font", () => {
    const html = render("booking_confirmed", COMPLETE).html ?? "";

    expect(html).toContain('width="100%"');
    expect(html).toContain("max-width:560px");
    expect(html).toContain("-apple-system");
    expect(html).not.toContain("@media");
    expect(html).not.toContain("@font-face");
  });

  it("escapes every dynamic surface instead of accepting raw markup", () => {
    const attack = `<script>alert("x")</script><img src=x onerror=alert(1)>`;
    const message = render("host_new_request", {
      name: attack,
      spaceName: attack,
      when: attack,
      purpose: attack,
      deadline: attack,
      note: attack,
    });
    const html = message.html ?? "";

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&quot;x&quot;");
  });

  it("places a hidden preview before the visible email", () => {
    const html = render("booking_confirmed", COMPLETE).html ?? "";
    const preview = html.indexOf('aria-hidden="true"');
    const content = html.indexOf('role="presentation"');

    expect(preview).toBeGreaterThan(0);
    expect(preview).toBeLessThan(content);
    expect(html.slice(preview, content)).toContain("Your session at Willow Studio is confirmed");
  });

  it("keeps the plain-text body as a complete fallback", () => {
    for (const kind of NOTIFICATION_KINDS) {
      const message = render(kind, COMPLETE);
      expect(message.body.length).toBeGreaterThan(20);
      expect(message.body).toContain("Minimum Stress");
    }
  });
});

describe("CTA boundary", () => {
  it.each([
    "https://evil.example/admin",
    "//evil.example/admin",
    "javascript:alert(1)",
    "http://minimumstress.app/admin",
    "/admin\\@evil.example",
  ])("rejects %s", (candidate) => {
    expect(() => appEmailUrl(candidate)).toThrow(RangeError);
  });

  it("accepts local paths and same-origin absolute URLs", () => {
    expect(appEmailUrl("/admin/trust?state=open")).toBe(`${APP_URL}/admin/trust?state=open`);
    expect(appEmailUrl(`${APP_URL}/admin`)).toBe(`${APP_URL}/admin`);
  });

  it("refuses an unsafe dynamic staff queue instead of silently linking it", () => {
    expect(() =>
      render("staff_waiting", {
        summary: "Review needed",
        queueUrl: "https://phishing.example/admin",
      }),
    ).toThrow(/stay on Minimum Stress/);
  });
});

describe("generic plain-text conversion", () => {
  it("uses the same safe shell without trusting message text as HTML", () => {
    const html = toHtml({
      subject: `Status <img src=x>`,
      body: `Hello\n\n<script>alert(1)</script>`,
      sms: null,
    });

    expect(html).toContain(escapeHtml("Status <img src=x>"));
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html.match(/<a\b/g)).toHaveLength(1);
  });
});
