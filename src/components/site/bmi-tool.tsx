"use client";

import { useState } from "react";

import { ResultActions } from "@/components/site/result-actions";
import {
  BAND_COPY,
  type BmiResult,
  bmiFor,
  heightFromImperial,
  kilosFromPounds,
} from "@/lib/bmi";

/**
 * The form, and the only interactive part of the page.
 *
 * Two fields. The Shopify version also asked for age and sex, validated
 * neither, and passed neither into the formula — personal information
 * collected because a form looked more thorough with it on. BMI is weight over
 * height squared and nothing else, so that is what it asks for.
 */

type Units = "metric" | "imperial";

const BAND_COLOUR: Record<string, string> = {
  under: "#3B82F6",
  healthy: "#1D9E75",
  over: "#EF9F27",
  obese: "#C0392B",
};

export function BmiTool() {
  const [units, setUnits] = useState<Units>("metric");
  const [cm, setCm] = useState("");
  const [kg, setKg] = useState("");
  const [feet, setFeet] = useState("");
  const [inches, setInches] = useState("");
  const [pounds, setPounds] = useState("");

  const [result, setResult] = useState<BmiResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const heightCm =
      units === "metric" ? Number(cm) : heightFromImperial(Number(feet), Number(inches || 0));
    const weightKg = units === "metric" ? Number(kg) : kilosFromPounds(Number(pounds));

    /*
     * Bounds rather than a bare "required". A height of 17 is a typo for 170,
     * and left through it produces a BMI in the thousands and a page that
     * confidently tells somebody they are severely obese.
     */
    if (!heightCm || heightCm < 120 || heightCm > 230) {
      setError("Check the height — it should be between about 120cm and 230cm.");
      setResult(null);
      return;
    }
    if (!weightKg || weightKg < 25 || weightKg > 300) {
      setError("Check the weight — it should be between about 25kg and 300kg.");
      setResult(null);
      return;
    }

    setResult(bmiFor(heightCm, weightKg));
  };

  const showKg = (value: number) =>
    units === "metric" ? `${value}kg` : `${Math.round(value / 0.453592)}lb`;

  return (
    <div>
      <div
        className="inline-flex rounded-full p-1"
        style={{ backgroundColor: "#f1f5f9" }}
        role="group"
        aria-label="Units"
      >
        {(["metric", "imperial"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setUnits(option)}
            aria-pressed={units === option}
            className="rounded-full px-5 py-2 text-[14px] font-medium capitalize"
            style={
              units === option
                ? { backgroundColor: "#0F2F55", color: "#fff" }
                : { color: "#5f6673" }
            }
          >
            {option}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {units === "metric" ? (
            <>
              <Field label="Height" unit="cm" value={cm} onChange={setCm} placeholder="175" />
              <Field label="Weight" unit="kg" value={kg} onChange={setKg} placeholder="70" />
            </>
          ) : (
            <>
              <div className="flex gap-3">
                <Field label="Height" unit="ft" value={feet} onChange={setFeet} placeholder="5" />
                <Field label="&nbsp;" unit="in" value={inches} onChange={setInches} placeholder="9" />
              </div>
              <Field label="Weight" unit="lb" value={pounds} onChange={setPounds} placeholder="154" />
            </>
          )}
        </div>

        {error && (
          <p className="mt-4 text-[14px]" style={{ color: "#C0392B" }} role="alert">
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

      {result && <Result result={result} showKg={showKg} />}
    </div>
  );
}

function Field({
  label,
  unit,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block flex-1">
      <span
        className="block text-[11px] uppercase tracking-[0.1em]"
        style={{ color: "#8a94a3" }}
        dangerouslySetInnerHTML={{ __html: label }}
      />
      <span className="mt-1.5 flex overflow-hidden rounded-xl" style={{ border: "1px solid #e7eef6" }}>
        <input
          type="number"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="w-full min-w-0 bg-white px-4 py-3.5 text-[16px] outline-none"
          style={{ color: "#0F2F55" }}
        />
        <span
          className="flex items-center px-4 text-[13px]"
          style={{ backgroundColor: "#f8fbfd", color: "#8a94a3" }}
        >
          {unit}
        </span>
      </span>
    </label>
  );
}

function Result({ result, showKg }: { result: BmiResult; showKg: (kg: number) => string }) {
  const copy = BAND_COPY[result.band];
  const colour = BAND_COLOUR[result.band];

  return (
    <div className="mt-10 rounded-2xl p-7" style={{ border: "1px solid #e7eef6" }} aria-live="polite">
      <div className="flex flex-wrap items-baseline gap-x-4">
        <span
          className="text-[52px] leading-none"
          style={{ fontFamily: "var(--font-dm-serif)", color: colour }}
        >
          {result.bmi}
        </span>
        <span className="text-[16px]" style={{ color: "#0F2F55" }}>
          {copy.label}
        </span>
      </div>

      <p className="mt-4 text-[15px] leading-[1.8]" style={{ color: "#5f6673" }}>
        {copy.body}
      </p>

      <div className="mt-6 border-t pt-5 text-[14.5px] leading-[1.8]" style={{ borderColor: "#eef2f6", color: "#5f6673" }}>
        <p>
          For your height, the healthy range is{" "}
          <strong style={{ color: "#0F2F55" }}>
            {showKg(result.healthyLowKg)} to {showKg(result.healthyHighKg)}
          </strong>
          .
        </p>
        {result.toRangeKg > 0 && (
          <p className="mt-1">
            You are {showKg(result.toRangeKg)} from the nearest edge of it.
          </p>
        )}
      </div>

      <ResultActions
        accent="#0F2F55"
        result={{
          slug: "bmi-calculator",
          toolName: "BMI Calculator",
          score: String(result.bmi),
          band: copy.label,
          summary: `For your height, the healthy range is ${showKg(result.healthyLowKg)} to ${showKg(result.healthyHighKg)}.`,
          story: copy.body,
          /*
           * The caveat travels with the number. A BMI arriving on its own in
           * an inbox, days later and without the page around it, is exactly
           * the reading of it this tool spends its whole result page arguing
           * against.
           */
          insights: [
            result.toRangeKg > 0
              ? `You are ${showKg(result.toRangeKg)} from the nearest edge of that range.`
              : "You are inside that range.",
            "BMI is weight over height squared. It knows nothing about muscle, frame or how you feel, and it was never designed to describe one person.",
          ],
        }}
      />
    </div>
  );
}
