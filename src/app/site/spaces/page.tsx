import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { RequestSpace } from "@/components/site/request-space";
import { WEBSITE } from "@/lib/company";
import { type CityRow, cityPath, discoverableCity } from "@/lib/directory";
import { citiesWithCategory, citiesWithSpaces } from "@/lib/directory-data";
import { type SpaceType, spaceTypeBySlug } from "@/lib/space-types";

/**
 * Where the towns are listed, either all of them or filtered to one kind of use.
 *
 * The parent of every generated address. Two jobs: be honest when there is
 * nothing under it, and — when an "Explore by space" card sends someone here
 * with `?type=` — show only the inventory that use is actually in, rather than
 * the whole directory wearing that card's name.
 *
 * The filter resolves through the taxonomy: a space type knows its category, so
 * `?type=movement-studio` shows the physical rooms and `?type=meditation-room`
 * the spirit ones. A card whose category has no live rooms yet gets a
 * category-specific empty state, never unrelated inventory borrowed to look
 * full. The `?type=` variants are the same directory filtered, not their own
 * pages, so their canonical stays on /spaces and they carry noindex — the
 * faceted-URL sprawl this part of the site is careful about.
 */

export const revalidate = 3600;

type SpacesSearch = { type?: string | string[] };

/** The chosen space type, when the URL carries a real one; null otherwise. */
function chosenType(params: SpacesSearch): SpaceType | null {
  const raw = Array.isArray(params.type) ? params.type[0] : params.type;
  return raw ? spaceTypeBySlug(raw) : null;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SpacesSearch>;
}): Promise<Metadata> {
  const type = chosenType(await searchParams);
  return {
    title: "Wellness Spaces for Rent",
    description:
      "Treatment rooms, studios and private consulting rooms, rented for as long as you need. No lease, " +
      "no deposit.",
    alternates: { canonical: `${WEBSITE}/spaces` },
    // A filtered slice is not its own address. Kept out of the index so the
    // facets never compete with /spaces, while still following through to the
    // town pages, which carry their own indexing rule.
    ...(type ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function SpacesIndex({
  searchParams,
}: {
  searchParams: Promise<SpacesSearch>;
}) {
  const type = chosenType(await searchParams);

  // A card filters to its category; without one, every town with inventory. The
  // category is the space type's own (SpaceType.category), so "Movement Studios"
  // (movement-studio → physical) shows physical rooms and nothing else — never
  // unrelated inventory to avoid an empty state.
  const cities: CityRow[] = type
    ? await citiesWithCategory(type.category)
    : await citiesWithSpaces();

  // Every town with live inventory, for the person who came looking — the show
  // threshold (1), not the index threshold (3). Whether a town is worth
  // advertising to a search engine is decided separately, on the town's page.
  const listed = cities
    .filter(discoverableCity)
    .sort((a, b) => a.city.localeCompare(b.city));

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-4">
        <div className="max-w-3xl">
          {type && (
            <p
              className="mt-2 text-[12px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: "#0EA5E9" }}
            >
              {type.plural}
            </p>
          )}

          <h1
            className="mt-2 text-[38px] leading-[1.1] sm:text-[44px]"
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
                {type
                  ? `${type.plural} on your schedule. No lease, no deposit, and the price you see is the price you pay.`
                  : "Treatment rooms, studios and private consulting rooms, booked on your schedule. No lease, no deposit, and the price you see is the price you pay."}
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
             * The empty state, written as a real answer rather than an apology.
             * Category-specific when a card sent someone here for a use with no
             * live rooms yet — "No consultation rooms available yet" is the true
             * answer, and showing physical rooms in its place would be a lie
             * dressed as a result. Without a filter it is the whole directory
             * that is empty, and it says that instead.
             */
            <>
              <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
                {type
                  ? `No ${type.plural.toLowerCase()} available yet.`
                  : "Spaces are coming to your area."}
              </p>

              <p className="mt-3 text-[15px] leading-[1.75]" style={{ color: "#8a94a3" }}>
                Tell us what you&rsquo;re looking for and we&rsquo;ll use it to guide where we
                add spaces next.
              </p>

              {/*
                The one thing an empty result can still do with somebody who came
                looking: take the request. Prefilled from the search that got
                here, and what a host is eventually shown as a reason to list.
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
