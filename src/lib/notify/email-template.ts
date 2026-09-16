import { APP_URL, BRAND, SUPPORT_EMAIL } from "../company";
import { formatCents } from "../money";
import type { Message, MessageContext, NotificationKind } from "./messages";

type Tone = "success" | "info" | "attention" | "danger" | "neutral";

interface Presentation {
  status: string;
  tone: Tone;
  cta: string;
  path: string;
}

interface Detail {
  label: string;
  value: string;
}

const PRESENTATION = {
  booking_confirmed: confirmation("Confirmed", "View your booking"),
  host_new_booking: confirmation("Booked", "View the booking"),
  host_new_request: attention("Action needed", "Review the request"),
  request_submitted: information("Request sent", "View your request"),
  host_request_reminder: attention("Awaiting response", "Review the request"),
  request_approved: confirmation("Approved", "View your booking"),
  request_declined: neutral("Not approved", "Open Minimum Stress"),
  request_expired: neutral("Expired", "Find another space"),
  access_code_ready: information("Access ready", "View access details"),
  new_message: information("New message", "Read the message"),
  review_prompt: information("Review ready", "Leave a review"),
  review_reminder: neutral("Review window open", "Leave a review"),
  cancelled_by_practitioner: neutral("Cancelled", "View your bookings"),
  cancelled_by_host: danger("Studio cancellation", "View your bookings"),
  reliability_warning: attention("Account notice", "Review your account"),
  reliability_suspended: danger("Bookings paused", "Review your account"),
  host_payout_sent: confirmation("Sent to Stripe", "View payouts", "/host/payouts"),
  payout_failed: danger("Action needed", "Update payout details"),
  safety_escalation: danger("Urgent review", "Open the safety queue", "/admin/trust"),
  account_change_requested: attention("Review needed", "Open the request", "/admin/trust"),
  refund_requested: attention("Response requested", "Open the booking"),
  refund_decided: information("Decision made", "View the booking"),
  refund_taken_back: danger("Payout adjusted", "View the booking"),
  claim_filed: attention("Response requested", "Open the booking"),
  claim_decided: information("Decision made", "View the booking"),
  staff_waiting: attention("Queue update", "Open the admin queue", "/admin"),
  insurance_verified: confirmation("Verified", "Review your profile"),
  insurance_rejected: danger("Action needed", "Update your insurance"),
  work_opportunity: information("Opportunity", "View the opportunity"),
  work_interest_received: information("New interest", "Review availability"),
  work_confirmed: confirmation("Confirmed", "View the coverage"),
  work_request_cancelled: neutral("Cancelled", "View other coverage"),
  work_selection_withdrawn: danger("Coverage needed", "Post coverage again"),
} satisfies Record<NotificationKind, Presentation>;

const TONES: Record<Tone, { background: string; foreground: string; border: string }> = {
  success: { background: "#EAF8F0", foreground: "#176B43", border: "#BFE7CF" },
  info: { background: "#EAF3FF", foreground: "#174E8C", border: "#C6DCF5" },
  attention: { background: "#FFF6DC", foreground: "#805600", border: "#EED89A" },
  danger: { background: "#FDEEEE", foreground: "#982F36", border: "#F2C6C9" },
  neutral: { background: "#EEF2F6", foreground: "#43566D", border: "#D8E0E8" },
};

const APP_ORIGIN = new URL(APP_URL);

function confirmation(status: string, cta: string, path = "/"): Presentation {
  return { status, cta, path, tone: "success" };
}

function information(status: string, cta: string, path = "/"): Presentation {
  return { status, cta, path, tone: "info" };
}

function attention(status: string, cta: string, path = "/"): Presentation {
  return { status, cta, path, tone: "attention" };
}

function danger(status: string, cta: string, path = "/"): Presentation {
  return { status, cta, path, tone: "danger" };
}

function neutral(status: string, cta: string, path = "/"): Presentation {
  return { status, cta, path, tone: "neutral" };
}

/**
 * Turn a local app path (or the same absolute origin) into an email-safe URL.
 *
 * Email links are an especially bad place to be permissive: a provider or
 * stored context value must never turn a trusted Minimum Stress button into a
 * redirect to another origin. Backslashes and control characters are rejected
 * before URL parsing because browsers and mail clients do not all normalise
 * them the same way.
 */
