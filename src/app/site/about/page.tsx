import type { Metadata } from "next";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { APP_URL, BRAND, LEGAL_ENTITY, SUPPORT_EMAIL } from "@/lib/company";

/**
 * Who this is, in the fewest words that are true.
 *
 * The Shopify version of this page was three screens about wellness
 * philosophy. Somebody opening an about page wants to know who they would be
 * handing money to and whether the company is real, so that is what it
 * answers: the registered name, where it operates, what it sells, and an
 * address that reaches a person.
 */

export const metadata: Metadata = {
  title: "About",
  description: `${BRAND} rents private rooms by the hour to wellness practitioners in California.`,
};

export default function AboutPage() {
  return (
    <>
      <SiteHeader width="narrow" />

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-6">
        <h1
          className="text-[38px] leading-[1.1] sm:text-[44px]"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          A room, an hour,
          <br />
          <em className="italic" style={{ color: "#0EA5E9" }}>
            and a fair price for both.
          </em>
        </h1>

        <div className="mt-8 space-y-5 text-[16.5px] leading-[1.85]" style={{ color: "#5f6673" }}>
          <p>
            Most people who do this work for themselves face the same problem. A studio lease
            costs the same in a quiet month as a busy one, and the alternative — seeing clients
            at home, or in a café — is not a real alternative for anyone whose work needs a door
            that closes.
          </p>

          <p>
            Meanwhile the rooms already exist. Treatment rooms sit empty three days a week.
            Studios are dark every weekday morning. Somebody is already paying for that space.
          </p>

          <p>
            So {BRAND} does one thing: it lets a practitioner book one of those rooms for one
            hour, at a price both sides agreed to before anybody arrives. We are not a clinic and
            we are not a wellness brand. We are the part in the middle that handles the booking,
            the money and the door code, and then gets out of the way.
          </p>

          {/*
            Said plainly because it is the thing that decides whether somebody
            trusts a payment page. A company that will not say who it is or
            where to write has already answered the question.
          */}
          <p>
            The company is <strong style={{ color: "#0F2F55" }}>{LEGAL_ENTITY}</strong>, and it
            operates in California. If something is wrong, or you want to ask a person, write to{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "#0EA5E9" }}>
              {SUPPORT_EMAIL}
            </a>{" "}
            — it reaches us, not a queue.
          </p>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <a
            href={APP_URL}
            className="rounded-full px-7 py-3.5 text-[15px] font-medium text-white"
            style={{ backgroundColor: "#0F2F55" }}
          >
            Find a room
          </a>
          <a
            href="/for-hosts"
            className="rounded-full border px-7 py-3.5 text-[15px] font-medium"
            style={{ borderColor: "#d9e2ec", color: "#0F2F55" }}
          >
            List a room
          </a>
        </div>
      </main>

      <SiteFooter width="narrow" />
    </>
  );
}
