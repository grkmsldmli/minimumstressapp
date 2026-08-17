import Link from "next/link";
import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { WEBSITE } from "@/lib/company";
import { cityPath, indexableCity } from "@/lib/directory";
import { citiesWithSpaces } from "@/lib/directory-data";

/**
 * Where the towns are listed, once there are any.
 *
 * The parent of every generated address, and the page that has to be honest
 * when there is nothing under it. Today that is the whole of its job: no
 * listings means no towns, and a directory that invents a page per Bay Area
 * town regardless would be the failure this part of the site is built to
 * avoid — a hundred addresses with nothing behind them, teaching a search
 * engine what to think of the rest.
 *
 * So when it is empty it says so and points at the thing that would fix it,
 * which is a host with a spare room.
 */

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Wellness Spaces for Rent by the Hour",
  description:
    "Treatment rooms, studios and private consulting space across the Bay Area, rented by " +
    "the hour. No lease, no deposit.",
  alternates: { canonical: `${WEBSITE}/spaces` },
};

export default async function SpacesIndex() {
  const cities = await citiesWithSpaces();

  // Only the towns with enough to be worth a page. Linking to a thin one from
  // here is the same mistake as putting it in the sitemap, made by hand.
  const listed = cities
    .filter(indexableCity)
    .sort((a, b) => a.city.localeCompare(b.city));

  return (
    <>
      <SiteHeader width="narrow" />

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-4">
        <h1
          className="mt-5 text-[38px] leading-[1.1] sm:text-[44px]"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          Space by the hour,
          <br />
          <em className="italic" style={{ color: "#0EA5E9" }}>
            where you work
          </em>
        </h1>

        {listed.length > 0 ? (
          <>
            <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
              Treatment rooms, studios and private consulting space, booked by the hour. No lease,
              no deposit, and the price you see is the price you pay.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {listed.map((row) => (
                <Link
                  key={`${row.state}-${row.city}`}
                  href={cityPath(row.state, row.city)}
                  className="rounded-xl p-4"
                  style={{ border: "1px solid #e7eef6" }}
                >
                  <span className="block text-[15px]" style={{ color: "#0F2F55" }}>
                    {row.city}, {row.state}
                  </span>
                  <span className="mt-1 block text-[13.5px]" style={{ color: "#8a94a3" }}>
                    {row.spaceCount} {row.spaceCount === 1 ? "room" : "rooms"}
                  </span>
                </Link>
              ))}
            </div>
          </>
        ) : (
          /*
           * The empty state, written as a real answer rather than as an
           * apology. Somebody reading this is either a practitioner who needs
           * a room — in which case the honest thing is to say there is not one
           * yet — or somebody with a room, who is the entire reason the page
           * would ever fill up.
           */
          <>
            <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
              Nothing is listed yet. We are opening in the Bay Area first — San Francisco, the
              peninsula down to San Jose, and the East Bay.
            </p>

            <div
              className="mt-8 rounded-2xl p-6"
              style={{ backgroundColor: "#f8fbfd", border: "1px solid #e7eef6" }}
            >
              <h2 className="text-[19px]" style={{ color: "#0F2F55" }}>
                Have a room that sits empty?
              </h2>
              <p className="mt-2 text-[15px] leading-[1.75]" style={{ color: "#5f6673" }}>
                A treatment room, a studio, a spare consulting space — the hours you are not in it
                can earn. You set the rate and you keep it; the fee is added on top and the
                practitioner pays it.
              </p>
              <Link
                href="/rent-out-your"
                className="mt-4 inline-block rounded-full px-6 py-3 text-[14.5px] font-medium text-white"
                style={{ backgroundColor: "#0F2F55" }}
              >
                See what it could earn
              </Link>
            </div>
          </>
        )}
      </main>

      <SiteFooter />
    </>
  );
}
