"use client";

import { useState } from "react";
import { ArrowLeft, ChevronDown, ScrollText } from "lucide-react";

import { Ambient, Headline } from "@/components/brand";
import { BRAND, LEGAL_ENTITY } from "@/lib/company";

/**
 * The short, in-app version. The brief is explicit that a lawyer drafts the
 * binding text, so this stays a plain-language summary and says so.
 *
 * The wording is deliberate on one point: a practitioner *licenses a room*.
 * The brief flags that California's AB5 ABC test governs worker
 * classification, and that language like "we engage practitioners to..." could
 * blur a relationship that is structurally a customer renting space. Nothing
 * here describes anyone as engaged, hired, or providing services to us.
 */
const SECTIONS = [
  {
    key: "terms",
    title: "Terms of Service",
    points: [
      `These terms are between you and ${LEGAL_ENTITY}, which operates ${BRAND}.`,
      `${BRAND} runs a marketplace. We are not a party to the room booking itself, nor to the session a practitioner runs with their own client.`,
      "Practitioners and hosts are independent businesses. A practitioner licenses a room by the hour — they are our customer, not our worker, and nothing in this arrangement makes them one.",
      "Hosts set their own rate and receive all of it. Our service fee is added on top for the practitioner; it is never deducted from what a host is owed.",
      "Hosts must hold the legal right to sublicense their space for paid sessions, and remain responsible for their own property and insurance.",
    ],
  },
  {
    key: "off-platform",
    title: "Booking outside the app",
    points: [
      "All bookings and payments must be made through Minimum Stress. Payment, refunds, cancellation cover, access codes, reviews, emergency contacts and support apply only to bookings recorded in the app.",
      "Users must not exchange phone numbers, email addresses or payment details. These are removed from messages automatically. Requesting or providing them may result in suspension.",
      "Minimum Stress is not a party to any session arranged or paid for outside the app. We hold no record of such arrangements and provide no payment protection, refund, access, verification, insurance or dispute resolution in respect of them. Liability rests with the parties who made them.",
      "Soliciting users to transact outside the app is a breach of these terms and may result in permanent suspension.",
    ],
  },
  {
    key: "wellness",
    title: "Health and Wellness",
    points: [
      `${LEGAL_ENTITY} operates a booking platform. It does not own, let or control the spaces listed, and does not provide medical, therapeutic, psychological or health services. Nothing in the app is medical advice.`,
      "Practitioners are solely responsible for the services they deliver, for holding the qualifications, registrations and insurance those services require, and for their own clients.",
      `${BRAND} does not verify a practitioner's qualifications, training or fitness to practise. Hosts and clients should carry out their own checks.`,
      "A room listing describes a space, not the suitability of that space for any particular practice. Practitioners must satisfy themselves that a room is appropriate before using it.",
    ],
  },
  {
    key: "privacy",
    title: "Privacy Policy",
    points: [
      "We collect what is needed to match and pay you: identity, contact details, listing information, and any documents you upload.",
      "Card details are handled by Stripe. We never see or store a card number.",
      "A space's entry instructions and door code are released to the practitioner who booked it, shortly before the session, and to nobody else. The address itself is shown on the listing.",
      "Verification documents are visible only to us, for review. They are never shown publicly or to the other side of a booking.",
      "You can ask us to delete your data at any time.",
    ],
  },
  {
    key: "location",
    title: "Location",
    points: [
      "Sharing your location is optional. Every part of the app works without it — you can browse everything, search by ZIP code, and book normally.",
      "When you do share it, it is used once, to put the nearest rooms first. It is sent to our server, used to sort that one list, and not written down. It is not attached to your account and not kept after the request.",
      "We never share it with anyone, and we never use it to build a picture of where you go.",
      "You can stop at any time — the app forgets your answer the moment you close it, so it will ask again rather than assume.",
      "Distances are deliberately imprecise. A listing's exact position is private until it is booked, so a room half a mile away is shown as half a mile away and never any closer than that.",
    ],
  },
  {
    key: "reviews",
    title: "Reviews and Safety",
    points: [
      "After a session, both sides can review each other. Neither review is visible until you have both written, or until 14 days have passed — so nobody is answering a review they have already read.",
      "A rating of three or below, or a review that flags a safety concern, is read by a person on our team.",
      "The safety flag is recorded separately from the rating. A session rated five stars can still carry a safety concern, and the flag is read whatever the rating says.",
      "We never tell either side whether a review was escalated, and we never share who reported what without asking first.",
      "Both hosts and practitioners can give us an emergency contact. Nobody you book with ever sees it — only our team, and only if something goes wrong during a session.",
    ],
  },
  {
    key: "cancel",
    title: "Cancellation Policy",
    points: [
      "You pay when you book. We hold the money until the session has happened, then pay the studio.",
      "Cancel 24 or more hours ahead and you are refunded in full, back to the card you paid with.",
      "Cancel inside 24 hours, or fail to attend, and the full amount is captured.",
      "If a host cancels on you, you are refunded automatically. That refund is never replaced by credit or made optional.",
      "A host cancellation also earns you goodwill credit worth our own fee on that booking. It applies to a future booking and never reduces what that future host is paid.",
    ],
  },
  {
    key: "standing",
    title: "Repeated Cancellations",
    points: [
      "Cancellations made 24 or more hours ahead do not count towards your standing. Only those inside the window do.",
      "Hosts: three last-minute cancellations in 90 days pauses new bookings on your spaces for 14 days. Two brings a warning first, so it is never a surprise.",
      "Practitioners: six in 90 days pauses new bookings for 14 days. The bar is higher because a late cancellation already charges you in full — the host is paid for the hour they set aside, so the loss between you is settled. A host cancelling leaves someone with no room and sometimes a client already waiting, which nothing makes right.",
      "A pause stops new bookings only. Every session already on the calendar goes ahead. Cancelling those would land the harm on somebody who did nothing.",
      "Pauses lift on their own after 14 days, and cancellations stop counting after 90. Nothing here is permanent.",
      "You can see exactly where you stand in your profile, at any time, whether or not anything is wrong. And if a pause looks wrong to you, tell us — a rule with nobody to ask is not a rule we would want to run.",
    ],
  },
] as const;

