import { AlertTriangle, Car } from "lucide-react";

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
          {fact.warns ? (
            <AlertTriangle size={12} className="shrink-0" />
          ) : (
            <Car size={12} className="shrink-0" />
          )}
          {fact.answer}
        </span>
      ))}
    </div>
  );
}
