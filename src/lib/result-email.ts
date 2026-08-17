import { BRAND, WEBSITE } from "./company";

/**
 * The result, as an email somebody asked for.
 *
 * Asked for is the whole design. The pages this replaces put an email field
 * between a person and the score they had just spent four minutes earning, and
 * posted the address to Klaviyo before showing anything. That collects
 * addresses; it does not collect people who want to hear from you, and a
 * meaningful share of what it collects is typed to get past the gate.
 *
 * What arrives is the whole result rather than the number. An email carrying
 * "37 · Burning" and nothing else is a receipt for something the reader has
 * already seen, and it earns nothing — the part worth keeping is the part that
 * is about them: what the band actually says, which dimension came out
 * thinnest, and the one thing to change first. Every tool here already
 * produces all of it for the page; the first version of this simply threw it
 * away on the way to the inbox.
 *
 * Nothing in here is generic. Two people with the same score get the same
 * band, but the bars, the focus and the order of the sections come from their
 * own answers — which is the difference between a result and a form letter.
 */

export interface ResultDimension {
  label: string;
  /** 0–100, on whatever scale the tool runs. */
  value: number;
  /** True for the one the advice below is about. */
  focus?: boolean;
}

export interface ResultEmail {
  /** "Burnout Test" — what they took. */
  toolName: string;
  /** The headline number, already formatted: "37", "18". */
  score: string;
  /** The band, in words: "Burning". */
  band: string;
  /** The line under the score. */
  summary: string;
  /** The band's own headline — a sentence, not a label. */
  headline?: string;
  /** The band's paragraph: what this pattern usually looks like. */
  story?: string;
  /** Per dimension, with the thinnest marked. */
  dimensions?: ResultDimension[];
  /** What the band says it means, as bullets. */
  insights?: string[];
  /** The dimension to start on, and the thing to do about it. */
  focus?: { label: string; action: string };
  /** The week ahead, numbered. */
  steps?: string[];
  /** Two or three other tools, chosen server-side. */
  related?: { name: string; url: string }[];
  /** Where to read this again. */
  url: string;
}

/**
 * Plain text as well as HTML, because a client that refuses styles still has
 * to be readable — and because a message with no text part is likelier to be
 * filed as spam.
 */
export function resultText(result: ResultEmail): string {
  const lines = [
    `${result.toolName} — your result`,
    "",
    `${result.score} · ${result.band}`,
    "",
    result.summary,
  ];

  if (result.headline) lines.push("", result.headline);
  if (result.story) lines.push("", result.story);

  if (result.dimensions?.length) {
    lines.push("", "Where it sits:");
    for (const dimension of result.dimensions) {
      lines.push(
        `  ${dimension.label}: ${dimension.value}${dimension.focus ? "   <- start here" : ""}`,
      );
    }
  }

  if (result.insights?.length) {
    lines.push("", "What this means:");
    for (const insight of result.insights) lines.push(`  - ${insight}`);
  }

  if (result.focus) {
    lines.push("", `Start here — ${result.focus.label}`, result.focus.action);
  }

  if (result.steps?.length) {
    lines.push("", "Your next seven days:");
    result.steps.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
  }

  if (result.related?.length) {
    lines.push("", "Other tools, also free and also without a gate:");
    for (const tool of result.related) lines.push(`  ${tool.name} — ${tool.url}`);
  }

  lines.push(
    "",
    `Take it again: ${result.url}`,
    "",
    "This is information, not medical advice, and not a diagnosis.",
    `${BRAND} is not a medical provider.`,
    WEBSITE,
  );

  return lines.join("\n");
}

/** Escaped, because every field here comes from somewhere. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const INK = "#1a2744";
const BODY = "#5f6673";
const MUTED = "#8a94a3";
const LINE = "#e7eef6";
const WASH = "#f8fbfd";
const ACCENT = "#1D9E75";

/**
 * A bar drawn as a table cell, not a div with a width.
 *
 * Outlook renders through Word, which ignores most of a stylesheet but has
 * always understood a table cell with a background colour. This is the one
 * shape that survives every client, which is why mail has looked like this
 * for twenty years.
 */
