import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError } from "@/lib/api/session";
import { jsonObject } from "@/lib/api/validate";
import Anthropic from "@anthropic-ai/sdk";

import {
  JADE_MAX_TOKENS,
  JADE_MODEL,
  JADE_SYSTEM_PROMPT,
  detectLanguage,
  languageDirective,
} from "@/lib/jade";

/**
 * The chat call, made from here rather than from the browser.
 *
 * Server-side for three reasons: the API key never reaches the client, the
 * system prompt is defined here and never accepted from the caller, and the
 * request can be counted and rate limited before it costs anything.
 *
 * The model is our own Anthropic account and nothing else — there is no longer
 * a shared upstream proxy behind this. Without a key there is nobody to ask, so
 * the call fails cleanly (the widget shows a connection notice) rather than
 * reaching for anything off-platform.
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
     * Our own model, or nothing. Without a key there is nobody to ask, so this
     * fails cleanly rather than reaching for the old shared proxy — the widget
     * treats a 502 the same as a dropped connection and asks them to retry. The
     * key has to be set in the deploy for model-backed answers to work; the
     * built-in routing table answers either way.
     */
    if (!process.env.ANTHROPIC_API_KEY) {
      return jsonError("Luna is unavailable right now", 502);
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
