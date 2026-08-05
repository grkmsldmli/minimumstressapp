"use client";

import { useEffect, useState } from "react";

/** One 4-7-8 cycle: inhale four, hold seven, exhale eight. */
const STEPS = [
  { name: "inhale", ms: 4000 },
  { name: "hold", ms: 7000 },
  { name: "exhale", ms: 8000 },
] as const;

/**
 * Offered after booking, before the practitioner walks into someone else's
 * room. The same 4-7-8 rhythm the logo breathes on.
 */
export function BreathCoach() {
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (state !== "running") return;
    const id = setTimeout(() => {
      if (step < STEPS.length - 1) setStep(step + 1);
      else setState("done");
    }, STEPS[step].ms);
    return () => clearTimeout(id);
  }, [state, step]);

  if (state === "done") {
    return (
      <div
        className="w-full mt-4 rounded-2xl p-4 text-center screen-in"
        style={{
          backgroundColor: "rgba(143,198,245,0.12)",
          border: "1px solid rgba(143,198,245,0.3)",
        }}
      >
        <p className="font-body font-medium text-[14px] text-sky-soft">Calm state unlocked</p>
        <p className="font-body font-normal text-[14px] text-white/60 mt-1">
          Walk in steady. Your client will feel it too.
        </p>
      </div>
    );
  }

  if (state === "running") {
    const current = STEPS[step];
    return (
      <div
        className="w-full mt-4 rounded-2xl p-4"
        style={{
          backgroundColor: "rgba(255,255,255,0.07)",
          border: "1px solid rgba(255,255,255,0.12)",
        }}
      >
        <div className="flex items-baseline justify-between">
          <p className="font-body font-medium text-[14.5px] uppercase tracking-[0.15em] text-white">
            {current.name}
          </p>
          <p className="font-body text-[13.5px] text-white/50">{current.ms / 1000}s</p>
        </div>
        <div
          className="h-1.5 rounded-full mt-3 overflow-hidden"
          style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
        >
          <div
            key={step}
            className="h-full rounded-full"
            style={{
              background: "linear-gradient(90deg, #3B9BE8, #8FC6F5)",
              animation: `fillBar ${current.ms}ms linear forwards`,
            }}
          />
        </div>
        <p className="font-body text-[12px] text-white/40 tracking-[0.25em] text-center mt-2.5">
          4 · 7 · 8
        </p>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setStep(0);
        setState("running");
      }}
      className="w-full mt-4 py-3.5 rounded-2xl font-body text-[14px] press text-sky-soft"
      style={{
        backgroundColor: "rgba(255,255,255,0.07)",
        border: "1px solid rgba(255,255,255,0.16)",
      }}
    >
      Arrive calm — one 4-7-8 breath before you go
    </button>
  );
}
