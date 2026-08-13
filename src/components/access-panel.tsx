"use client";

import {
  Accessibility,
  ArrowUpDown,
  Ban,
  Bath,
  DoorOpen,
  Footprints,
  MoveHorizontal,
} from "lucide-react";

import {
  type AccessDetails,
  type AccessIcon,
  accessFacts,
  accessUnanswered,
} from "@/lib/access-details";

/**
 * A picture per answer, rather than a tick per row.
 *
 * Every row used to carry the same tick or the same warning triangle, which
 * said whether we approved of the answer and nothing about what it meant.
 *
 * Each icon draws the thing described rather than the person it might matter
 * to. A first pass used the wheelchair symbol on every answer that cleared a
 * path, and three of them down a Pilates listing turned "how do you get in"
 * into a page about disability facilities — a narrower question than the one
 * being answered, and one that tells every other reader the section is not for
 * them. It stays on the accessible restroom alone, where the word is the
 * host's own answer rather than our framing of it.
 */
const ICONS: Record<AccessIcon, typeof Accessibility> = {
  door: DoorOpen,
  stairs: Footprints,
  lift: ArrowUpDown,
  width: MoveHorizontal,
  restroom: Bath,
  accessible_restroom: Accessibility,
  none: Ban,
};

/**
 * Getting in, as four answered facts.
 *
 * What this replaces was a chip reading "Wheelchair accessible", drawn from a
 * boolean. Somebody who uses a wheelchair could not act on it — a step at the
 * door, a lift too narrow to turn in and an unusable restroom are all
 * compatible with a ticked box — so they booked, travelled, paid, arrived with
 * their own client waiting, and could not get in.
 *
 * Obstacles are marked but not scored. A room with steps is not "less
 * accessible"; it is a room somebody cannot enter, and a rating would blur
 * that into a number somebody has to interpret.
 */
export function AccessPanel({ details }: { details: AccessDetails }) {
  const facts = accessFacts(details);

  if (accessUnanswered(details)) {
    return (
      <div
        className="rounded-xl px-3.5 py-3 flex items-start gap-2.5"
        style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
      >
        <Accessibility size={14} color="#566D85" className="mt-0.5 shrink-0" />
        <div>
          <p className="font-body font-medium text-[15px] text-navy">
            Access details not given
          </p>
          {/*
            Not answered, said as not answered. Reading silence as "accessible"
            is how somebody ends up on a pavement; reading it as "not
            accessible" writes off rooms that may be fine. Neither is ours to
            decide, and the host can be asked.
          */}
          <p className="font-body font-normal text-[13.5px] mt-0.5 leading-relaxed text-ink-soft">
            This host hasn&apos;t answered these yet. Message them before booking if you need to
            know.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #E7EEF6" }}>
      {facts.map((fact, i) => {
        const Icon = ICONS[fact.icon];

        return (
          <div
            key={fact.question}
            className="px-3.5 py-2.5 flex items-center gap-3"
            style={{
              borderTop: i === 0 ? undefined : "1px solid #E7EEF6",
              backgroundColor: fact.blocks ? "#FFF8F1" : "#fff",
            }}
          >
            {/*
              Bigger, and in a disc. At 13px in the margin it read as
              punctuation; the icon is meant to be the first thing understood,
              before either line of text.
            */}
            <span
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: fact.blocks ? "#F7E7D2" : "#E7F1E7" }}
            >
              <Icon size={16} color={fact.blocks ? "#8B6C37" : "#4A6B4A"} />
            </span>
            <div className="min-w-0">
              <p className="font-body font-normal text-[13.5px] text-ink-faint">{fact.question}</p>
              <p className="font-body font-medium text-[15px] text-navy">{fact.answer}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
