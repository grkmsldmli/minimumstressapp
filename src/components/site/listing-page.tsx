import Image from "next/image";
import Link from "next/link";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { Reveal } from "@/components/site/reveal";
import { APP_URL } from "@/lib/company";
import { cityPath } from "@/lib/directory";
import type { DirectoryListing } from "@/lib/directory-data";
import { formatCents } from "@/lib/money";
import { COLOUR, TYPE } from "@/lib/site-theme";
import { spaceTypeBySlug } from "@/lib/space-types";
import {
  AMENITY_GROUPS,
  ROOM_SETUPS,
  amenitiesIn,
  requirementsByKind,
  roomTypeFor,
  type CategoryKey,
} from "@/lib/taxonomy";

/**
 * One room, as a page a stranger can arrive on.
 *
 * Every listing is one of these the moment it goes live, which is the point:
 * the engine stops needing anybody to write pages and starts producing one per
 * room. It is also the page most likely to be somebody's first sight of the
 * company, because it is the one that matches what they searched for.
 *
 * Server-rendered text throughout, including the photographs. A listing whose
 * price and description only appear after hydration is a listing a crawler
 * reads as blank, and this page has no other purpose.
 */

function Facts({ listing }: { listing: DirectoryListing }) {
  const facts = [
    { label: "Fits", value: `${listing.capacity}` },
    listing.floorAreaSqft ? { label: "Floor area", value: `${listing.floorAreaSqft} sq ft` } : null,
    listing.bufferMinutes
      ? { label: "Gap between bookings", value: `${listing.bufferMinutes} min` }
      : null,
  ].flatMap((fact) => (fact ? [fact] : []));

  return (
    <dl className="mt-8 grid gap-4 sm:grid-cols-3">
      {facts.map((fact) => (
        <div key={fact.label} className="rounded-2xl p-5" style={{ border: `1px solid ${COLOUR.line}` }}>
          <dt className={TYPE.small} style={{ color: COLOUR.muted }}>
            {fact.label}
          </dt>
          <dd className="mt-1 text-[22px]" style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}>
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ListingPage({ listing }: { listing: DirectoryListing }) {
  const uses = listing.suitableFor
    .map(spaceTypeBySlug)
    .flatMap((type) => (type ? [type] : []));

  const setup = ROOM_SETUPS.find((option) => option.key === listing.roomSetup);
  const groups = requirementsByKind(listing.requirements);

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-4">
        <Link
          href={cityPath(listing.state, listing.city)}
          className={TYPE.small}
          style={{ color: COLOUR.link }}
        >
          ← All spaces in {listing.city}
        </Link>

        <div className="mt-5 max-w-3xl">
          <p className={TYPE.eyebrow} style={{ color: COLOUR.link }}>
            {roomTypeFor(listing.category as CategoryKey)} · {listing.city}, {listing.state}
          </p>
          <h1
            className={`mt-3 ${TYPE.h2}`}
            style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}
          >
            {listing.name}
          </h1>

          <p className="mt-4 text-[26px]" style={{ color: COLOUR.ink }}>
            {formatCents(listing.hourlyRateCents)}
            <span className={TYPE.body} style={{ color: COLOUR.muted }}>
              {" "}
              an hour
            </span>
          </p>

          {listing.reviewCount > 0 && listing.averageRating !== null && (
            <p className={`mt-2 ${TYPE.small}`} style={{ color: COLOUR.muted }}>
              {listing.averageRating.toFixed(1)} from {listing.reviewCount}{" "}
              {listing.reviewCount === 1 ? "review" : "reviews"}
            </p>
          )}
        </div>

        {/*
          Through next/image, with the storage host allowlisted in
          next.config.ts. These arrive at whatever size a host's phone
          produced, and on this page the first one is the largest thing on the
          screen and the thing the page waits for.
        */}
        {listing.photos.length > 0 && (
          <Reveal>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {listing.photos.slice(0, 4).map((url, index) => (
                <Image
                  key={url}
                  src={url}
                  alt={`${listing.name} — photograph ${index + 1}`}
                  width={1200}
                  height={900}
                  sizes="(min-width: 640px) 36rem, 100vw"
                  priority={index === 0}
                  className="aspect-[4/3] w-full rounded-2xl object-cover"
                  style={{ border: `1px solid ${COLOUR.line}` }}
                />
              ))}
            </div>
          </Reveal>
        )}

        <div className="mt-10 max-w-3xl">
          {listing.description && (
            <p className={TYPE.body} style={{ color: COLOUR.body }}>
              {listing.description}
            </p>
          )}

          <Facts listing={listing} />

          {setup && (
            <>
              <h2 className={`mt-10 ${TYPE.h3}`} style={{ color: COLOUR.ink }}>
                The space
              </h2>
              <p className={`mt-2 ${TYPE.body}`} style={{ color: COLOUR.body }}>
                {setup.detail}
              </p>
            </>
          )}

          {uses.length > 0 && (
            <>
              <h2 className={`mt-10 ${TYPE.h3}`} style={{ color: COLOUR.ink }}>
                Good for
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {uses.map((use) => (
                  <Link
                    key={use.slug}
                    href={`${cityPath(listing.state, listing.city)}/${use.slug}`}
                    className={`rounded-full px-4 py-2 ${TYPE.small}`}
                    style={{ border: `1px solid ${COLOUR.line}`, color: COLOUR.ink }}
                  >
                    {use.label}
                  </Link>
                ))}
              </div>
            </>
          )}

          {AMENITY_GROUPS.map((group) => {
            const shown = amenitiesIn(group.group).filter((a) => listing.amenities.includes(a.key));
            if (shown.length === 0) return null;
            return (
              <div key={group.group}>
                <h2 className={`mt-10 ${TYPE.h3}`} style={{ color: COLOUR.ink }}>
                  {group.heading}
                </h2>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {shown.map((amenity) => (
                    <li key={amenity.key} className={TYPE.body} style={{ color: COLOUR.body }}>
                      {amenity.label}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          {(groups.length > 0 || listing.houseRules) && (
            <>
              <h2 className={`mt-10 ${TYPE.h3}`} style={{ color: COLOUR.ink }}>
                Before you book
              </h2>
              {groups.map((group) => (
                <div key={group.heading} className="mt-4">
                  <p className={TYPE.eyebrow} style={{ color: COLOUR.muted }}>
                    {group.heading}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {group.items.map((item) => (
                      <li key={item.key} className={TYPE.body} style={{ color: COLOUR.body }}>
                        {item.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {listing.houseRules && (
                <p className={`mt-4 ${TYPE.body}`} style={{ color: COLOUR.body }}>
                  {listing.houseRules}
                </p>
              )}
            </>
          )}

          {listing.addressLine && (
            <>
              <h2 className={`mt-10 ${TYPE.h3}`} style={{ color: COLOUR.ink }}>
                Where it is
              </h2>
              <p className={`mt-2 ${TYPE.body}`} style={{ color: COLOUR.body }}>
                {listing.addressLine}
              </p>
              <p className={`mt-1 ${TYPE.small}`} style={{ color: COLOUR.muted }}>
                How to get inside is sent to you shortly before your session.
              </p>
            </>
          )}

          {/*
            Booking happens in the app, which is where the calendar, the card
            and the terms are. A real href rather than a button: it is how a
            crawler gets from here to there, and how somebody opens it in a new
            tab.
          */}
          <div
            className="mt-12 rounded-2xl p-7"
            style={{ backgroundColor: COLOUR.wash, border: `1px solid ${COLOUR.line}` }}
          >
            <p className={TYPE.body} style={{ color: COLOUR.body }}>
              Hours, availability and booking are in the app. The price you see here is the price
              you pay.
            </p>
            <a
              href={`${APP_URL}?space=${encodeURIComponent(listing.id)}`}
              className="mt-5 inline-block rounded-full px-8 py-4 text-[16px] font-medium text-white"
              style={{ backgroundColor: COLOUR.ink }}
            >
              See hours and book
            </a>
          </div>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
