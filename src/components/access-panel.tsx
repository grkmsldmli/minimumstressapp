"use client";

import { AlertTriangle, Check, Accessibility } from "lucide-react";

import { type AccessDetails, accessFacts, accessUnanswered } from "@/lib/access-details";

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
      {facts.map((fact, i) => (
        <div
          key={fact.question}
          className="px-3.5 py-2.5 flex items-start gap-2.5"
          style={{
            borderTop: i === 0 ? undefined : "1px solid #E7EEF6",
            backgroundColor: fact.blocks ? "#FFF8F1" : "#fff",
          }}
        >
          {fact.blocks ? (
            <AlertTriangle size={13} color="#8B6C37" className="mt-0.5 shrink-0" />
          ) : (
            <Check size={13} color="#557255" className="mt-0.5 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="font-body font-normal text-[13.5px] text-ink-faint">{fact.question}</p>
            <p className="font-body font-medium text-[15px] text-navy">{fact.answer}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