export function appEmailUrl(candidate: string): string {
  const value = candidate.trim();
  if (!value || /[\\\u0000-\u001F\u007F]/.test(value)) {
    throw new RangeError("Email action URL must be a safe Minimum Stress path");
  }

  const isLocalPath = value.startsWith("/") && !value.startsWith("//");
  if (!isLocalPath && !/^https:\/\//i.test(value)) {
    throw new RangeError("Email action URL must be a safe Minimum Stress path");
  }

  let parsed: URL;
  try {
    parsed = new URL(value, APP_ORIGIN);
  } catch {
    throw new RangeError("Email action URL must be a safe Minimum Stress path");
  }

  if (
    parsed.origin !== APP_ORIGIN.origin ||
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password
  ) {
    throw new RangeError("Email action URL must stay on Minimum Stress");
  }

  return parsed.href;
}

/** Build the immutable HTML paired with an existing plain-text notification. */
export function renderNotificationEmail(
  kind: NotificationKind,
  message: Pick<Message, "subject" | "body">,
  context: MessageContext,
): string {
  const presentation = PRESENTATION[kind];
  const action = kind === "staff_waiting" && context.queueUrl
    ? context.queueUrl
    : presentation.path;

  return emailDocument({
    subject: message.subject,
    body: message.body,
    preview: previewFrom(message),
    status: presentation.status,
    tone: presentation.tone,
    details: detailsFor(kind, context, presentation.status),
    cta: presentation.cta,
    actionUrl: appEmailUrl(action),
  });
}

/** Corporate fallback for direct operational emails that do not have a kind. */
export function renderPlainEmail(message: Pick<Message, "subject" | "body">): string {
  return emailDocument({
    subject: message.subject,
    body: message.body,
    preview: previewFrom(message),
    status: "Account update",
    tone: "info",
    details: [{ label: "Status", value: "Account update" }],
    cta: "Open Minimum Stress",
    actionUrl: appEmailUrl("/"),
  });
}

function detailsFor(
  kind: NotificationKind,
  context: MessageContext,
  status: string,
): Detail[] {
  const rows: Detail[] = [{ label: "Status", value: status }];
  const add = (label: string, value: string | number | null | undefined) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      rows.push({ label, value: String(value) });
    }
  };
  const money = (value: number | undefined) =>
    value === undefined ? undefined : formatCents(value);

  switch (kind) {
    case "booking_confirmed":
    case "host_new_booking":
    case "host_new_request":
    case "request_submitted":
    case "host_request_reminder":
    case "request_approved":
    case "request_declined":
    case "request_expired":
    case "new_message":
    case "review_prompt":
    case "review_reminder":
    case "cancelled_by_practitioner":
    case "cancelled_by_host":
    case "refund_requested":
    case "refund_decided":
    case "refund_taken_back":
    case "claim_filed":
    case "claim_decided":
      add("Space", context.spaceName);
      add("When", context.when);
      if (
        kind === "host_new_request" ||
        kind === "request_submitted" ||
        kind === "host_request_reminder"
      ) {
        add("Purpose", context.purpose);
        add("People", context.attendees);
        add("Decision by", context.deadline);
      }
      if (kind === "refund_decided" || kind === "cancelled_by_host") {
        add("Refund", money(context.refundedCents));
      } else if (kind === "cancelled_by_practitioner") {
        add("Charged", money(context.chargedCents));
        add("Refund", money(context.refundedCents));
      } else {
        add("Amount", money(context.amountCents));
      }
      return rows;

    case "host_payout_sent":
      add("Space", context.spaceName);
      add("Session", context.when);
      add("Sent to Stripe", money(context.amountCents));
      return rows;

    case "access_code_ready":
      add("Space", context.spaceName);
      add("When", context.when);
      add("Address", context.address);
      add("Door code", context.accessCode);
      return rows;

    case "reliability_warning":
    case "reliability_suspended":
      add("Late cancellations", context.strikes);
      add("Policy threshold", context.limit);
      add("Pause ends", context.until);
      return rows;

    case "safety_escalation":
      add("Space", context.spaceName);
      add("Reported by", context.role === "host" ? "Studio" : "Practitioner");
      return rows;

    case "account_change_requested":
      add("From", context.role);
      add("To", context.reason);
      return rows;

    case "payout_failed":
      add("Next step", "Update payout details");
      return rows;

    case "staff_waiting":
      add("Queue", "Command Center");
      return rows;

    case "insurance_verified":
    case "insurance_rejected":
      add("Coverage expires", context.until);
      return rows;

    case "work_opportunity":
    case "work_interest_received":
    case "work_confirmed":
    case "work_request_cancelled":
    case "work_selection_withdrawn":
      add("Class", context.className);
      add("Space", context.spaceName);
      add("When", context.when);
      add("Pay", money(context.amountCents));
      return rows;
  }
}

