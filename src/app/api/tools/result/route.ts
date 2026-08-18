import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { handled, jsonError } from "@/lib/api/session";
import { WEBSITE } from "@/lib/company";
import { sendEmail } from "@/lib/notify/transports";
import { TOOLS } from "@/lib/tools";
import {
  type ResultDimension,
  type ResultEmail,
  looksLikeEmail,
  resultHtml,
  resultText,
} from "@/lib/result-email";

/**
 * Send somebody the result they just read.
 *
 * No sign-in, because the tools do not need one — which means this is an open
 * endpoint that sends mail, and the two things it must not become are a way to
 * post arbitrary text to a stranger's inbox, or a way to send a lot of it.
 *
 * So everything that arrives is bounded before it is rendered: each field is
 * truncated, each list has a length, each bar value is clamped to the 0–100
 * the template draws on, and the whole lot is escaped on the way into the
 * HTML. What a caller cannot do is get a link of their choosing in front of
 * somebody — the only links in the message are the page it came from and the
 * other tools, and those are read off our own list from the slug rather than
 * taken from the body. An open endpoint that will mail an arbitrary URL to an
 * arbitrary address is a phishing relay with our return address on it.
 */

const MAX_FIELD = 600;

/** How many other tools the message offers. Three is a footer, six is a menu. */
const RELATED = 3;

function clean(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_FIELD) : "";
}

/** Undefined rather than "", so an absent section stays absent in the template. */
function optional(value: unknown): string | undefined {
  const text = clean(value).trim();
  return text || undefined;
}

function lines(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.slice(0, 8).map(clean).filter(Boolean);
  return list.length ? list : undefined;
}

/**
 * The bars, with the value forced onto the 0–100 the template draws on.
 *
 * A width comes straight off this number, and a caller sending 4000 would
 * otherwise get a table cell four thousand percent wide in somebody's inbox.
 */
function dimensions(value: unknown): ResultDimension[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const list = value.flatMap((entry): ResultDimension[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;
    const label = clean(row.label).trim();
    const raw = Number(row.value);
    if (!label || !Number.isFinite(raw)) return [];
    return [
      {
        label,
        value: Math.round(Math.max(0, Math.min(100, raw))),
        focus: row.focus === true,
      },
    ];
  });

  return list.length ? list.slice(0, 8) : undefined;
}

function focus(value: unknown): { label: string; action: string } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const row = value as Record<string, unknown>;
  const label = clean(row.label).trim();
  const action = clean(row.action).trim();
  return label && action ? { label, action } : undefined;
}

/**
 * The page it came from, built from the slug rather than taken from the body.
 *
 * The obvious version of this reads `window.location.href` off the client and
 * puts it in the button, which works right up until somebody posts their own
 * address there — at which point this endpoint mails a link of their choosing
 * to a stranger, from us, under the subject line of a wellness result. An
 * unrecognised slug lands on the hub.
 */
function pageUrl(slug: string): string {
  return TOOLS.some((tool) => tool.slug === slug && tool.live)
    ? `${WEBSITE}/assessments/${slug}`
    : `${WEBSITE}/assessments`;
}

/**
 * Three other tools, chosen here rather than sent by the caller.
 *
 * The rotation is deliberate: the list is walked from wherever this tool sits,
 * so somebody who takes two assessments does not get the same three
 * suggestions twice. An unknown slug simply starts from the top, which is the
 * right answer for a caller that made one up.
 */
function relatedTools(slug: string): { name: string; url: string }[] {
  const live = TOOLS.filter((tool) => tool.live);
  const at = live.findIndex((tool) => tool.slug === slug);

  return Array.from({ length: Math.min(RELATED, live.length - 1) }, (_, offset) => {
    const tool = live[(Math.max(at, 0) + offset + 1) % live.length];
    return { name: tool.name, url: `${WEBSITE}/assessments/${tool.slug}` };
  }).filter((tool) => !tool.url.endsWith(`/${slug}`));
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

    const slug = clean(body.slug).trim();

    const result: ResultEmail = {
      toolName: clean(body.toolName) || "Your result",
      score: clean(body.score),
      band: clean(body.band),
      summary: clean(body.summary),
      headline: optional(body.headline),
      story: optional(body.story),
      dimensions: dimensions(body.dimensions),
      insights: lines(body.insights),
      focus: focus(body.focus),
      steps: lines(body.steps),
      related: relatedTools(slug),
      url: pageUrl(slug),
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
