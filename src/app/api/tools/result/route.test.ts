import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetForTests } from "@/lib/api/rate-limit";
import { WEBSITE } from "@/lib/company";

/**
 * An open endpoint that sends mail.
 *
 * There is no sign-in here, because the tools do not need one — so anybody who
 * can reach the site can make this send a message from our address to an
 * address of their choosing. That is fine for a result somebody asked for and
 * a disaster if the message can be made to say anything, so the tests below
 * are mostly about what a caller cannot do with it.
 */

// The route's own guard against being imported into a client bundle, which
// has nothing to say in a test runner.
vi.mock("server-only", () => ({}));

const sendEmail = vi.fn(async () => ({ status: "sent" as const }));
vi.mock("@/lib/notify/transports", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...(args as [])),
}));

const { POST } = await import("./route");

/*
 * A plain Request, cast to the NextRequest the handler is typed against. The
 * route only reads `json()` and the headers, both of which a Request has —
 * building a real NextRequest here would add a Next internals import to prove
 * nothing.
 */
const post = (body: unknown, ip = "203.0.113.1") =>
  POST(
    new Request("https://minimumstress.com/api/tools/result", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "x-forwarded-for": ip },
    }) as NextRequest,
  );

const asked = {
  email: "reader@example.com",
  slug: "burnout-test",
  toolName: "Burnout Test",
  score: "37",
  band: "Burning",
  summary: "Moderate burnout risk.",
};

/** What went out, as the transport saw it. */
function sentMessage() {
  const [, message] = sendEmail.mock.calls[0] as unknown as [string, { html: string; body: string }];
  return message;
}

describe("sending a result", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetForTests();
  });

  it("sends it and says so", async () => {
    const response = await post(asked);
    expect(response.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(sentMessage().html).toContain("Burning");
  });

  it("refuses an address that is not one, before sending anything", async () => {
    const response = await post({ ...asked, email: "reader@example" });
    expect(response.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("never sends it as a text message", async () => {
    await post(asked);
    const [, message] = sendEmail.mock.calls[0] as unknown as [string, { sms: unknown }];
    expect(message.sms).toBeNull();
  });

  it("tells the reader nothing about why our mail provider failed", async () => {
    sendEmail.mockResolvedValueOnce({ status: "retry", reason: "RESEND_API_KEY is not set" } as never);
    const response = await post(asked);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("RESEND_API_KEY");
  });
});

describe("what a caller cannot put in the message", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetForTests();
  });

  /*
   * The obvious version of the "take it again" button reads the page address
   * off the client. That works until somebody posts their own, at which point
   * this mails a link of their choosing to a stranger, from us, under the
   * subject line of a wellness result.
   */
  it("builds every link from the slug, not from the body", async () => {
    await post({ ...asked, url: "https://phishing.example/login" });
    const { html, body } = sentMessage();
    expect(html).not.toContain("phishing.example");
    expect(body).not.toContain("phishing.example");
    expect(html).toContain(`${WEBSITE}/tools/burnout-test`);
  });

  it("lands an unrecognised slug on the hub rather than a made-up page", async () => {
    await post({ ...asked, slug: "../../admin" });
    expect(sentMessage().html).toContain(`${WEBSITE}/tools"`);
    expect(sentMessage().html).not.toContain("admin");
  });

  it("clamps a bar to the width the template draws on", async () => {
    await post({ ...asked, dimensions: [{ label: "Body load", value: 5000 }] });
    expect(sentMessage().html).not.toContain("5000%");
    expect(sentMessage().html).toContain('width="100%"');
  });

  it("drops a bar with no label or no number", async () => {
    await post({
      ...asked,
      dimensions: [{ label: "", value: 40 }, { label: "Real", value: "lots" }, null],
    });
    expect(sentMessage().html).not.toContain("Where it sits");
  });

  it("escapes markup rather than rendering it", async () => {
    await post({ ...asked, summary: "<img src=x onerror=alert(1)>" });
    expect(sentMessage().html).not.toContain("<img");
    expect(sentMessage().html).toContain("&lt;img");
  });

  it("caps how much of it there is", async () => {
    await post({
      ...asked,
      story: "x".repeat(5000),
      insights: Array.from({ length: 50 }, (_, i) => `insight ${i}`),
    });
    const { html } = sentMessage();
    expect(html).not.toContain("x".repeat(1000));
    expect(html).not.toContain("insight 20");
  });
});

describe("the other tools it offers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetForTests();
  });

  it("never suggests the one they just took", async () => {
    await post(asked);
    const { body } = sentMessage();
    expect(body).toContain("/tools/");
    expect(body.match(/\/tools\/burnout-test/g)?.length).toBe(1); // the "take it again" link
  });

  it("suggests something different from a different tool", async () => {
    await post(asked);
    const first = sentMessage().body;
    vi.clearAllMocks();
    resetForTests();
    await post({ ...asked, slug: "sleep-score" });
    expect(sentMessage().body).not.toBe(first);
  });
});

describe("how much of it one caller can send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetForTests();
  });

  /*
   * Both directions of the same abuse: one machine working through a list of
   * addresses, and a lot of machines pointed at one inbox.
   */
  it("stops one caller working through a list", async () => {
    const limit = 6;
    for (let i = 0; i < limit; i++) {
      expect((await post({ ...asked, email: `someone${i}@example.com` })).status).toBe(200);
    }
    expect((await post({ ...asked, email: "someone7@example.com" })).status).toBe(429);
  });

  it("stops a crowd pointing at one inbox", async () => {
    const limit = 6;
    for (let i = 0; i < limit; i++) {
      expect((await post(asked, `203.0.113.${i + 10}`)).status).toBe(200);
    }
    expect((await post(asked, "198.51.100.9")).status).toBe(429);
  });
});
