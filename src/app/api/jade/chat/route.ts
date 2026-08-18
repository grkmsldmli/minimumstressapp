import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError } from "@/lib/api/session";
import { jsonObject } from "@/lib/api/validate";
import Anthropic from "@anthropic-ai/sdk";

import {
  CHAT_PROXY_URL,
  JADE_MAX_TOKENS,
  JADE_MODEL,
  JADE_SYSTEM_PROMPT,
  detectLanguage,
  languageDirective,
} from "@/lib/jade";

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
      .map((turn): Anthropic.MessageParam => ({
        role: turn.role === "assistant" ? "assistant" : "user",
        // A cap per turn, so a long paste cannot become a long bill.
        content: turn.content.slice(0, 1500),
      }));

    if (turns.length === 0) return jsonError("messages is required", 400);

    /*
     * The language, from the last thing they wrote, stated as a fact at the
     * end of the prompt. Detected here rather than taken from the body,
     * because it is the sort of field a caller could set to anything.
     *
     * `content` widens to string | ContentBlockParam[] on MessageParam; every
     * turn this route builds carries a string, and a block array would have
     * no language to read anyway.
     */
    const latest = turns[turns.length - 1]?.content;
    const system =
      JADE_SYSTEM_PROMPT +
      languageDirective(detectLanguage(typeof latest === "string" ? latest : ""));

    /*
     * Our own model when we have a key, the old proxy when we do not.
     *
     * The proxy was never ours to configure: it ignored the `model` field —
     * an invented model id still came back with a reply — and ignored
     * `max_tokens` too, so a five-token cap returned fifty words. Both of
     * those are the parts you tune, which is the argument for calling the
     * API directly.
     *
     * The fallback stays until the key is set in the deploy, so a missing
     * environment variable degrades to what already worked instead of taking
     * the chat down.
     */
    if (!process.env.ANTHROPIC_API_KEY) {
      return await viaLegacyProxy(system, turns);
    }

    const anthropic = new Anthropic();

    const message = await anthropic.messages.create({
      model: JADE_MODEL,
      max_tokens: JADE_MAX_TOKENS,
      /*
       * Off, deliberately. Sonnet 5 thinks by default, and this is a chat
       * bubble somebody is watching — the questions worth thinking about are
       * answered from the table without a model at all.
       */
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
      system,
      messages: turns,
    });

    const reply = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    /*
     * Safety classifiers can decline a request outright — an ordinary 200
     * with an empty body. Reading content[0] without checking this is how it
     * surfaces as a crash rather than as a refusal.
     */
    if (message.stop_reason === "refusal" || !reply) {
      console.error(`Jade: no reply (stop_reason ${message.stop_reason})`);
      return jsonError("Jade is unavailable right now", 502);
    }

    return Response.json({ reply });
  });
}

/**
 * The old path, kept as a fallback.
 *
 * Same request the widget has always made, minus the browser origin the
 * proxy's allowlist refuses. Deletable the day the key is set everywhere.
 */
async function viaLegacyProxy(
  system: string,
  turns: Anthropic.MessageParam[],
): Promise<Response> {
  const upstream = await fetch(CHAT_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ max_tokens: JADE_MAX_TOKENS, system, messages: turns }),
  });

  const text = await upstream.text();

  if (!upstream.ok) {
    console.error(`Jade proxy returned ${upstream.status}: ${text.slice(0, 200)}`);
    return jsonError("Jade is unavailable right now", 502);
  }

  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
