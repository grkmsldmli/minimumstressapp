import { APP_URL, BRAND, LEGAL_ENTITY, SUPPORT_EMAIL } from "../company";
import type { MarketingLifecycle } from "./lifecycle";

export const MARKETING_TEMPLATE_VERSION = 1;

interface CampaignCopy {
  subject: string;
  preview: string;
  heading: string;
  body: string;
  cta: string;
  path: string;
}

const COPY: Record<MarketingLifecycle, CampaignCopy> = {
  onboarding_incomplete: {
    subject: "Finish setting up Minimum Stress",
    preview: "Pick up where you left off.",
    heading: "Your account is ready when you are.",
    body: "Finish the few details left on your account so you can use the part of Minimum Stress built for your work.",
    cta: "Continue setup",
    path: "/",
  },
  host_listed_no_bookings: {
    subject: "Help practitioners find your studio",
    preview: "A quick listing check can make the right fit easier to see.",
    heading: "Make the right booking easier to spot.",
    body: "Review your availability, photos and listing details. Clear, current information helps practitioners decide with confidence without taking the conversation outside Minimum Stress.",
    cta: "Review your studio",
    path: "/",
  },
  browsed_no_booking: {
    subject: "Still looking for the right professional space?",
    preview: "Your next workspace may already be waiting.",
    heading: "Find a space that fits the way you work.",
    body: "Browse professional spaces with clear pricing, availability and booking protection kept inside Minimum Stress.",
    cta: "Browse spaces",
    path: "/",
  },
  first_booking_follow_up: {
    subject: "Make your next session easier",
    preview: "Your first completed booking can be the start of a smoother routine.",
    heading: "Ready for the next session?",
    body: "Return to Minimum Stress to book again, compare another professional space or keep your schedule moving in one protected place.",
    cta: "Open Minimum Stress",
    path: "/",
  },
  rebooking: {
    subject: "Ready to book your next session?",
    preview: "Keep your next booking, payment and communication together.",
    heading: "Keep the next booking simple.",
    body: "See current availability and keep payment, access details, messages and support together inside Minimum Stress.",
    cta: "Book your next space",
    path: "/",
  },
  dormant_reactivation: {
    subject: "Your Minimum Stress account is still ready",
    preview: "Come back whenever professional space or studio demand matters again.",
    heading: "Pick up where you left off.",
    body: "Your account remains available. Open Minimum Stress to see what is current for your work, with no need to move booking communication elsewhere.",
    cta: "Return to Minimum Stress",
    path: "/",
  },
  host_inventory_engagement: {
    subject: "Keep your studio availability working",
    preview: "Current hours help practitioners book with confidence.",
    heading: "Is your availability still accurate?",
    body: "A quick check keeps practitioners from asking about hours that no longer work and makes confirmed bookings easier for everyone.",
    cta: "Update availability",
    path: "/",
  },
};

export interface MarketingEmailSnapshot {
  subject: string;
  text: string;
  html: string;
  unsubscribeUrl: string;
}

export function renderMarketingEmail(
  campaign: MarketingLifecycle,
  unsubscribeToken: string,
  postalAddress: string,
): MarketingEmailSnapshot {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(unsubscribeToken)) {
    throw new RangeError("Marketing unsubscribe token must be a UUID");
  }
  const address = postalAddress.trim();
  if (!address || address.length > 300 || /[\u0000-\u001F\u007F]/.test(address)) {
    throw new RangeError("A bounded physical postal address is required for marketing email");
  }

  const copy = COPY[campaign];
  const actionUrl = new URL(copy.path, APP_URL).href;
  const unsubscribeUrl = new URL(
    `/api/marketing/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`,
    APP_URL,
  ).href;
  const footer = `${LEGAL_ENTITY} · ${address}`;
  const text = [
    copy.heading,
    "",
    copy.body,
    "",
    `${copy.cta}: ${actionUrl}`,
    "",
    "You receive this optional email because product news and offers are enabled in your Minimum Stress settings. Booking, payment, safety and account messages are separate.",
    `Unsubscribe: ${unsubscribeUrl}`,
    `${footer} · ${SUPPORT_EMAIL}`,
  ].join("\n");

  return {
    subject: copy.subject,
    text,
    unsubscribeUrl,
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${escapeHtml(copy.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#F3F7FA;color:#16304E;word-spacing:normal;">
    <div aria-hidden="true" style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(copy.preview)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background:#F3F7FA;">
      <tr><td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;border-collapse:separate;background:#FFFFFF;border:1px solid #DDE6EE;border-radius:16px;">
          <tr><td style="padding:24px 28px 16px;border-bottom:1px solid #E5EBF1;font-family:Georgia,'Times New Roman',serif;font-size:21px;line-height:26px;font-weight:700;font-style:italic;color:#102A43;">${BRAND}</td></tr>
          <tr><td style="padding:32px 28px 12px;">
            <p style="margin:0 0 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:12px;line-height:16px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#2578C2;">For your work</p>
            <h1 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:28px;line-height:35px;letter-spacing:-.02em;color:#102A43;">${escapeHtml(copy.heading)}</h1>
          </td></tr>
          <tr><td style="padding:12px 28px 4px;"><p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:24px;color:#30465F;">${escapeHtml(copy.body)}</p></td></tr>
          <tr><td style="padding:24px 28px 34px;"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:13px 20px;border-radius:9px;background:#12618C;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:20px;font-weight:700;text-decoration:none;color:#FFFFFF;">${escapeHtml(copy.cta)}</a></td></tr>
          <tr><td style="padding:20px 28px 28px;border-top:1px solid #E5EBF1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:12px;line-height:18px;color:#66788C;">
            You receive this optional email because product news and offers are enabled in your Minimum Stress settings. Booking, payment, safety and account messages are separate.<br><br>
            <a href="${escapeHtml(unsubscribeUrl)}" style="color:#43566D;text-decoration:underline;">Unsubscribe from product news and offers</a><br>
            ${escapeHtml(footer)} · <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color:#43566D;">${escapeHtml(SUPPORT_EMAIL)}</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
