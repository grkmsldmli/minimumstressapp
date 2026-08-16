"use client";

import { useState } from "react";

import { MeasureField, UnitToggle } from "@/components/site/measure-field";
import {
  type BodyFatResult,
  type Sex,
  FAT_BAND_COPY,
  bodyFatFor,
} from "@/lib/body-composition";

/**
 * The U.S. Navy circumference method, which needs a tape measure and four
 * numbers — five for women, since the formula uses the hips.
 *
 * The measuring instructions are beside the fields rather than in a folded
 * panel above them. Where you put the tape is the single biggest source of
 * error in this method, and an instruction nobody reads is not an instruction.
 */

const BAND_COLOUR = {
  essential: "#3B82F6",
  athletic: "#1D9E75",
  fitness: "#2D8C4E",
  average: "#EF9F27",
  high: "#C0392B",
} as const;

const BAND_LABEL = {
  essential: "Essential fat",
  athletic: "Athletic",
  fitness: "Fitness",
  average: "Average",
  high: "Above average",
} as const;

type Units = "metric" | "imperial";

export function BodyFatTool() {
  const [units, setUnits] = useState<Units>("metric");
  const [sex, setSex] = useState<Sex | null>(null);

  const [height, setHeight] = useState("");
  const [feet, setFeet] = useState("");
  const [inches, setInches] = useState("");
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [neck, setNeck] = useState("");
  const [hips, setHips] = useState("");

  const [result, setResult] = useState<BodyFatResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (!sex) {
      setError("Pick one — the formula is different for men and women, and this is the only thing it uses that for.");
      return;
    }

    const toInches = (value: string) =>
      units === "metric" ? Number(value) / 2.54 : Number(value);

    const heightIn =
      units === "metric" ? Number(height) / 2.54 : Number(feet) * 12 + Number(inches || 0);
    const weightKg = units === "metric" ? Number(weight) : Number(weight) * 0.453592;
    const waistIn = toInches(waist);
    const neckIn = toInches(neck);
    const hipIn = sex === "female" ? toInches(hips) : 0;

    if (!heightIn || !weightKg || !waistIn || !neckIn || (sex === "female" && !hipIn)) {
      setError("Fill in every measurement — the formula needs all of them.");
      return;
    }

    /*
     * Checked before the logarithms rather than clamped after. A waist smaller
     * than a neck is a swapped pair of numbers, and the formula answers it with
     * a logarithm of something at or below zero — NaN, or a clamped 3% that
     * looks like a real answer.
     */
    if (sex === "male" && waistIn <= neckIn) {
      setError("Waist should be larger than neck — check whether those two got swapped.");
      return;
    }
    if (sex === "female" && waistIn + hipIn <= neckIn) {
      setError("Check the waist, hip and neck measurements — those numbers cannot all be right.");
      return;
    }

    setResult(bodyFatFor({ sex, heightIn, waistIn, neckIn, hipIn, weightKg }));
  };

  const lengthUnit = units === "metric" ? "cm" : "in";
  const showKg = (value: number) =>
    units === "metric" ? `${value}kg` : `${Math.round(value / 0.453592)}lb`;

  return (
    <div>
      <UnitToggle options={["metric", "imperial"] as const} value={units} onChange={setUnits} />

      <form onSubmit={submit} className="mt-6">
        <p className="text-[11px] uppercase tracking-[0.1em]" style={{ color: "#8a94a3" }}>
          Sex
        </p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {(["female", "male"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSex(option)}
              aria-pressed={sex === option}
              className="rounded-xl py-3 text-[15px] capitalize"
              style={
                sex === option
                  ? { border: "1px solid #1D6FA8", backgroundColor: "#f0f6ff", color: "#0F2F55" }
                  : { border: "1px solid #e7eef6", color: "#5f6673" }
              }
            >
              {option}
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {units === "metric" ? (
            <MeasureField label="Height" unit="cm" value={height} onChange={setHeight} placeholder="175" />
          ) : (
            <div className="flex gap-3">
              <MeasureField label="Height" unit="ft" value={feet} onChange={setFeet} placeholder="5" />
              <MeasureField label="&nbsp;" unit="in" value={inches} onChange={setInches} placeholder="9" />
            </div>
          )}

          <MeasureField
            label="Weight"
            unit={units === "metric" ? "kg" : "lb"}
            value={weight}
            onChange={setWeight}
            placeholder={units === "metric" ? "70" : "154"}
          />

          <MeasureField
            label="Waist"
            unit={lengthUnit}
            value={waist}
            onChange={setWaist}
            placeholder={units === "metric" ? "80" : "32"}
            hint="At the navel, on a relaxed breath out. Do not hold it in."
          />

          <MeasureField
            label="Neck"
            unit={lengthUnit}
            value={neck}
            onChange={setNeck}
            placeholder={units === "metric" ? "38" : "15"}
            hint="Just below the larynx, tape sloping slightly down at the front."
          />

          {sex === "female" && (
            <MeasureField
              label="Hips"
              unit={lengthUnit}
              value={hips}
              onChange={setHips}
              placeholder={units === "metric" ? "95" : "37"}
              hint="The widest point, feet together."
            />
          )}
        </div>

        {error && (
          <p className="mt-4 text-[14px] leading-relaxed" style={{ color: "#C0392B" }} role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="mt-6 w-full rounded-xl py-4 text-[15px] font-medium text-white sm:w-auto sm:px-10"
          style={{ backgroundColor: "#0F2F55" }}
        >
          Calculate
        </button>
      </form>

      {result && (
        <div
          className="mt-10 rounded-2xl p-7"
          style={{ border: "1px solid #e7eef6" }}
          aria-live="polite"
        >
          <div className="flex flex-wrap items-baseline gap-x-4">
            <span
              className="text-[52px] leading-none"
              style={{ fontFamily: "var(--font-dm-serif)", color: BAND_COLOUR[result.band] }}
            >
              {result.percent}%
            </span>
            <span className="text-[16px]" style={{ color: "#0F2F55" }}>
              {BAND_LABEL[result.band]}
            </span>
          </div>

          <p className="mt-4 text-[15px] leading-[1.8]" style={{ color: "#5f6673" }}>
            {FAT_BAND_COPY[result.band]}
          </p>

          <div className="mt-6 grid gap-3 border-t pt-5 sm:grid-cols-2" style={{ borderColor: "#eef2f6" }}>
            <Figure label="Lean mass" value={showKg(result.leanKg)} />
            <Figure label="Fat mass" value={showKg(result.fatKg)} />
          </div>

          <p className="mt-5 text-[14px] leading-[1.75]" style={{ color: "#8a94a3" }}>
            Estimated from tape measurements, so it is only as good as the tape. Measure the same
            way each time and the change over weeks means more than any single reading.
          </p>
        </div>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: "#f8fbfd" }}>
      <p className="text-[11px] uppercase tracking-[0.1em]" style={{ color: "#8a94a3" }}>
        {label}
      </p>
      <p className="mt-1 text-[22px]" style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}>
        {value}
      </p>
    </div>
  );
}