export function Legal({ onBack }: { onBack: () => void }) {
  const [open, setOpen] = useState<string | null>("terms");

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div
        className="px-6 pt-8 pb-6 relative rounded-b-[30px] overflow-hidden shrink-0"
        style={{ background: "radial-gradient(130% 130% at 20% 0%, #1E4066 0%, #16304E 80%)" }}
      >
        <Ambient />
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center press relative z-10"
          style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
        >
          <ArrowLeft size={16} color="#fff" />
        </button>
        <div className="mt-3 relative z-10">
          <Headline pre="The" accent="fine print." size={24} light />
        </div>
        <p className="font-body font-normal text-[14px] text-white/65 mt-1 relative z-10">
          {/*
            These are the terms, not a summary of terms kept elsewhere.
            Acceptance is recorded against this text, with a version and a
            timestamp — pointing at a different document as the binding one
            would make that record worthless.
          */}
          The terms you accepted, in full.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8">
        <div className="flex flex-col gap-2.5">
          {SECTIONS.map((section) => {
            const isOpen = open === section.key;
            return (
              <div
                key={section.key}
                className="rounded-2xl overflow-hidden"
                style={{ border: "1px solid #E7EEF6" }}
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : section.key)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center justify-between p-4 press bg-white"
                >
                  <span className="flex items-center gap-2.5 font-body font-medium text-[15px] text-navy">
                    <ScrollText size={15} color="#3B9BE8" />
                    {section.title}
                  </span>
                  <ChevronDown
                    size={16}
                    color="#B9CBDD"
                    style={{
                      transform: isOpen ? "rotate(180deg)" : "none",
                      transition: "transform 0.2s",
                    }}
                  />
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 card-in">
                    <ul className="flex flex-col gap-2">
                      {section.points.map((point) => (
                        <li key={point} className="flex items-start gap-2">
                          <span
                            className="w-1 h-1 rounded-full mt-2 shrink-0"
                            style={{ backgroundColor: "#8CA3BD" }}
                          />
                          <p className="font-body font-normal text-[13.5px] leading-relaxed text-ink-muted">
                            {point}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
