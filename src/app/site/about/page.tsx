import Link from "next/link";
import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { APP_URL, LEGAL_ENTITY, SUPPORT_EMAIL } from "@/lib/company";

/**
 * Who this is, in the fewest words that are true.
 *
 * The words are the owner's, and they are better than the ones they replaced:
 * "we are the booking layer in the middle" says in seven words what a
 * paragraph of mine was circling.
 *
 * The title is the one thing deliberately not taken as given. The proposed one
 * was "Private Wellness Space by the Hour | Minimum Stress | Book Now", which
 * is already the app's own title at minimumstress.app. Two pages we own,
 * competing for the same phrase, means a search engine picks one and buries
 * the other — and the one it buries would probably be the app, which is the
 * thing that takes bookings. This page answers "who are these people", so that
 * is what it is titled.
 */

export const metadata: Metadata = {
  title: "About",
  description:
    "Minimum Stress is the booking layer between practitioners who need a private space by " +
    "the hour and hosts with space already sitting empty. Operated by Minimum Stress " +
    "Consulting Services LLC in California.",
};

export default function AboutPage() {
  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-6">
        <div className="max-w-2xl">
          <h1
            className="text-[36px] leading-[1.12] sm:text-[42px]"
            style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
          >
            Wellness work
            <br />
            <em className="italic" style={{ color: "#0EA5E9" }}>
              needs space.
            </em>
          </h1>

          <div className="mt-8 space-y-5 text-[16.5px] leading-[1.85]" style={{ color: "#5f6673" }}>
            <p>
              A quiet room. A door that closes. A clean setup. A place where a practitioner can meet
              a client without signing a lease or turning a living room into a studio.
            </p>

            <p>
              At the same time, many rooms are already sitting unused. Treatment rooms, studios,
              offices and private spaces often have empty hours during the week, even while someone
              is still paying rent for them.
            </p>

            <p className="text-[19px]" style={{ color: "#0F2F55" }}>
              Minimum Stress connects those two sides.
            </p>

            <p>
              Practitioners can book private wellness spaces by the hour. Hosts can earn from space
              they already have. The price, time and rules are agreed before anyone arrives.
            </p>

            <p>
              We are not a clinic. We are not trying to be the wellness brand in the room. We are
              the booking layer in the middle — the part that handles the space, the schedule, the
              payment and the access details, then gets out of the way.
            </p>
          </div>

          <div
            className="mt-10 rounded-2xl p-6 text-[15px] leading-[1.8]"
            style={{ backgroundColor: "#f8fbfd", border: "1px solid #e7eef6", color: "#5f6673" }}
          >
            <p>
              Minimum Stress is operated by{" "}
              <strong style={{ color: "#0F2F55" }}>{LEGAL_ENTITY}</strong> in California.
            </p>
            <p className="mt-2">
              If something needs a human, email{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "#0EA5E9" }}>
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          </div>

          <div className="mt-10 flex flex-wrap gap-3">
            <a
              href={APP_URL}
              className="rounded-full px-7 py-3.5 text-[15px] font-medium text-white"
              style={{ backgroundColor: "#0F2F55" }}
            >
              Find a space
            </a>
            <Link
              href="/for-hosts"
              className="rounded-full border px-7 py-3.5 text-[15px] font-medium"
              style={{ borderColor: "#d9e2ec", color: "#0F2F55" }}
            >
              List a space
            </Link>
          </div>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
