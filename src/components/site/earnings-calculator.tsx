"use client";

import { useState } from "react";

import { MeasureField } from "@/components/site/measure-field";
import { APP_URL } from "@/lib/company";
import { DEFAULT_OCCUPANCY, OCCUPANCIES, earningsFor } from "@/lib/host-earnings";
import { SERVICE_FEE_RATE } from "@/lib/money";

/**
 * What the empty hours are worth, worked out on the page.
 *
 * A host with a spare treatment room has almost never put a figure on the
 * hours it stands unused. "It's free on Tuesdays" is not a number. "$540 a
 * month" is, and that is the whole distance between an idea and a decision —
 * which is why this sits in the middle of the page rather than at the end of
 * it.
 *
 * It asks for the host's own rate rather than suggesting one. There are no
 * listings yet, so any figure we printed as typical would be invented, and a
 * made-up market rate is the fastest way to lose the person this page is for.
 * When there are enough real rooms in a town to have a median, that is what
 * the placeholder becomes.
 *
 * Occupancy is a control, not an assumption. Multiplying every free hour by
 * the rate quotes a number nobody achieves; hiding a fraction inside the sum
 * quotes it dishonestly. Both ways the host finds out in month one.
 */

const HOUR_STEPS = [4, 8, 12, 20, 30];

function dollars(cents: number): string {
  // Whole dollars. This is an estimate from an estimate, and printing cents on
  // it would claim a precision the number does not have.
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

export function EarningsCalculator({ roomLabel }: { roomLabel: string }) {
  const [rate, setRate] = useState("45");
  const [hours, setHours] = useState(8);
  // Typed as a number, not as the literal the first option happens to be —
  // `as const` on OCCUPANCIES narrows it to 0.25 otherwise, and the other
  // two buttons stop compiling.
  const [occupancy, setOccupancy] = useState<number>(DEFAULT_OCCUPANCY);

  const rateCents = Math.round(Number(rate) * 100);
  const valid = Number.isFinite(rateCents) && rateCents > 0;

  const earnings = earningsFor({
    hourlyRateCents: valid ? rateCents : 0,
    freeHoursPerWeek: hours,
    occupancy,
  });

  return (
    <div
      className="rounded-2xl p-6 sm:p-8"
      style={{ backgroundColor: "#f8fbfd", border: "1px solid #e7eef6" }}
    >
      <h2
        className="text-[26px] leading-tight sm:text-[30px]"
        style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
      >
        What could your {roomLabel.toLowerCase()} earn?
      </h2>
      <p className="mt-2 text-[15px] leading-[1.7]" style={{ color: "#5f6673" }}>
        Your numbers, not ours. Nothing is sent anywhere.
      </p>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <MeasureField
          label="Your hourly rate"
          unit="$/hr"
          value={rate}
          onChange={setRate}
          placeholder="45"
          hint="You keep this. The fee is added on top."
        />

        <div>
          <span className="block text-[11px] uppercase tracking-[0.1em]" style={{ color: "#8a94a3" }}>
            Free hours a week
          </span>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {HOUR_STEPS.map((step) => (
              <button
                key={step}
                type="button"
                aria-pressed={hours === step}
                onClick={() => setHours(step)}
                className="rounded-full px-4 py-2 text-[14px]"
                style={
                  hours === step
                    ? { backgroundColor: "#0F2F55", color: "#fff" }
                    : { border: "1px solid #e7eef6", color: "#5f6673", backgroundColor: "#fff" }
                }
              >
                {step}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[13px]" style={{ color: "#8a94a3" }}>
            Hours you would be happy for someone else to be in it.
          </p>
        </div>
      </div>

      {/*
        The assumption, on screen and adjustable, rather than folded into the
        arithmetic. A host who can see it is a host who can argue with it —
        which is the only reason to believe the rest of the number.
      */}
      <div className="mt-6">
        <span className="block text-[11px] uppercase tracking-[0.1em]" style={{ color: "#8a94a3" }}>
          If this many of them book
        </span>
        <div className="mt-1.5 flex flex-wrap gap-2" role="group" aria-label="If this many of them book">
          {OCCUPANCIES.map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={occupancy === option.value}
              onClick={() => setOccupancy(option.value)}
              className="rounded-full px-4 py-2 text-[14px]"
              style={
                occupancy === option.value
                  ? { backgroundColor: "#0F2F55", color: "#fff" }
                  : { border: "1px solid #e7eef6", color: "#5f6673", backgroundColor: "#fff" }
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-7 border-t pt-6" style={{ borderColor: "#e7eef6" }}>
        <p className="text-[11px] uppercase tracking-[0.1em]" style={{ color: "#8a94a3" }}>
          About
        </p>
        <p
          className="mt-1 text-[46px] leading-none sm:text-[56px]"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
        >
          {valid ? dollars(earnings.monthlyCents) : "—"}
          <span className="text-[17px]" style={{ color: "#5f6673" }}> a month</span>
        </p>

        {valid && (
          <p className="mt-3 text-[15px] leading-[1.7]" style={{ color: "#5f6673" }}>
            {dollars(earnings.yearlyCents)} a year, from about{" "}
            {Math.round(earnings.bookedHoursPerMonth)} booked hours a month. A practitioner would
            pay {dollars(earnings.practitionerPaysCents)} for one of them — your rate plus the{" "}
            {Math.round(SERVICE_FEE_RATE * 100)}% fee, which is theirs to pay, not yours.
          </p>
        )}

        {/*
          Said plainly rather than in small print. This is a page about money
          somebody might rearrange their week around, and the honest version
          of it is more persuasive than the confident one — a host who is told
          up front that nothing books solid is a host who is not disappointed
          in month two.
        */}
        <p className="mt-4 text-[13.5px] leading-[1.7]" style={{ color: "#8a94a3" }}>
          An estimate from the numbers above, not a forecast. Nobody books every free hour, which
          is why the share that books is yours to set here rather than hidden in the sum. What you
          actually earn depends on your town, your hours and your room.
        </p>

        <a
          href={`${APP_URL}?list=1`}
          className="mt-6 inline-block rounded-full px-7 py-3.5 text-[15px] font-medium text-white"
          style={{ backgroundColor: "#0F2F55" }}
        >
          List your space
        </a>
        <p className="mt-2 text-[13px]" style={{ color: "#8a94a3" }}>
          About ten minutes. You set the hours and the rate, and can change both.
        </p>
      </div>
    </div>
  );
}
