import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { RequestSpace } from "@/components/site/request-space";
import { WEBSITE } from "@/lib/company";
import { cityPath, discoverableCity } from "@/lib/directory";
import { citiesWithSpaces } from "@/lib/directory-data";

/**
 * Where the towns are listed, once there are any.
 *
 * The parent of every generated address, and the page that has to be honest
 * when there is nothing under it. Today that is the whole of its job: no
 listings means no towns, and a directory that invents a page per town
 * regardless would be the failure this part of the site is built to
 * avoid — a hundred addresses with nothing behind them, teaching a search
 * engine what to think of the rest.
 *
 * So when it is empty it says so and points at the thing that would fix it,
 * which is a host with a spare room.
 */

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Wellness Spaces for Rent",
  description:
    "Treatment rooms, studios and private consulting rooms, rented for as long as you need. No lease, " +
    "no deposit.",
  alternates: { canonical: `${WEBSITE}/spaces` },
};

export default async function SpacesIndex() {
  const cities = await citiesWithSpaces();

  // Every town with live inventory, for the person who came looking. This is
  // deliberately not the indexing threshold: a town with one or two rooms is
  // real inventory somebody can book, and hiding it here — as this page used to,
  // by reusing indexableCity — was showing "nothing" over a listing that
  // existed. Whether a town is worth advertising to a search engine is a
  // separate, higher bar, decided on the town's own page.
  const listed = cities
    .filter(discoverableCity)
    .sort((a, b) => a.city.localeCompare(b.city));

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-4">
      <div className="max-w-3xl">
          <h1
            className="mt-5 text-[38px] leading-[1.1] sm:text-[44px]"
            style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
          >
            Space on your schedule,
            <br />
            <em className="italic" style={{ color: "#0EA5E9" }}>
              where you work
            </em>
          </h1>

          {listed.length > 0 ? (
            <>
              <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
                Treatment rooms, studios and private consulting rooms, booked on your schedule. No
                lease, no deposit, and the price you see is the price you pay.
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
             * The empty state, and now a truthful one: it is reached only when
             * there is genuinely no live inventory anywhere, because visibility
             * above no longer hides real rooms behind the indexing threshold.
             * Written as a real answer rather than an apology — the reader is
             * either a practitioner who needs a room, told plainly there is not
             * one here yet, or somebody with a room, who is the whole reason the
             * page would ever fill up.
             */
            <>
              <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
                Spaces are coming to your area.
              </p>

              <p className="mt-3 text-[15px] leading-[1.75]" style={{ color: "#8a94a3" }}>
                Tell us what you&rsquo;re looking for and we&rsquo;ll use it to guide where we
                add spaces next.
              </p>

              {/*
                The only thing an empty marketplace can still do with somebody
                who came looking: take the request. It is prefilled from the
                search that got here, and it is what a host is eventually shown
                as a reason to list.
              */}
              <Suspense fallback={null}>
                <RequestSpace />
              </Suspense>

              <div
                className="mt-8 rounded-2xl p-6"
                style={{ backgroundColor: "#f8fbfd", border: "1px solid #e7eef6" }}
              >
                <h2 className="text-[19px]" style={{ color: "#0F2F55" }}>
                  Have a room that sits empty?
                </h2>
                <p className="mt-2 text-[15px] leading-[1.75]" style={{ color: "#5f6673" }}>
                  A treatment room, a studio, a spare consulting room — the hours you are not
                  using could be earning. You set the rate and keep all of it.
                </p>
                <Link
                  href="/rent-out-your"
                  className="mt-4 inline-block rounded-full px-6 py-3 text-[14.5px] font-medium text-white"
                  style={{ backgroundColor: "#0F2F55" }}
                >
                  See your quote
                </Link>
              </div>
            </>
          )}
      </div>
      </main>

      <SiteFooter />
    </>
  );
}
