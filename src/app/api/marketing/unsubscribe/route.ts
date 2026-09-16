import type { NextRequest } from "next/server";

import { LIMITS, check, identify, tooManyRequests } from "@/lib/api/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest): Promise<Response> {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!UUID.test(token)) return html("That unsubscribe link is not valid.", 400);

  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe — Minimum Stress</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:64px auto;padding:24px;color:#16304e"><h1 style="font-size:28px">Stop marketing emails?</h1><p>Booking, payment, safety and account messages will still arrive. Only optional product news and offers will stop.</p><form method="post" action="/api/marketing/unsubscribe"><input type="hidden" name="token" value="${token}"><button type="submit" style="border:0;border-radius:999px;background:#16304e;color:white;padding:12px 20px;font-weight:600">Unsubscribe</button></form></body></html>`,
    { status: 200, headers: responseHeaders() },
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  const limited = check("marketing-unsubscribe", identify(request), LIMITS.marketingUnsubscribe);
  if (!limited.ok) return tooManyRequests(limited);

  const contentType = request.headers.get("content-type") ?? "";
  let token = request.nextUrl.searchParams.get("token") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
    if (typeof body?.token === "string") token = body.token;
  } else {
    const form = await request.formData().catch(() => null);
    const value = form?.get("token");
    if (typeof value === "string") token = value;
  }

  // Identical success for an expired/unknown token: the endpoint is public and
  // must not become an account-existence oracle.
  if (UUID.test(token)) {
    const { error } = await supabaseAdmin()
      .from("profiles")
      .update({
        notify_offers: false,
        marketing_unsubscribed_at: new Date().toISOString(),
        marketing_unsubscribe_reason: "one_click",
      })
      .eq("marketing_unsubscribe_token", token);
    if (error) return html("We couldn't update that preference just now. Please try again.", 500);
  }

  return html(
    "You're unsubscribed from product news and offers. Transactional booking, payment, safety and account messages are unchanged.",
    200,
  );
}

function html(message: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences — Minimum Stress</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:64px auto;padding:24px;color:#16304e"><h1 style="font-size:28px">Email preferences</h1><p>${message}</p></body></html>`,
    { status, headers: responseHeaders() },
  );
}

function responseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  };
}
