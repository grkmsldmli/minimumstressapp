"use client";

import { useState } from "react";

import {
  type Answers,
  type Dimension,
  type StressResult,
  BAND_COPY,
  DIMENSIONS,
  FIRST_STEP,
  QUESTIONS,
  isComplete,
  scoreAnswers,
} from "@/lib/stress-load";

/**
 * Twelve questions on one page, and the result underneath.
 *
 * Two things the version this replaces did, which are not repeated here.
 *
 * It showed one question at a time behind a progress bar, which makes twelve
 * questions feel like an exam and hides how much is left. They are all here;
 * somebody can see the whole thing before starting and answer in any order.
 *
 * And it held the result behind an email field — you finished the work, and
 * then had to pay with your address to see it. The result appears the moment
 * the last question is answered. Sending it to yourself is offered afterwards,
 * as a thing you might want rather than a toll.
 */

const BAND_COLOUR = {
  steady: "#1D9E75",
  carrying: "#2D8C4E",
  low: "#EF9F27",
  depleted: "#C0392B",
} as const;

export function StressLoadTool() {
  const [answers, setAnswers] = useState<Answers>({});
  const [result, setResult] = useState<StressResult | null>(null);

  const answered = Object.keys(answers).length;
  const ready = isComplete(answers);

  /*
   * The functional updater, not a spread of the value this render captured.
   *
   * Written the other way, every click in a single tick starts from the same
   * stale `answers` and overwrites the one before it — twelve taps landed one
   * answer. It looks fine when a person clicks slowly enough for a render to
   * land between taps, which is most of the time, and loses answers silently
   * for anybody moving fast on a phone. Silently is the part that matters:
   * nothing appears wrong until the count at the bottom does not add up.
   */
  const choose = (id: string, index: number) => {
    setAnswers((previous) => {
      const next = { ...previous, [id]: index };
      // Once every question has an answer the result tracks changes live, so
      // going back to reconsider one shows what it did rather than hiding it
      // behind the button again.
      setResult(isComplete(next) ? scoreAnswers(next) : null);
      return next;
    });
  };

  return (
    <div>
      <ol className="space-y-9">
        {QUESTIONS.map((question, index) => (
          <li key={question.id}>
            <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "#0EA5E9" }}>
              {index + 1} of {QUESTIONS.length} · {DIMENSIONS[question.dimension].label}
            </p>

            <p
              className="mt-2 text-[19px] leading-snug"
              style={{ fontFamily: "var(--font-dm-serif)", color: "#0F2F55" }}
            >
              {question.text}
            </p>

            <div className="mt-3 space-y-2">
              {question.options.map((option, optionIndex) => {
                const chosen = answers[question.id] === optionIndex;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => choose(question.id, optionIndex)}
                    aria-pressed={chosen}
                    className="block w-full rounded-xl px-4 py-3 text-left text-[15px] leading-snug"
                    style={
                      chosen
                        ? {
                            border: "1px solid #0EA5E9",
                            backgroundColor: "#f0f9ff",
                            color: "#0F2F55",
                          }
                        : { border: "1px solid #e7eef6", color: "#5f6673" }
                    }
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ol>

      {!ready && (
        <p className="mt-8 text-[14.5px]" style={{ color: "#8a94a3" }} aria-live="polite">
          {answered} of {QUESTIONS.length} answered. The result appears when they all are.
        </p>
      )}

      {result && <Result result={result} />}
    </div>
  );
}

function Result({ result }: { result: StressResult }) {
  const copy = BAND_COPY[result.band];
  const colour = BAND_COLOUR[result.band];
  const order: Dimension[] = ["sleep", "body", "mind", "load"];

  return (
    <div
      className="mt-10 rounded-2xl p-7"
      style={{ border: "1px solid #e7eef6" }}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-baseline gap-x-4">
        <span
          className="text-[52px] leading-none"
          style={{ fontFamily: "var(--font-dm-serif)", color: colour }}
        >
          {result.score}
        </span>
        <span className="text-[17px]" style={{ color: "#0F2F55" }}>
          {copy.label}
        </span>
      </div>

      <p className="mt-4 text-[15.5px] leading-[1.8]" style={{ color: "#5f6673" }}>
        {copy.body}
      </p>

      <div className="mt-7 space-y-4">
        {order.map((dimension) => (
          <div key={dimension}>
            <div className="flex items-baseline justify-between text-[14px]">
              <span style={{ color: "#0F2F55" }}>{DIMENSIONS[dimension].label}</span>
              <span style={{ color: "#8a94a3" }}>{result.dimensions[dimension]}</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full" style={{ backgroundColor: "#eef2f6" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${result.dimensions[dimension]}%`,
                  backgroundColor: dimension === result.weakest ? colour : "#c9d6e3",
                }}
              />
            </div>
            <p className="mt-1 text-[13px]" style={{ color: "#8a94a3" }}>
              {DIMENSIONS[dimension].meaning}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-xl p-5" style={{ backgroundColor: "#f8fbfd" }}>
        <p className="text-[14px] font-medium" style={{ color: "#0F2F55" }}>
          Where to start: {DIMENSIONS[result.weakest].label.toLowerCase()}
        </p>
        <p className="mt-1.5 text-[14.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
          {FIRST_STEP[result.weakest]}
        </p>
      </div>
    </div>
  );
}
