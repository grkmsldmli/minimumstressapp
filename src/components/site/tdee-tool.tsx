"use client";

import { useState } from "react";

import { MeasureField, UnitToggle } from "@/components/site/measure-field";
import { ResultActions } from "@/components/site/result-actions";
import {
  type Activity,
  type EnergyResult,
  type Goal,
  type Sex,
  ACTIVITY,
  energyFor,
} from "@/lib/body-composition";

/**
 * Mifflin-St Jeor, plus an activity multiplier and a goal.
 *
 * The one number on this page that matters is the target, and the floor under
 * it sits at 1200 rather than the 900 the original allowed. A calculator that
 * prints a figure is giving permission for it, and 900 is below what anybody
 * should eat without supervision.
 */

const GOALS: { key: Goal; label: string; note: string }[] = [
  { key: "lose", label: "Lose fat", note: "−500 a day" },
  { key: "maintain", label: "Maintain", note: "Your TDEE" },
  { key: "gain", label: "Build muscle", note: "+300 a day" },
];

type Units = "metric" | "imperial";

export function TdeeTool() {
  const [units, setUnits] = useState<Units>("metric");
  const [sex, setSex] = useState<Sex | null>(null);
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [feet, setFeet] = useState("");
  const [inches, setInches] = useState("");
  const [weight, setWeight] = useState("");
  const [activity, setActivity] = useState<Activity>("moderate");
  const [goal, setGoal] = useState<Goal>("maintain");

  const [result, setResult] = useState<EnergyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (!sex) {
      setError("Pick one — the equation uses a different constant for each.");
      return;
    }

    const heightCm =
      units === "metric" ? Number(height) : (Number(feet) * 12 + Number(inches || 0)) * 2.54;
    const weightKg = units === "metric" ? Number(weight) : Number(weight) * 0.453592;
    const years = Number(age);

    if (!heightCm || !weightKg || !years) {
      setError("Fill in age, height and weight.");
      return;
    }
    if (heightCm < 120 || heightCm > 230) {
      setError("Check the height — it should be between about 120cm and 230cm.");
      return;
    }
    if (weightKg < 25 || weightKg > 300) {
      setError("Check the weight — it should be between about 25kg and 300kg.");
      return;
    }
    if (years < 15 || years > 100) {
      setError("This equation is for adults, roughly 15 to 100.");
      return;
    }

    setResult(energyFor({ sex, age: years, heightCm, weightKg, activity, goal }));
  };

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
                  ? { border: "1px solid #E8502A", backgroundColor: "#fff5f2", color: "#0F2F55" }
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

          <MeasureField label="Age" unit="yrs" value={age} onChange={setAge} placeholder="30" />
        </div>

        <p className="mt-6 text-[11px] uppercase tracking-[0.1em]" style={{ color: "#8a94a3" }}>
          Activity
        </p>
        <div className="mt-2 space-y-2">
          {(Object.keys(ACTIVITY) as Activity[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setActivity(key)}
              aria-pressed={activity === key}
              className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-[14.5px]"
              style={
                activity === key
                  ? { border: "1px solid #E8502A", backgroundColor: "#fff5f2", color: "#0F2F55" }
                  : { border: "1px solid #e7eef6", color: "#5f6673" }
              }
            >
              <span>{ACTIVITY[key].label}</span>
              <span className="text-[12px]" style={{ color: "#98a2b3" }}>
                ×{ACTIVITY[key].multiplier}
              </span>
            </button>
          ))}
        </div>

        <p className="mt-6 text-[11px] uppercase tracking-[0.1em]" style={{ color: "#8a94a3" }}>
          Goal
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {GOALS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setGoal(option.key)}
              aria-pressed={goal === option.key}
              className="rounded-xl px-4 py-3 text-[14.5px]"
              style={
                goal === option.key
                  ? { border: "1px solid #E8502A", backgroundColor: "#fff5f2", color: "#0F2F55" }
                  : { border: "1px solid #e7eef6", color: "#5f6673" }
              }
            >
              <span className="block">{option.label}</span>
              <span className="block text-[12px]" style={{ color: "#98a2b3" }}>
                {option.note}
              </span>
            </button>
          ))}
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

      {result && <Result result={result} goal={goal} />}
    </div>
  );
}

