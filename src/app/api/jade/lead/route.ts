import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError } from "@/lib/api/session";
import { jsonObject } from "@/lib/api/validate";
import { CHAT_CUSTOMER_URL } from "@/lib/jade";

/**
 * An email somebody left with Jade, forwarded from here.
 *
 * Same reason as the chat route: the upstream endpoint refuses any browser
 * origin it does not recognise, and a request made server-side sends no
 * origin to refuse.
 *
 * Counted separately and more tightly than the chat. A lead costs nothing to
 * make and lands in somebody's queue, which is the shape of thing that gets
 * flooded rather than used.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const limited = check("jade-lead", identify(request), LIMITS.jadeLead);
    if (!limited.ok) return tooManyRequests(limited);

    const body = await jsonObject(request);
    if (!body.ok) return jsonError(body.reason, 400);

    const email = typeof body.value.email === "string" ? body.value.email.trim() : "";
    if (!email.includes("@")) return jsonError("A valid email is required", 400);

    /*
     * Rebuilt field by field rather than forwarded.
     *
     * The widget sends the last few turns along so whoever picks the lead up
     * can see what was being asked. That is the caller's text, so each field
     * is taken by name and cut to a length — a route that passes a body
     * straight through is a route that will forward whatever is added to it
     * later, including things nobody meant to send.
     */
    const upstream = await fetch(CHAT_CUSTOMER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: text(body.value.type, 40) || "contact_request",
        email: email.slice(0, 200),
        message: text(body.value.message, 1000),
        conversation: text(body.value.conversation, 4000),
        page_url: text(body.value.page_url, 500),
        language: text(body.value.language, 5),
        created_at: new Date().toISOString(),
      }),
    });

    if (!upstream.ok) {
      console.error(`Jade lead endpoint returned ${upstream.status}`);
      // Reported as accepted on purpose. The person has done their part, and
      // telling them their email failed helps nobody — this is ours to retry.
      return Response.json({ ok: true });
    }

    return Response.json({ ok: true });
  });
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}