function previewFrom(message: Pick<Message, "subject" | "body">): string {
  const paragraph = message.body
    .split(/\n\n+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .find((part) => part && !/^Hi(?:\s|,|$)/i.test(part) && part !== `— ${BRAND}`);
  const value = paragraph ?? message.subject;
  return value.length > 150 ? `${value.slice(0, 147)}…` : value;
}

function bodyParagraphs(body: string): string {
  return body
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter((part) => part && part !== `— ${BRAND}`)
    .map(
      (part) =>
        `<p style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:24px;color:#30465F;">${escapeHtml(part).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

function detailRows(details: Detail[]): string {
  return details
    .map(
      ({ label, value }, index) => `
        <tr>
          <td style="${index ? "border-top:1px solid #E2E8F0;" : ""}padding:12px 0;width:38%;vertical-align:top;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:12px;line-height:18px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#66788C;">${escapeHtml(label)}</td>
          <td style="${index ? "border-top:1px solid #E2E8F0;" : ""}padding:12px 0 12px 16px;vertical-align:top;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:20px;font-weight:600;color:#16304E;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join("");
}

function emailDocument(input: {
  subject: string;
  body: string;
  preview: string;
  status: string;
  tone: Tone;
  details: Detail[];
  cta: string;
  actionUrl: string;
}): string {
  const tone = TONES[input.tone];

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${escapeHtml(input.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#F3F7FA;color:#16304E;word-spacing:normal;">
    <div aria-hidden="true" style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(input.preview)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background:#F3F7FA;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;border-collapse:separate;background:#FFFFFF;border:1px solid #DDE6EE;border-radius:16px;">
            <tr>
              <td style="padding:24px 28px 16px;border-bottom:1px solid #E5EBF1;font-family:Georgia,'Times New Roman',serif;font-size:21px;line-height:26px;font-weight:700;font-style:italic;color:#102A43;">${BRAND}</td>
            </tr>
            <tr>
              <td style="padding:30px 28px 12px;">
                <span role="status" aria-label="Message status: ${escapeHtml(input.status)}" style="display:inline-block;margin:0 0 16px;padding:6px 10px;border:1px solid ${tone.border};border-radius:999px;background:${tone.background};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:12px;line-height:16px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${tone.foreground};">${escapeHtml(input.status)}</span>
                <h1 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:28px;line-height:35px;letter-spacing:-.02em;color:#102A43;">${escapeHtml(input.subject)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 28px 4px;">${bodyParagraphs(input.body)}</td>
            </tr>
            <tr>
              <td style="padding:8px 28px 12px;">
                <div role="group" aria-label="Message details" style="padding:4px 18px;border:1px solid #DDE6EE;border-radius:12px;background:#F8FAFC;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${detailRows(input.details)}</table>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 34px;">
                <a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;padding:13px 20px;border-radius:9px;background:#12618C;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:20px;font-weight:700;text-decoration:none;color:#FFFFFF;">${escapeHtml(input.cta)}</a>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px;border-top:1px solid #E5EBF1;">
                <footer style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:12px;line-height:19px;color:#718096;">
                  This transactional email was sent by ${BRAND} because of activity on an account or service. Questions? ${SUPPORT_EMAIL}
                </footer>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** One escaping rule for element text and quoted attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