function bar(dimension: ResultDimension): string {
  const width = Math.max(2, Math.min(100, Math.round(dimension.value)));
  const colour = dimension.focus ? ACCENT : "#c9d6e3";

  return (
    '<tr><td style="padding:12px 0 0;font-size:14px;color:' +
    (dimension.focus ? INK : BODY) +
    '">' +
    escapeHtml(dimension.label) +
    (dimension.focus
      ? ' <span style="font-size:12px;color:' + ACCENT + '">start here</span>'
      : "") +
    '</td><td align="right" style="padding:12px 0 0;font-size:14px;color:' +
    MUTED +
    '">' +
    width +
    "</td></tr>" +
    '<tr><td colspan="2" style="padding:6px 0 0">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
    'style="border-collapse:separate;background:#eef2f6;border-radius:99px">' +
    '<tr><td width="' +
    width +
    '%" style="height:8px;background:' +
    colour +
    ';border-radius:99px;font-size:0;line-height:0">&nbsp;</td>' +
    '<td style="font-size:0;line-height:0">&nbsp;</td></tr></table></td></tr>'
  );
}

function section(title: string, inner: string): string {
  return (
    '<p style="margin:30px 0 0;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:' +
    MUTED +
    '">' +
    title +
    "</p>" +
    inner
  );
}

