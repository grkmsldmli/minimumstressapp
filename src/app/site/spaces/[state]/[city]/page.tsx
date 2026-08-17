import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { SpaceCards } from "@/components/site/space-cards";
import { WEBSITE } from "@/lib/company";
import {
  type CityRow,
  citySlug,
  cityTypePath,
  indexableCity,
  indexableCityType,
  priceRange,
  stateSlug,
  usesInCity,
} from "@/lib/directory";
import { citiesWithSpaces, cityTypesWithSpaces, spacesIn } from "@/lib/directory-data";
import { formatCents } from "@/lib/money";
import { spaceTypeBySlug } from "@/lib/space-types";

/**
 * The rooms in one town.
 *
 * This is the page the whole engine exists to produce, and today it produces
 * none of them — there are no listings, so no town clears the threshold and
 * every one of these correctly refuses to be indexed. That is the engine
 * working. The alternative, a page per town regardless, is the failure this
 * part of the site was designed around: a thousand near-empty addresses teach
 * a search engine that the site is mostly nothing.
 *
 * Rendered on demand and revalidated rather than built once. The content is
 * whatever is listed at the moment somebody asks, and a page pinned at build
 * time would show a room that has since been delisted.
 */

export const revalidate = 3600;

async function findCity(stateParam: string, cityParam: string): Promise<CityRow | null> {
  const cities = await citiesWithSpaces();
  return (
    cities.find(
      (row) => stateSlug(row.state) === stateParam && citySlug(row.city) === cityParam,
    ) ?? null
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string; city: string }>;
}): Promise<Metadata> {
  const { state, city } = await params;
  const row = await findCity(state, city);
  if (!row) return {};

  const title = `Wellness Spaces for Rent in ${row.city}, ${row.state}`;

  return {
    title,
    description:
      `Treatment rooms, studios and private consulting space in ${row.city}, by the hour. ` +
      "No lease, and the price you see is the price you pay.",
    alternates: { canonical: `${WEBSITE}/spaces/${state}/${city}` },
    /*
     * The single rule, read here as well as by the sitemap and the links.
     * A town below the threshold still has a page — somebody who followed a
     * link to it should see the rooms it does have — but it is not advertised
     * to anybody, and the sitemap does not name it either.
     */
    robots: indexableCity(row) ? undefined : { index: false, follow: true },
  };
}

export default async function CityPage({
  params,
}: {
  params: Promise<{ state: string; city: string }>;
}) {
  const { state, city } = await params;
  const row = await findCity(state, city);

  // No town by that name with anything in it. A 404 rather than an empty page:
  // there is genuinely nothing here, and saying so is the honest answer to a
  // crawler as well as to a person.
  if (!row) notFound();

  const [spaces, allTypes] = await Promise.all([
    spacesIn(row.state, row.city),
    cityTypesWithSpaces(),
  ]);

  const uses = usesInCity(
    allTypes.filter((type) => type.state === row.state && type.city === row.city),
  );
  const prices = priceRange(row);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-4">
      <div className="max-w-3xl">
          <Link href="/spaces" className="text-[14px]" style={{ color: "#0EA5E9" }}>
            ← All areas
          </Link>

          <h1
            className="mt-5 text-[38px] leading-[1.1] sm:text-[44px]"
            style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
          >
            Wellness spaces for rent in {row.city}
          </h1>

          <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
            {row.spaceCount === 1
              ? "One room, bookable by the hour."
              : `${row.spaceCount} rooms, bookable by the hour.`}{" "}
            No lease and no deposit — you book the hours you need and nothing else.
          </p>

          {/*
            The price line only appears once there are enough rooms for it to
            describe a market rather than one host. "From $40" off a single
            listing is that host's rate wearing a market rate's clothes.
          */}
          {prices && (
            <p className="mt-3 text-[15px]" style={{ color: "#8a94a3" }}>
              {formatCents(prices.from)}–{formatCents(prices.to)} an hour, typically{" "}
              {formatCents(prices.median)}.
            </p>
          )}

          {uses.length > 0 && (
            <>
              <h2 className="mt-10 text-[14px] font-medium" style={{ color: "#0F2F55" }}>
                By what you need it for
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {uses.map((use) => {
                  const type = spaceTypeBySlug(use.spaceType);
                  if (!type) return null;
                  /*
                   * Only linked when the page is its own page. A use covering
                   * every room in town is the town page under another address,
                   * and linking to it spreads a town's ranking across two URLs
                   * that say the same thing.
                   */
                  if (!indexableCityType(use, row.spaceCount)) {
                    return (
                      <span
                        key={use.spaceType}
                        className="rounded-full px-4 py-2 text-[14px]"
                        style={{ border: "1px solid #e7eef6", color: "#8a94a3" }}
                      >
                        {type.plural} ({use.spaceCount})
                      </span>
                    );
                  }
                  return (
                    <Link
                      key={use.spaceType}
                      href={cityTypePath(row.state, row.city, use.spaceType)}
                      className="rounded-full px-4 py-2 text-[14px]"
                      style={{ border: "1px solid #e7eef6", color: "#0F2F55" }}
                    >
                      {type.plural} ({use.spaceCount})
                    </Link>
                  );
                })}
              </div>
            </>
          )}

          <div className="mt-10">
            <SpaceCards spaces={spaces} />
          </div>

          <div
            className="mt-14 rounded-2xl p-6"
            style={{ backgroundColor: "#f8fbfd", border: "1px solid #e7eef6" }}
          >
            <h2 className="text-[19px]" style={{ color: "#0F2F55" }}>
              Have a room in {row.city}?
            </h2>
            <p className="mt-2 text-[15px] leading-[1.75]" style={{ color: "#5f6673" }}>
              You set the rate and keep it — the fee is added on top and the practitioner pays it.
            </p>
            <Link
              href="/rent-out-your"
              className="mt-4 inline-block rounded-full px-6 py-3 text-[14.5px] font-medium text-white"
              style={{ backgroundColor: "#0F2F55" }}
            >
              See what it could earn
            </Link>
          </div>
      </div>
      </main>

      <SiteFooter />
    </>
  );
}
