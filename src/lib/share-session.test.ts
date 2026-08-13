import { describe, expect, it } from "vitest";

import { shareTextFor } from "./share-session";

/**
 * The message a practitioner forwards to the person they are bringing.
 *
 * Two things are worth pinning. It has to be readable by somebody who has
 * never seen the app — so the time is named with its zone, because it is read
 * on a phone that may be set to another one. And it must never contain the
 * door code, which belongs to whoever paid for the hour.
 */
const SESSION = {
  spaceName: "Reformer Hit",
  // 9pm in San Mateo on a Wednesday.
  startsAt: new Date("2026-08-27T04:00:00Z"),
  timeZone: "America/Los_Angeles",
  addressLine: "1301 W Hillsdale Blvd, San Mateo, CA 94403, USA",
};

describe("the message sent to a client", () => {
  it("names the room, the day and the hour", () => {
    const { body } = shareTextFor(SESSION);

    expect(body).toContain("Reformer Hit");
    expect(body).toContain("Wednesday");
    expect(body).toContain("9:00 PM");
  });

  /**
   * The room's clock, not the sender's and not the reader's. A session at 9pm
   * is 9pm where the room is, and this message is read somewhere else.
   */
  it("gives the time in the room's own zone, named", () => {
    const { body } = shareTextFor(SESSION);

    expect(body).toMatch(/9:00 PM P[DS]T/);
  });

  it("carries the street and a way to open it in maps", () => {
    const { body } = shareTextFor(SESSION);

    expect(body).toContain("1301 W Hillsdale Blvd");
    expect(body).toContain("https://www.google.com/maps/search/");
    expect(body).toContain(encodeURIComponent("1301 W Hillsdale Blvd"));
  });

  /**
   * The whole point of the shape of this function.
   *
   * There is no parameter for a door code, so the only way one reaches a
   * client is if somebody adds a line here — and the assertion is the exact
   * body rather than a pattern, so any added line fails it. A looser check on
   * four digits matched the street number and proved nothing.
   */
  it("sends these four lines and nothing else", () => {
    const { body } = shareTextFor(SESSION);

    expect(body.split("\n")).toEqual([
      "Reformer Hit",
      expect.stringMatching(/^Wednesday, Aug 26 · 9:00 PM P[DS]T$/),
      "1301 W Hillsdale Blvd, San Mateo, CA 94403, USA",
      expect.stringContaining("https://www.google.com/maps/search/"),
    ]);
    expect(body.toLowerCase()).not.toContain("code");
  });

  /** A listing with no address still sends something worth reading. */
  it("survives a room with no address on it", () => {
    const { body } = shareTextFor({ ...SESSION, addressLine: null });

    expect(body).toContain("Reformer Hit");
    expect(body).toContain("9:00 PM");
    expect(body).not.toContain("maps");
  });

  it("titles it with the room and the day", () => {
    expect(shareTextFor(SESSION).title).toBe("Reformer Hit — Wednesday, Aug 26");
  });
});