export function resultHtml(result: ResultEmail): string {
  const headline = result.headline
    ? '<h2 style="margin:26px 0 0;font-size:20px;line-height:1.4;color:' +
      INK +
      ';font-weight:600">' +
      escapeHtml(result.headline) +
      "</h2>"
    : "";

  const story = result.story
    ? '<p style="margin:12px 0 0;font-size:15px;line-height:1.8;color:' +
      BODY +
      '">' +
      escapeHtml(result.story) +
      "</p>"
    : "";

  const dimensions = result.dimensions?.length
    ? section(
        "Where it sits",
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
          'style="border-collapse:collapse;margin:2px 0 0">' +
          result.dimensions.map(bar).join("") +
          "</table>",
      )
    : "";

  const insights = result.insights?.length
    ? section(
        "What this means",
        result.insights
          .map(
            (insight) =>
              '<p style="margin:10px 0 0;font-size:14.5px;line-height:1.75;color:' +
              BODY +
              '">&bull;&nbsp; ' +
              escapeHtml(insight) +
              "</p>",
          )
          .join(""),
      )
    : "";

  /*
   * The one thing to do first, in its own box.
   *
   * A result that lists five things somebody could work on is a result nobody
   * works on. The page picks the thinnest dimension and names it; the email
   * carries that same pick rather than repeating the list.
   */
  const focus = result.focus
    ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
      'style="border-collapse:collapse;margin:28px 0 0">' +
      '<tr><td width="3" style="background:' +
      ACCENT +
      ';font-size:0;line-height:0">&nbsp;</td>' +
      '<td style="padding:18px 20px;background:' +
      WASH +
      '">' +
      '<p style="margin:0;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:' +
      ACCENT +
      '">Start here</p>' +
      '<p style="margin:8px 0 0;font-size:15px;font-weight:600;color:' +
      INK +
      '">' +
      escapeHtml(result.focus.label) +
      "</p>" +
      '<p style="margin:8px 0 0;font-size:14.5px;line-height:1.75;color:' +
      BODY +
      '">' +
      escapeHtml(result.focus.action) +
      "</p></td></tr></table>"
    : "";

  /*
   * Numbers in a table cell rather than an <ol>. Mail clients disagree about
   * list indentation badly enough that a three-item list can arrive with its
   * markers cropped off the left edge.
   */
  const steps = result.steps?.length
    ? section(
        "Your next seven days",
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
          'style="border-collapse:collapse;margin:4px 0 0">' +
          result.steps
            .map(
              (step, index) =>
                '<tr><td width="26" valign="top" style="padding:12px 10px 0 0;font-size:13px;' +
                "font-weight:600;color:" +
                ACCENT +
                '">' +
                (index + 1) +
                '.</td><td style="padding:12px 0 0;font-size:14.5px;line-height:1.7;color:' +
                BODY +
                '">' +
                escapeHtml(step) +
                "</td></tr>",
            )
            .join("") +
          "</table>",
      )
    : "";

  const related = result.related?.length
    ? section(
        "While you are here",
        result.related
          .map(
            (tool) =>
              '<p style="margin:10px 0 0;font-size:14.5px"><a href="' +
              escapeHtml(tool.url) +
              '" style="color:' +
              INK +
              '">' +
              escapeHtml(tool.name) +
              "</a></p>",
          )
          .join("") +
          '<p style="margin:10px 0 0;font-size:13px;line-height:1.7;color:' +
          MUTED +
          '">All free, and none of them ask for your address before showing you the result.</p>',
      )
    : "";

  /*
   * Tables and inline styles, which is not how anything else in this codebase
   * is written. Mail clients are twenty years behind browsers, a stylesheet in
   * the head is stripped by Gmail, and a flexbox layout arrives as one column
   * of unstyled text — which nobody sees until it is in somebody's inbox.
   */
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width"><title>' +
    escapeHtml(result.toolName) +
    "</title></head>" +
    '<body style="margin:0;padding:0;background:#eef3f8;' +
    '-webkit-font-smoothing:antialiased;font-family:-apple-system,BlinkMacSystemFont,' +
    '\'Segoe UI\',Helvetica,Arial,sans-serif">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
    'style="border-collapse:collapse;background:#eef3f8">' +
    '<tr><td align="center" style="padding:32px 16px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ' +
    'style="max-width:560px;border-collapse:collapse;background:#ffffff;border:1px solid ' +
    LINE +
    ';border-radius:16px">' +
    '<tr><td style="padding:34px 32px 0">' +
    '<p style="margin:0;font-size:11px;letter-spacing:1.8px;text-transform:uppercase;color:' +
    MUTED +
    '">' +
    escapeHtml(BRAND) +
    "</p>" +
    '<p style="margin:8px 0 0;font-size:16px;color:' +
    INK +
    '">' +
    escapeHtml(result.toolName) +
    "</p>" +
    /*
     * The score, then the band beside it. Never the score alone — these tools
     * do not agree on which direction is good news, and a bare 68 is a high
     * cortisol load on one page and a healthy gut on another.
     */
    '<p style="margin:24px 0 0;font-size:56px;line-height:1;color:' +
    INK +
    ';font-weight:600">' +
    escapeHtml(result.score) +
    '<span style="font-size:17px;font-weight:400;color:' +
    BODY +
    '">&nbsp;&nbsp;' +
    escapeHtml(result.band) +
    "</span></p>" +
    '<p style="margin:16px 0 0;font-size:15px;line-height:1.75;color:' +
    BODY +
    '">' +
    escapeHtml(result.summary) +
    "</p>" +
    headline +
    story +
    dimensions +
    insights +
    focus +
    steps +
    related +
    '<p style="margin:32px 0 0"><a href="' +
    escapeHtml(result.url) +
    '" style="display:inline-block;padding:13px 26px;background:' +
    INK +
    ';color:#ffffff;text-decoration:none;border-radius:999px;font-size:14px">' +
    "Take it again</a></p>" +
    "</td></tr>" +
    '<tr><td style="padding:30px 32px 32px">' +
    '<p style="margin:0;padding-top:22px;border-top:1px solid #eef2f6;font-size:12px;' +
    "line-height:1.7;color:" +
    MUTED +
    '">This is information, not medical advice, and not a diagnosis. It scores what you told ' +
    "it about your own week, which is a useful thing to know and the limit of what a set of " +
    "questions can do. " +
    escapeHtml(BRAND) +
    " is not a medical provider.</p>" +
    '<p style="margin:12px 0 0;font-size:12px;line-height:1.7;color:' +
    MUTED +
    '">You are getting this because you asked for it on <a href="' +
    escapeHtml(WEBSITE) +
    '" style="color:' +
    BODY +
    '">' +
    escapeHtml(WEBSITE.replace(/^https:\/\//, "")) +
    "</a>. We did not add you to a list, and there is nothing to unsubscribe from.</p>" +
    "</td></tr></table></td></tr></table></body></html>"
  );
}

/** Roughly, and only to catch a typo before it reaches the mail provider. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}
