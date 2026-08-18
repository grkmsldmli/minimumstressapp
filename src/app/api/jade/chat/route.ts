import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError } from "@/lib/api/session";
import { jsonObject } from "@/lib/api/validate";
import { CHAT_PROXY_URL, JADE_SYSTEM_PROMPT } from "@/lib/jade";

/**
 * The chat call, made from here rather than from the browser.
 *
 * The proxy keeps an allowlist of origins and knows exactly one:
 * `https://minimumstress.com`. Anything else — a staging subdomain, www,
 * localhost — gets a 403, and the visitor is shown a connection error while
 * the network is perfectly fine. That allowlist lives in a different Vercel
 * project, and waiting on a change there to make the widget work anywhere is
 * a dependency this did not need.
 *
 * A server-to-server request sends no Origin header at all, so the allowlist
 * has nothing to refuse. The widget now talks to this route, which is
 * same-origin by definition and works on every hostname the site is ever
 * served from.
 *
 * Two things fall out of it. The proxy's address stops being in the client
 * bundle, and the prompt goes with it — neither was secret, but neither is
 * anybody's business either. And the request can be counted before it costs
 * anything, which the browser-side cap never really did: localStorage is the
 * caller's to clear, and a script does not load the page.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    const limited = check("jade", identify(request), LIMITS.jade);
    if (!limited.ok) return tooManyRequests(limited);

    const body = await jsonObject(request);
    if (!body.ok) return jsonError(body.reason, 400);

    /*
     * The turns, and nothing else from the caller.
     *
     * The system prompt is added here rather than accepted from the body. A
     * route that forwards a caller-supplied prompt to a model on our account
     * is a free model, running whatever anybody sends it, billed to us.
     */
    const messages = Array.isArray(body.value.messages) ? body.value.messages : null;
    if (!messages || messages.length === 0) return jsonError("messages is required", 400);

    const turns = messages
      .slice(-6)
      .filter(
        (turn): turn is { role: string; content: string } =>
          !!turn &&
          typeof turn === "object" &&
          typeof (turn as { content?: unknown }).content === "string",
      )
      .map((turn) => ({
        role: turn.role === "assistant" ? "assistant" : "user",
        // A cap per turn, so a long paste cannot become a long bill.
        content: turn.content.slice(0, 1500),
      }));

    if (turns.length === 0) return jsonError("messages is required", 400);

    const upstream = await fetch(CHAT_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        max_tokens: 180,
        system: JADE_SYSTEM_PROMPT,
        messages: turns,
      }),
    });

    const text = await upstream.text();

    if (!upstream.ok) {
      // Logged with the status, because the two failures upstream look the
      // same from the widget and lead to different places.
      console.error(`Jade proxy returned ${upstream.status}: ${text.slice(0, 200)}`);
      return jsonError("Jade is unavailable right now", 502);
    }

    /*
     * Passed through as-is. The proxy has returned several shapes over its
     * life and the widget already reads all of them; re-wrapping here would
     * mean two places to update the next time it changes.
     */
    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}
