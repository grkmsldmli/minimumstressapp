import Link from "next/link";
import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { WEBSITE } from "@/lib/company";
import { COLOUR, TYPE } from "@/lib/site-theme";
import { spaceTypesFor } from "@/lib/space-types";
import { CATEGORIES } from "@/lib/taxonomy";

/**
 * The parent of the ten, asking the question none of them can.
 *
 * It listed all ten as equals, which contradicted the four categories the rest
 * of the site had moved to and asked a host to place their room among ten
 * names before anything had been explained. The four are the question — what
 * kind of space is this — and the ten are the answer to a different one, which
 * is what somebody types into a search box.
 *
 * The ten pages stay. Each is a real page with its own earnings figures, and
 * "massage room for rent" is a phrase people search while "holistic practice
 * room" is not. They are reached from inside the category they belong to
 * rather than shown as ten top-level choices.
 *
 * The paragraph explaining that a room can be more than one of these is gone.
 * Once the listing itself carries `suitable_for`, the page does not need to
 * apologise for its own taxonomy.
 */

export const metadata: Metadata = {
  title: "Rent Out Your Wellness Space",
  description:
    "You choose the hours and the rate, and you keep the rate. Studios, treatment rooms and " +
    "private consulting rooms, with no lease and no commitment.",
  alternates: { canonical: `${WEBSITE}/rent-out-your` },
};

/** What each of the four is, in the words a host would use about their own room. */
const DESCRIPTIONS: Record<string, string> = {
  physical:
    "For Pilates, yoga, tai chi, mobility and private instruction, and for small group classes.",
  social:
    "A private, comfortable room for coaching, consultations and one-to-one professional work.",
  traditional:
    "A flexible private room for hands-on work — Ayurveda, naturopathy, herbal practice, aromatherapy and bodywork.",
  spirit:
    "A calm space for meditation, mindfulness, breathwork, spiritual practice and small groups.",
};

export default function RentOutYourIndex() {
  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-4">
        <div className="max-w-3xl">
          <Link href="/for-hosts" className={TYPE.small} style={{ color: COLOUR.link }}>
            ← For hosts
          </Link>

          <h1
            className={`mt-5 ${TYPE.h2}`}
            style={{ fontFamily: "var(--font-dm-serif)", color: COLOUR.ink }}
          >
            Rent out your wellness space
            <br />
            <em className="italic" style={{ color: COLOUR.accent }}>
              on your schedule.
            </em>
          </h1>

          <p className={`mt-6 ${TYPE.lead}`} style={{ color: COLOUR.body }}>
            You choose when your space is available and what you want to earn. Practitioners book a
            single session, a group class, or the same time every week — without taking your space
            over with a long-term lease.
          </p>

          <p className={`mt-4 ${TYPE.small}`} style={{ color: COLOUR.muted }}>
            You set the rate and keep all of it. Nothing is deducted from what you set.
          </p>
        </div>

        <h2 className={`mt-14 ${TYPE.h3}`} style={{ color: COLOUR.ink }}>
          What kind of space do you have?
        </h2>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {CATEGORIES.map((category) => (
            <div
              key={category.key}
              className="overflow-hidden rounded-2xl"
              style={{ border: `1px solid ${COLOUR.line}` }}
            >
              <div
                className="h-1.5"
                style={{
                  background: `linear-gradient(90deg, ${category.gradient[0]}, ${category.gradient[1]})`,
                }}
              />
              <div className="p-6">
                <h3 className="text-[19px] font-medium" style={{ color: COLOUR.ink }}>
                  {category.roomType}
                </h3>
                <p className={`mt-2 ${TYPE.small}`} style={{ color: COLOUR.body }}>
                  {DESCRIPTIONS[category.key]}
                </p>

                {/*
                  The finer names, as links rather than as a second grid of
                  equals. Each is a page with its own figures, and each is a
                  phrase somebody searches — which the category name is not.
                */}
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
                  {spaceTypesFor(category.key).map((use) => (
                    <Link
                      key={use.slug}
                      href={`/rent-out-your/${use.slug}`}
                      className={`underline underline-offset-4 ${TYPE.small}`}
                      style={{ color: COLOUR.link }}
                    >
                      {use.label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className={`mt-10 max-w-3xl ${TYPE.body}`} style={{ color: COLOUR.body }}>
          Not sure which fits? Pick the closest. When you list, you tick everything the room
          actually suits — so a treatment room marked for massage, reiki and acupuncture is found
          by all three.
        </p>
      </main>

      <SiteFooter />
    </>
  );
}
