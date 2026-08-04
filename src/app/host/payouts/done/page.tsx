import Link from "next/link";
import { AlertTriangle, Check, Clock } from "lucide-react";

import { Ambient, Headline } from "@/components/brand";
import { PAYOUT_DELAY_DAYS, type PayoutStatus } from "@/lib/payouts";
import { readPayoutStatus } from "@/lib/stripe/client";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Where Stripe returns a host after onboarding.
 *
 * It asks Stripe what actually happened rather than assuming the trip means
 * success. Stripe sends people here whether they finished or not, and telling
 * someone they are set up when they are not is the expensive mistake: their
 * listing takes bookings, every one is refused, and they see silence they read
 * as no demand.
 */
export default async function PayoutsDone() {
  const db = await supabaseServer();
  const { data: auth } = await db.auth.getUser();

  let status: PayoutStatus = "not_started";

  if (auth.user) {
    const { data: profile } = await db
      .from("profiles")
      .select("stripe_connect_account_id")
      .eq("id", auth.user.id)
      .maybeSingle();

    if (profile?.stripe_connect_account_id) {
      status = await readPayoutStatus(profile.stripe_connect_account_id);
    }
  }

  const view = VIEWS[status];

  return (
    <main className="w-full flex items-center justify-center py-8">
      <div
        className="relative overflow-hidden bg-white"
        style={{
          width: 385,
          height: 780,
          borderRadius: 44,
          border: "9px solid #16304E",
          boxShadow: "0 40px 90px -30px rgba(22,48,78,0.45)",
        }}
      >
        <div
          className="h-full flex flex-col screen-in relative overflow-hidden"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 0%, #1E4066 0%, #16304E 55%, #0E2138 100%)",
          }}
        >
          <Ambient />
          <div className="flex-1 flex flex-col items-center justify-center px-9 text-center relative z-10">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mb-6"
              style={{ backgroundColor: view.tint }}
            >
              {view.icon}
            </div>

            <Headline pre={view.pre} accent={view.accent} size={26} light />

            <p className="font-body font-light text-[13px] text-white/70 leading-relaxed mt-4">
              {view.body}
            </p>

            <Link
              href="/"
              className="mt-8 px-8 py-3.5 rounded-full font-body font-medium text-[13px] text-white press"
              style={{ backgroundColor: "#3B9BE8" }}
            >
              {view.cta}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

const VIEWS: Record<
  PayoutStatus,
  { pre: string; accent: string; body: string; cta: string; icon: React.ReactNode; tint: string }
> = {
  ready: {
    pre: "You're",
    accent: "set up.",
    body: `Your listings can take bookings, and earnings reach your bank ${PAYOUT_DELAY_DAYS} business days after each session. Nothing is deducted from your rate.`,
    cta: "Back to your space",
    icon: <Check size={26} color="#fff" />,
    tint: "rgba(94,125,94,0.9)",
  },
  in_progress: {
    pre: "Almost —",
    accent: "not quite.",
    body: "Stripe still needs something from you. Until it clears, bookings on your space will be turned down, so it is worth finishing now rather than waiting to find out.",
    cta: "Finish setting up",
    icon: <Clock size={26} color="#fff" />,
    tint: "rgba(176,141,79,0.9)",
  },
  restricted: {
    pre: "Stripe has",
    accent: "paused this.",
    body: "There is a requirement past its deadline on your payout account. Stripe will have emailed you about it; payouts stay on hold until it is resolved.",
    cta: "Back to your space",
    icon: <AlertTriangle size={26} color="#fff" />,
    tint: "rgba(192,90,75,0.9)",
  },
  not_started: {
    pre: "Nothing",
    accent: "set up yet.",
    body: "We could not find a payout account for you. Start again from your profile — it takes a few minutes, and Stripe handles the bank details directly.",
    cta: "Back to your space",
    icon: <AlertTriangle size={26} color="#fff" />,
    tint: "rgba(140,163,189,0.9)",
  },
};
