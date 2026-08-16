"use client";

import { useState } from "react";

import {
  type Answers,
  type Assessment,
  type Result,
  isComplete,
  score,
} from "@/lib/assessment";

/**
 * The form every questionnaire on the site uses.
 *
 * Two things the Shopify versions did, which are not repeated.
 *
 * They showed one question at a time behind a progress bar, which turns twelve
 * questions into an exam and hides how much is left. They are all here, in any
 * order somebody likes.
 *
 * And they held the result behind an email field — you did the work, then paid
 * with your address to see it. The score appears the moment the last question
 * is answered, and keeps tracking if you go back and change one.
 */

const BAND_COLOUR = {
  steady: "#1D9E75",
  carrying: "#2D8C4E",
  low: "#EF9F27",
  depleted: "#C0392B",
} as const;

export function AssessmentTool<D extends string>({
  assessment,
}: {
  assessment: Assessment<D>;
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const [result, setResult] = useState<Result<D> | null>(null);

  const answered = Object.keys(answers).length;
  const total = assessment.questions.length;

  /*
   * The functional updater, not a spread of the value this render captured.
   *
   * Written the other way, every click within one tick starts from the same
   * stale answers and overwrites the one before it — twelve taps landed one
   * answer. It looks correct whenever a render lands between taps, which is
   * most of the time, and loses answers silently for anybody moving quickly on
   * a phone. Silently is the part that matters.
   */
  const choose = (id: string, index: number) => {
    setAnswers((previous) => {
      const next = { ...previous, [id]: index };
      setResult(isComplete(assessment, next) ? score(assessment, next) : null);
      return next;
    });
  };

  return (
    <div>
      <ol className="space-y-9">
        {assessment.questions.map((question, index) => (
          <li key={question.id}>
            <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "#0EA5E9" }}>
              {index + 1} of {total} · {assessment.dimensions[question.dimension].label}
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
                        ? { border: "1px solid #0EA5E9", backgroundColor: "#f0f9ff", color: "#0F2F55" }
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

      {!result && (
        <p className="mt-8 text-[14.5px]" style={{ color: "#8a94a3" }} aria-live="polite">
          {answered} of {total} answered. The result appears when they all are.
        </p>
      )}

      {result && <ResultPanel assessment={assessment} result={result} />}
    </div>
  );
}

function ResultPanel<D extends string>({
  assessment,
  result,
}: {
  assessment: Assessment<D>;
  result: Result<D>;
}) {
  const copy = assessment.band[result.band];
  const colour = BAND_COLOUR[result.band];
  const order = Object.keys(assessment.dimensions) as D[];

  return (
    <div className="mt-10 rounded-2xl p-7" style={{ border: "1px solid #e7eef6" }} aria-live="polite">
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
              <span style={{ color: "#0F2F55" }}>{assessment.dimensions[dimension].label}</span>
              <span style={{ color: "#8a94a3" }}>{result.dimensions[dimension]}</span>
            </div>
            <div
              className="mt-1.5 h-2 overflow-hidden rounded-full"
              style={{ backgroundColor: "#eef2f6" }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${result.dimensions[dimension]}%`,
                  // The weakest one is picked out, because it is the one the
                  // advice underneath is about.
                  backgroundColor: dimension === result.weakest ? colour : "#c9d6e3",
                }}
              />
            </div>
            <p className="mt-1 text-[13px]" style={{ color: "#8a94a3" }}>
              {assessment.dimensions[dimension].meaning}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-xl p-5" style={{ backgroundColor: "#f8fbfd" }}>
        <p className="text-[14px] font-medium" style={{ color: "#0F2F55" }}>
          Where to start: {assessment.dimensions[result.weakest].label.toLowerCase()}
        </p>
        <p className="mt-1.5 text-[14.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
          {assessment.firstStep[result.weakest]}
        </p>
      </div>
    </div>
  );
}
