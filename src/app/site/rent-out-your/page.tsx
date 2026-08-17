import Link from "next/link";
import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { WEBSITE } from "@/lib/company";
import { hostPages } from "@/lib/host-pages";

/**
 * The parent of the ten.
 *
 * It exists partly because a path whose children are indexed and whose parent
 * 404s is a broken-looking site to a crawler and to anybody who deletes the
 * last segment of a URL — and partly because it is the one page that can ask
 * the question none of the children can: which of these is your room.
 */

export const metadata: Metadata = {
  title: "Rent Out Your Wellness Space by the Hour",
  description:
    "Treatment rooms, studios and private consulting space, let by the hour. You set the " +
    "rate and keep it, you set the hours, and there is no lease.",
  alternates: { canonical: `${WEBSITE}/rent-out-your` },
};

export default function RentOutYourIndex() {
  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-4">
      <div className="max-w-3xl">
          <Link href="/for-hosts" className="text-[14px]" style={{ color: "#0EA5E9" }}>
            ← For hosts
          </Link>

          <h1
            className="mt-5 text-[38px] leading-[1.1] sm:text-[44px]"
            style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
          >
            Rent out your space
            <br />
            <em className="italic" style={{ color: "#0EA5E9" }}>
              by the hour
            </em>
          </h1>

          <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
            You set the rate and you keep it — the fee is added on top and the practitioner pays it.
            You set the hours it can be booked, and nothing is bookable outside them. No lease, no
            deposit, and no month you did not use.
          </p>

          <h2 className="mt-12 text-[14px] font-medium" style={{ color: "#0F2F55" }}>
            Which one is yours?
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {hostPages().map((page) => (
              <Link
                key={page.type.slug}
                href={`/rent-out-your/${page.type.slug}`}
                className="rounded-xl p-5"
                style={{ border: "1px solid #e7eef6" }}
              >
                <span className="block text-[16px]" style={{ color: "#0F2F55" }}>
                  {page.type.label}
                </span>
                <span className="mt-1.5 block text-[13.5px] leading-[1.65]" style={{ color: "#8a94a3" }}>
                  {page.type.blurb}
                </span>
              </Link>
            ))}
          </div>

          <p className="mt-10 text-[15px] leading-[1.75]" style={{ color: "#5f6673" }}>
            A room can be more than one of these, and it is worth saying so — a treatment room marked
            for massage, reiki and acupuncture is found by three sets of people instead of one.
          </p>
      </div>
      </main>

      <SiteFooter />
    </>
  );
}
