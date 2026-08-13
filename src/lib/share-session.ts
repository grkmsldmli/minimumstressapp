import { zoneAbbreviation } from "./timezone";
import { sessionDayLong } from "./when";

/**
 * What a practitioner sends the person they are bringing with them.
 *
 * A booking has a third party the app has never known about: the client. They
 * are the one who has to find the building, and the practitioner was reading
 * the address off one screen and retyping it into another.
 *
 * So the app writes the message and the phone sends it. Nothing about the
 * client is asked for, stored, or transmitted to us — no email, no number, no
 * consent to collect on somebody else's behalf. The practitioner keeps their
 * own client relationship, which is theirs and not ours to hold.
 *
 * The signature is the safety. It takes a name, a time and a street, and there
 * is no parameter for an access code — so no future edit can add one to this
 * message without changing the shape of the function and meeting this comment.
 * The code belongs to whoever paid for the hour; a client who can let
 * themselves in is a stranger with a studio's door code.
 */

export interface SessionShare {
  spaceName: string;
  startsAt: Date;
  /** The room's own zone. A session at 9pm is 9pm where the room is. */
  timeZone: string;
  /** Null before a listing has been geocoded, which is rare and survivable. */
  addressLine: string | null;
}

export interface ShareText {
  title: string;
  body: string;
}

/**
 * A maps search rather than a pin.
 *
 * Coordinates would drop a marker on a rooftop; the written address is what a
 * mapping app resolves to a door, and it is the same string the listing shows.
 * Nothing personal goes in the query — this is a business address that is
 * already on the studio's own website.
 */
function mapsLink(addressLine: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressLine)}`;
}

export function shareTextFor(session: SessionShare): ShareText {
  const day = sessionDayLong(session.startsAt, session.timeZone);

  /*
   * The zone is always named here, which is the one place in the app that is
   * true.
   *
   * `sessionTime` appends it only when the *viewer* is somewhere else, and
   * that is the right rule for a screen: the person reading it is the person
   * holding the phone. This message is read on a phone we know nothing about.
   * A "9:00 PM" that turns out to have meant a different 9pm is the exact
   * failure this feature exists to prevent, so the abbreviation is not
   * optional.
   */
  const time = session.startsAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: session.timeZone,
  });
  const when = `${day} · ${time} ${zoneAbbreviation(session.startsAt, session.timeZone)}`.trim();

  const lines = [session.spaceName, when];

  if (session.addressLine) {
    lines.push(session.addressLine, mapsLink(session.addressLine));
  }

  return {
    title: `${session.spaceName} — ${day}`,
    body: lines.join("\n"),
  };
}
