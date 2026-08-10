/**
 * Where somebody leaves the car.
 *
 * A practitioner arriving by car has three questions and they arrive in this
 * order: is there anywhere to park, will it cost me, and can I leave it there
 * for the whole session. The third one is the one a listings site normally
 * misses, and it is the one that matters most here — this marketplace sells
 * hours, and a two-hour street limit is fine while a one-hour limit means
 * walking out mid-session to move the car, or a ticket.
 *
 * Several answers at once, because a studio can have two spaces out front and
 * a street anybody can use. A single choice would force the host to pick the
 * better one and leave out the one somebody actually needs.
 */

import { SESSION_MINUTES } from "./session";

export const PARKING_OPTIONS = [
  { key: "lot", label: "Private lot" },
  { key: "street", label: "Street parking" },
  { key: "garage", label: "Garage nearby" },
  { key: "valet", label: "Valet" },
  { key: "free", label: "Free" },
  { key: "paid", label: "Paid" },
  { key: "permit", label: "Permit or meter" },
  { key: "none", label: "No parking" },
] as const;

export type ParkingKey = (typeof PARKING_OPTIONS)[number]["key"];

export function isParkingKey(value: unknown): value is ParkingKey {
  return PARKING_OPTIONS.some((option) => option.key === value);
}

export function parkingLabel(key: string): string {
  return PARKING_OPTIONS.find((option) => option.key === key)?.label ?? key;
}

export interface Parking {
  /** Keys from PARKING_OPTIONS. Empty means the host has not answered. */
  options: string[];
  /**
   * How long a car may stay, in minutes. Null means no limit, which is the
   * usual answer for a private lot and never a safe assumption for a street.
   */
  limitMinutes: number | null;
}

/** Time limits a host can pick, in minutes. Anything longer is "no limit". */
export const PARKING_LIMIT_OPTIONS = [30, 60, 90, 120, 180] as const;

export interface ParkingFact {
  answer: string;
  /**
   * Whether this is a problem rather than a detail.
   *
   * Same idea as the accessibility facts: not a score. A limit shorter than
   * the session is not "less convenient parking", it is a car that has to be
   * moved before the hour is up.
   */
  warns: boolean;
}

/**
 * True when the car has to move before the session ends.
 *
 * Measured against the session plus a little, because the limit starts when
 * the car is parked rather than when the session starts — somebody arriving
 * ten minutes early on a sixty-minute limit is already short.
 */
const ARRIVAL_ALLOWANCE_MINUTES = 15;

export function limitOutlastsSession(limitMinutes: number | null): boolean {
  if (limitMinutes === null) return true;
  return limitMinutes >= SESSION_MINUTES + ARRIVAL_ALLOWANCE_MINUTES;
}

/** What to show a practitioner, in the order they would ask. */
export function parkingFacts(parking: Parking): ParkingFact[] {
  if (parking.options.length === 0) return [];

  if (parking.options.includes("none")) {
    return [{ answer: "No parking at this address", warns: true }];
  }

  const facts: ParkingFact[] = PARKING_OPTIONS.filter(
    (option) => option.key !== "none" && parking.options.includes(option.key),
  ).map((option) => ({ answer: option.label, warns: false }));

  if (parking.limitMinutes !== null) {
    const hours = parking.limitMinutes / 60;
    const spelled =
      parking.limitMinutes < 60
        ? `${parking.limitMinutes} minutes`
        : `${hours % 1 === 0 ? hours : hours.toFixed(1)} hour${hours === 1 ? "" : "s"}`;

    facts.push({
      answer: `${spelled} maximum`,
      warns: !limitOutlastsSession(parking.limitMinutes),
    });
  }

  return facts;
}