function Result({ result, goal }: { result: EnergyResult; goal: Goal }) {
  const { proteinG, carbsG, fatG } = result.macros;
  const calories = proteinG * 4 + carbsG * 4 + fatG * 9;
  const share = (grams: number, perGram: number) => Math.round(((grams * perGram) / calories) * 100);

  const macros = [
    { label: "Protein", grams: proteinG, percent: share(proteinG, 4), colour: "#E8502A" },
    { label: "Carbohydrate", grams: carbsG, percent: share(carbsG, 4), colour: "#3B6FD4" },
    { label: "Fat", grams: fatG, percent: share(fatG, 9), colour: "#EF9F27" },
  ];

  const floored = goal === "lose" && result.target === 1200;

  return (
    <div className="mt-10 rounded-2xl p-7" style={{ border: "1px solid #e7eef6" }} aria-live="polite">
      <p className="text-[11px] uppercase tracking-[0.1em]" style={{ color: "#E8502A" }}>
        {goal === "lose" ? "To lose fat" : goal === "gain" ? "To build muscle" : "To maintain"}
      </p>
      <p className="mt-1 text-[52px] leading-none" style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}>
        {result.target.toLocaleString()}
      </p>
      <p className="text-[14px]" style={{ color: "#8a94a3" }}>
        calories a day
      </p>

      {/*
        Said out loud when it happens. The number stopped being the arithmetic
        and started being a floor, and somebody following it should know that
        rather than assume the equation produced it.
      */}
      {floored && (
        <p className="mt-4 text-[14px] leading-[1.75]" style={{ color: "#C0392B" }}>
          The deficit you asked for would have gone below 1,200, which is lower than anybody
          should eat without a doctor watching. This is the floor, not the sum.
        </p>
      )}

      <div className="mt-6 grid gap-3 border-t pt-5 sm:grid-cols-2" style={{ borderColor: "#eef2f6" }}>
        <Figure label="At rest (BMR)" value={result.bmr.toLocaleString()} />
        <Figure label="With activity (TDEE)" value={result.tdee.toLocaleString()} />
      </div>

      <p className="mt-7 text-[14px] font-medium" style={{ color: "#0F2F55" }}>
        Macros for that target
      </p>
      <div className="mt-3 space-y-3">
        {macros.map((macro) => (
          <div key={macro.label}>
            <div className="flex items-baseline justify-between text-[14px]">
              <span style={{ color: "#0F2F55" }}>{macro.label}</span>
              <span style={{ color: "#8a94a3" }}>
                {macro.grams}g · {macro.percent}%
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full" style={{ backgroundColor: "#eef2f6" }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${macro.percent}%`, backgroundColor: macro.colour }}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="mt-6 text-[14px] leading-[1.75]" style={{ color: "#8a94a3" }}>
        An estimate, not a measurement. Real needs vary with sleep, stress, illness and how much
        you move without noticing. Track the trend over two or three weeks rather than one day.
      </p>

      {/*
        Four numbers and three macros is more than anybody memorises walking
        away from a page, and this is the one result here somebody actually
        has to refer back to while shopping.
      */}
      <ResultActions
        accent="#0F2F55"
        result={{
          slug: "tdee-calculator",
          toolName: "Calorie & Macro Calculator",
          score: result.target.toLocaleString(),
          band: "calories a day",
          summary:
            goal === "lose"
              ? "To lose fat, at the pace this assumes."
              : goal === "gain"
                ? "To build muscle, at the pace this assumes."
                : "To maintain where you are.",
          story: `${result.bmr.toLocaleString()} at rest, ${result.tdee.toLocaleString()} with your activity, and ${result.target.toLocaleString()} once your goal is applied.`,
          dimensions: macros.map((macro) => ({
            label: `${macro.label} · ${macro.grams}g`,
            value: macro.percent,
          })),
          insights: [
            ...(floored
              ? [
                  "The deficit you asked for would have gone below 1,200 calories, which is lower than anybody should eat without a doctor watching. Your target is that floor, not the sum.",
                ]
              : []),
            "An estimate, not a measurement. Real needs vary with sleep, stress, illness and how much you move without noticing.",
            "Track the trend over two or three weeks rather than one day.",
          ],
        }}
      />
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
