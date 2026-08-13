/**
 * What "accessible" means for a particular room.
 *
 * It used to be a boolean, rendered as a chip reading "Wheelchair accessible".
 * Somebody who uses a wheelchair cannot act on that: a step at the front door,
 * a lift too narrow to turn in and a restroom they cannot use are all
 * compatible with a ticked box. The chip looked like an answer and was not one.
 *
 * It also asked hosts a question most of them could not answer honestly. A
 * studio with one shallow step at the entrance is neither accessible nor
 * inaccessible, and the room itself may be perfect — so the box gets ticked in
 * good faith and somebody is stranded on a pavement.
 *
 * Four facts instead, each one a place people are actually stopped.
 */

export type EntranceAccess = "step_free" | "one_step" | "steps";
export type FloorAccess = "ground_floor" | "lift" | "stairs_only";
export type RestroomAccess = "accessible" | "standard" | "none";

/** Anything wide enough for most wheelchairs. Below this, say the number. */
export const COMFORTABLE_DOORWAY_INCHES = 32;

export interface AccessDetails {
  entrance: EntranceAccess | null;
  floor: FloorAccess | null;
  doorwayInches: number | null;
  restroom: RestroomAccess | null;
}

/**
 * Which picture belongs beside an answer.
 *
 * A name rather than a component, so this file stays free of the icon library
 * and can go on being tested as arithmetic over strings. The screen maps them.
 *
 * Each one draws the thing described, not the person it might matter to. An
 * earlier pass put the wheelchair symbol on every answer that cleared a path —
 * three of them down a Pilates listing — which turned "how do you get in" into
 * a page about disability facilities. That is a narrower question than the one
 * this panel answers: whether there is a step, which floor, where the restroom
 * is. Everyone booking wants those, and a symbol aimed at one reader tells the
 * rest that the section is not for them.
 *
 * It survives in exactly one place, where the answer itself is the claim: an
 * accessible restroom is not a restroom with a picture on the door, it is the
 * word the host chose over "standard".
 */
export type AccessIcon =
  | "door"
  | "stairs"
  | "lift"
  | "width"
  | "restroom"
  | "accessible_restroom"
  | "none";

export interface AccessFact {
  /** What the host was asked. */
  question: string;
  /** Their answer, in the words a practitioner needs. */
  answer: string;
  icon: AccessIcon;
  /**
   * Whether this particular fact is an obstacle.
   *
   * Not a score. A room with steps is not "less accessible" — it is a room
   * somebody cannot enter, and a rating would blur that into a number.
   */
  blocks: boolean;
}

type Answer = { answer: string; blocks: boolean; icon: AccessIcon };

const ENTRANCE: Record<EntranceAccess, Answer> = {
  step_free: { answer: "Step-free from the street", blocks: false, icon: "door" },
  one_step: { answer: "One step at the entrance", blocks: true, icon: "stairs" },
  steps: { answer: "Steps at the entrance", blocks: true, icon: "stairs" },
};

const FLOOR: Record<FloorAccess, Answer> = {
  ground_floor: { answer: "On the ground floor", blocks: false, icon: "door" },
  lift: { answer: "Lift to the floor", blocks: false, icon: "lift" },
  stairs_only: { answer: "Stairs only", blocks: true, icon: "stairs" },
};

const RESTROOM: Record<RestroomAccess, Answer> = {
  accessible: { answer: "Accessible restroom", blocks: false, icon: "accessible_restroom" },
  standard: { answer: "Standard restroom", blocks: false, icon: "restroom" },
  none: { answer: "No restroom on site", blocks: true, icon: "none" },
};

/**
 * The answered facts, in the order somebody meets them.
 *
 * Street, then door, then floor, then restroom — the order of a journey rather
 * than the order the columns happen to sit in.
 *
 * Unanswered questions are left out rather than shown as "no". A host who has
 * not measured a doorway has not said it is narrow, and turning silence into a
 * refusal would be the same fault as turning it into a promise.
 */
export function accessFacts(details: AccessDetails): AccessFact[] {
  const facts: AccessFact[] = [];

  if (details.entrance) {
    facts.push({ question: "Entrance", ...ENTRANCE[details.entrance] });
  }

  if (details.floor) {
    facts.push({ question: "Getting to the room", ...FLOOR[details.floor] });
  }

  if (details.doorwayInches !== null) {
    const wide = details.doorwayInches >= COMFORTABLE_DOORWAY_INCHES;
    facts.push({
      question: "Narrowest doorway",
      // The number either way. "Wide enough" is a judgement about a body we
      // know nothing about; the measurement lets somebody make their own.
      answer: `${details.doorwayInches} inches`,
      icon: "width",
      blocks: !wide,
    });
  }

  if (details.restroom) {
    facts.push({ question: "Restroom", ...RESTROOM[details.restroom] });
  }

  return facts;
}

/** True when the host has not answered any of it. */
export function accessUnanswered(details: AccessDetails): boolean {
  return accessFacts(details).length === 0;
}

/**
 * Whether anything here would stop somebody using a wheelchair.
 *
 * Deliberately not the inverse — "nothing blocks" is not "accessible", because
 * unanswered questions are not answers. A room with no obstacles among four
 * answered facts is described by those facts, not by a badge.
 */
export function hasAccessObstacle(details: AccessDetails): boolean {
  return accessFacts(details).some((fact) => fact.blocks);
}
