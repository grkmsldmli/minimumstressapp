import { AlertTriangle, CircleParking } from "lucide-react";

import { type Parking, parkingFacts } from "@/lib/parking";

/**
 * Where somebody leaves the car, on the listing.
 *
 * Silent when the host has not answered, unlike the accessibility panel next
 * to it. The difference is what an absence costs: not knowing whether a
 * doorway is wide enough can strand somebody outside a building, so it is
 * worth saying out loud. Not knowing about parking costs a lap of the block.
 * Announcing every unanswered field turns a listing into a list of complaints
 * about the host.
 *
 * The one thing said in a stronger voice is a time limit shorter than the
 * session, because that is not an inconvenience — it is a car that has to move
 * before the hour is up.
 */
export function ParkingPanel({ parking }: { parking: Parking }) {
  const facts = parkingFacts(parking);
  if (facts.length === 0) return null;

  return (
    <div>
      {/*
        Said out loud, because a car icon was not saying it.
        These chips read "Free" and "2 hours maximum" with a small car beside
        them, which could as easily have been about getting there as about
        leaving something behind. The heading names the subject once; the P
        carries it after that.
      */}
      <div className="flex items-center gap-2 mb-2">
        <CircleParking size={16} color="#2578C2" className="shrink-0" />
        <p className="font-body font-medium text-[13.5px] text-ink-soft">Parking</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {facts.map((fact) => (
          <span
            key={fact.answer}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-body text-[13.5px]"
            style={{
              backgroundColor: fact.warns ? "#FFF8F1" : "#F4F8FC",
              border: `1px solid ${fact.warns ? "#F5DFC4" : "#DCE7F2"}`,
              color: fact.warns ? "#8B6C37" : "#2E5578",
            }}
          >
            {/*
              The warning triangle stays where it is earning its keep: a limit
              shorter than the session is a car that has to be moved mid-hour,
              which is the one thing here worth interrupting somebody for.
            */}
            {fact.warns ? (
              <AlertTriangle size={12} className="shrink-0" />
            ) : (
              <CircleParking size={13} className="shrink-0" />
            )}
            {fact.answer}
          </span>
        ))}
      </div>
    </div>
  );
}
