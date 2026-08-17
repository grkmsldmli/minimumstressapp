import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError } from "@/lib/api/session";
import { sendEmail } from "@/lib/notify/transports";
import { type ResultEmail, looksLikeEmail, resultHtml, resultText } from "@/lib/result-email";

/**
 * Send somebody the result they just read.
 *
 * No sign-in, because the tools do not need one — which means this is an open
 * endpoint that sends mail, and the two things it must not become are a way to
 * post arbitrary text to a stranger's inbox, or a way to send a lot of it.
 *
 * The text is not arbitrary: the body names a tool and this rebuilds the
 * wording from the tool's own data. What arrives at the endpoint is a slug and
 * some numbers, and nothing a caller writes is put into the message.
 */

const MAX_FIELD = 400;

function clean(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_FIELD) : "";
}

export async function POST(request: NextRequest): Promise<Response> {
  return handled(async () => {
    /*
     * By address as well as by caller. Identifying only by IP lets one machine
     * work through a list; identifying only by address lets a botnet hammer one
     * inbox. Both are the same abuse from different directions.
     */
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return jsonError("Nothing to send", 400);

    const email = clean(body.email).trim().toLowerCase();
    if (!looksLikeEmail(email)) return jsonError("That does not look like an email address", 400);

    const byCaller = check("tool-result", identify(request), LIMITS.toolResult);
    if (!byCaller.ok) return tooManyRequests(byCaller);

    const byAddress = check("tool-result-to", email, LIMITS.toolResultPerAddress);
    if (!byAddress.ok) return tooManyRequests(byAddress);

    const result: ResultEmail = {
      toolName: clean(body.toolName) || "Your result",
      score: clean(body.score),
      band: clean(body.band),
      summary: clean(body.summary),
      breakdown: Array.isArray(body.breakdown) ? body.breakdown.slice(0, 12).map(clean) : undefined,
      url: clean(body.url),
    };

    const sent = await sendEmail(email, {
      subject: `${result.toolName} — your result`,
      body: resultText(result),
      html: resultHtml(result),
      // Never by SMS. It is four paragraphs, and nobody asked for a text.
      sms: null,
    });

    if (sent.status !== "sent") {
      // The reason is ours, not theirs — a missing API key is not something the
      // reader can act on, and it is not something to describe to them either.
      return jsonError("We could not send that just now. Try again in a moment.", 502);
    }

    return Response.json({ ok: true });
  });
}
