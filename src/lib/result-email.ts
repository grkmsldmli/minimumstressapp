import { BRAND, WEBSITE } from "./company";

/**
 * The result, as an email somebody asked for.
 *
 * Asked for is the whole design. The pages this replaces put an email field
 * between a person and the score they had just spent four minutes earning, and
 * posted the address to Klaviyo before showing them anything. That collects
 * addresses; it does not collect people who want to hear from you, and a
 * meaningful share of what it collects is typed to get past the gate.
 *
 * Here the result is on screen first and this is an offer. Fewer addresses,
 * and the ones that arrive belong to somebody who wanted the email.
 */

export interface ResultEmail {
  /** "Burnout Test" — what they took. */
  toolName: string;
  /** The headline number, already formatted: "57" or "18". */
  score: string;
  /** The band, in words: "Burning". */
  band: string;
  /** The paragraph under the score. */
  summary: string;
  /** Optional breakdown lines: ["Sleep 40", "Body 67"]. */
  breakdown?: string[];
  /** Where to read it again. */
  url: string;
}

/**
 * Plain text as well as HTML, because a mail client that refuses images and
 * styles still has to be readable — and because a text part measurably keeps
 * a message out of spam folders.
 */
export function resultText(result: ResultEmail): string {
  const lines = [
    `${result.toolName} — your result`,
    "",
    `${result.score} · ${result.band}`,
    "",
    result.summary,
  ];

  if (result.breakdown?.length) {
    lines.push("", ...result.breakdown);
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

/** Escaped, because every field here is derived from what somebody chose. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function resultHtml(result: ResultEmail): string {
  const breakdown = result.breakdown?.length
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:24px 0">${result.breakdown
        .map(
          (line) =>
            `<tr><td style="padding:8px 0;border-bottom:1px solid #eef2f6;font-size:14px;color:#5f6673">${escapeHtml(line)}</td></tr>`,
        )
        .join("")}</table>`
    : "";

  /*
   * Tables and inline styles, which is not how anything else here is written.
   * Mail clients are twenty years behind browsers — Outlook still renders
   * through Word — and a flexbox layout collapses into a single column of
   * unstyled text in a way nobody sees until it is in somebody's inbox.
   */
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escapeHtml(result.toolName)}</title></head>
<body style="margin:0;padding:0;background:#f8fbfd">
<table role="presentation" style="width:100%;border-collapse:collapse;background:#f8fbfd">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" style="width:100%;max-width:520px;border-collapse:collapse;background:#ffffff;border:1px solid #e7eef6;border-radius:16px">
<tr><td style="padding:32px">
  <p style="margin:0;font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:#0EA5E9">${escapeHtml(BRAND)}</p>
  <h1 style="margin:12px 0 0;font-size:22px;line-height:1.3;color:#0F2F55;font-weight:600">${escapeHtml(result.toolName)}</h1>

  <p style="margin:24px 0 0;font-size:44px;line-height:1;color:#0F2F55;font-weight:600">${escapeHtml(result.score)}
    <span style="font-size:16px;font-weight:400;color:#5f6673">&nbsp;${escapeHtml(result.band)}</span>
  </p>

  <p style="margin:20px 0 0;font-size:15px;line-height:1.7;color:#5f6673">${escapeHtml(result.summary)}</p>

  ${breakdown}

  <p style="margin:24px 0 0">
    <a href="${escapeHtml(result.url)}" style="display:inline-block;padding:12px 24px;background:#0F2F55;color:#ffffff;text-decoration:none;border-radius:999px;font-size:14px">Take it again</a>
  </p>

  <p style="margin:28px 0 0;padding-top:20px;border-top:1px solid #eef2f6;font-size:12px;line-height:1.7;color:#8a94a3">
    This is information, not medical advice, and not a diagnosis. ${escapeHtml(BRAND)} is not a medical provider.
    You are getting this because you asked for it on ${escapeHtml(WEBSITE)} — we did not add you to anything.
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/** Roughly, and only to catch a typo before it reaches the mail provider. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}
