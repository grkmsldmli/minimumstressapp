import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { SpaceCards } from "@/components/site/space-cards";
import { WEBSITE } from "@/lib/company";
import {
  type CityRow,
  type CityTypeRow,
  canonicalForCityType,
  citySlug,
  cityPath,
  indexableCityType,
  priceRange,
  stateSlug,
} from "@/lib/directory";
import { citiesWithSpaces, cityTypesWithSpaces, listingBySlug, spacesIn } from "@/lib/directory-data";
import { ListingPage } from "@/components/site/listing-page";
import { isListingSlug, listingSlug } from "@/lib/listing-url";
import { formatCents } from "@/lib/money";
import { type CategoryKey, roomTypeFor } from "@/lib/taxonomy";
import { spaceTypeBySlug } from "@/lib/space-types";

/**
 * One town, one use — "Pilates Studios for Rent in San Mateo".
 *
 * The page closest to what somebody actually types, and the one most at risk
 * of being a duplicate of its parent. In a town whose every room is a
 * movement studio, this page and the town page list the same rooms; a search
 * engine resolves two addresses for one page by picking one and discounting
 * the other, and not always the one you wanted. So when this page is not a
 * genuine subset it canonicalises up and takes itself out of the index, while
 * still rendering for anybody who followed a link here.
 */

export const revalidate = 3600;

async function resolve(
  stateParam: string,
  cityParam: string,
  typeParam: string,
): Promise<{ city: CityRow; use: CityTypeRow } | null> {
  const type = spaceTypeBySlug(typeParam);
  if (!type) return null;

  const [cities, types] = await Promise.all([citiesWithSpaces(), cityTypesWithSpaces()]);

  const city = cities.find(
    (row) => stateSlug(row.state) === stateParam && citySlug(row.city) === cityParam,
  );
  if (!city) return null;

  const use = types.find(
    (row) => row.state === city.state && row.city === city.city && row.spaceType === type.slug,
  );
  return use ? { city, use } : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string; city: string; type: string }>;
}): Promise<Metadata> {
  const { state, city, type } = await params;

  /*
   * One room rather than a category of them. Checked first because it is the
   * cheaper question — a use slug is one of ten names we control, so anything
   * ending in an id is a listing and nothing else can be.
   */
  if (isListingSlug(type)) {
    const listing = await listingBySlug(type);
    if (!listing) return {};

    return {
      title: `${listing.name} — ${listing.city}, ${listing.state}`,
      description:
        `${roomTypeFor(listing.category as CategoryKey)} in ${listing.city}, ` +
        `${formatCents(listing.hourlyRateCents)} an hour. ${listing.description}`.slice(0, 200),
      alternates: {
        canonical: `${WEBSITE}/spaces/${state}/${city}/${listingSlug(listing.name, listing.id)}`,
      },
    };
  }

  const found = await resolve(state, city, type);
  if (!found) return {};

  const spaceType = spaceTypeBySlug(type)!;
  const title = `${spaceType.plural} for Rent in ${found.city.city}, ${found.city.state}`;
  const indexable = indexableCityType(found.use, found.city.spaceCount);

  return {
    title,
    description: `${spaceType.blurb} In ${found.city.city}, by the hour, with no lease.`,
    /*
     * Canonical up to the town when this page is the town page under another
     * name. Never left for a search engine to work out on its own — an
     * unresolved duplicate is two pages splitting one page's ranking.
     */
    alternates: {
      canonical: `${WEBSITE}${canonicalForCityType(found.use, found.city.spaceCount)}`,
    },
    robots: indexable ? undefined : { index: false, follow: true },
  };
}

export default async function CityTypePage({
  params,
}: {
  params: Promise<{ state: string; city: string; type: string }>;
}) {
  const { state, city, type } = await params;

  if (isListingSlug(type)) {
    const listing = await listingBySlug(type);
    if (!listing) notFound();
    return <ListingPage listing={listing} />;
  }

  const found = await resolve(state, city, type);
  if (!found) notFound();

  const spaceType = spaceTypeBySlug(type)!;
  const spaces = await spacesIn(found.city.state, found.city.city, spaceType.slug);
  const prices = priceRange(found.use);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-4">
      <div className="max-w-3xl">
          <Link
            href={cityPath(found.city.state, found.city.city)}
            className="text-[14px]"
            style={{ color: "#0EA5E9" }}
          >
            ← All spaces in {found.city.city}
          </Link>

          <h1
            className="mt-5 text-[38px] leading-[1.1] sm:text-[44px]"
            style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
          >
            {spaceType.plural} for rent in {found.city.city}
          </h1>

          <p className="mt-5 text-[16.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
            {spaceType.blurb}
          </p>

          {prices && (
            <p className="mt-3 text-[15px]" style={{ color: "#8a94a3" }}>
              {formatCents(prices.from)}–{formatCents(prices.to)} an hour in {found.city.city},
              typically {formatCents(prices.median)}.
            </p>
          )}

          <div className="mt-10">
            <SpaceCards spaces={spaces} />
          </div>

          <div
            className="mt-14 rounded-2xl p-6"
            style={{ backgroundColor: "#f8fbfd", border: "1px solid #e7eef6" }}
          >
            <h2 className="text-[19px]" style={{ color: "#0F2F55" }}>
              Have a {spaceType.label.toLowerCase()} in {found.city.city}?
            </h2>
            <p className="mt-2 text-[15px] leading-[1.75]" style={{ color: "#5f6673" }}>
              The hours you are not in it can earn. You set the rate and keep it.
            </p>
            <Link
              href={`/rent-out-your/${spaceType.slug}`}
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
