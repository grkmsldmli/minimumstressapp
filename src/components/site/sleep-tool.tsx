"use client";

import { useState } from "react";

import {
  SLEEP_BANDS,
  SLEEP_DIMENSIONS,
  type SleepDimension,
  type SleepQuestion,
  type SleepResult,
  drawSleepQuestions,
  scoreSleep,
} from "@/lib/assessments/sleep";

/**
 * Sleep Score.
 *
 * Twelve questions drawn from the pool when somebody presses Begin — the
 * original drew them too, and drawing on the button rather than during render
 * is what keeps the server's HTML and the client's first render agreeing.
 *
 * The result appears on the twelfth answer. The original held it behind an
 * email field and posted the address to Klaviyo before showing anything.
 */

const TYPE_COLOUR = {
  deep: "#1D9E75",
  light: "#3B6FD4",
  cyclist: "#E8A020",
  dysregulated: "#C0392B",
} as const;

const ORDER: SleepDimension[] = ["A", "C", "Q", "R", "D"];

export function SleepTool() {
  const [questions, setQuestions] = useState<SleepQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<SleepResult | null>(null);

  if (!questions) {
    return (
      <button
        type="button"
        onClick={() => setQuestions(drawSleepQuestions())}
        className="rounded-full px-8 py-3.5 text-[15px] font-medium text-white"
        style={{ backgroundColor: "#1a2744" }}
      >
        Begin the assessment
      </button>
    );
  }

  /*
   * Functional updater. The other way, every click inside one tick starts from
   * the same captured answers and overwrites the one before it, which loses
   * answers silently for anybody moving quickly.
   */
  const choose = (index: number, option: number) => {
    setAnswers((previous) => {
      const next = { ...previous, [index]: option };
      const done = questions.every((_, position) => next[position] !== undefined);
      setResult(done ? scoreSleep(questions, next) : null);
      return next;
    });
  };

  const restart = () => {
    setQuestions(drawSleepQuestions());
    setAnswers({});
    setResult(null);
  };

  return (
    <div>
      <ol className="space-y-9">
        {questions.map((question, index) => (
          <li key={question.q}>
            <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "#3B6FD4" }}>
              {index + 1} of {questions.length}
            </p>

            <p
              className="mt-2 text-[19px] leading-snug"
              style={{ fontFamily: "var(--font-dm-serif)", color: "#1a2744" }}
            >
              {question.q}
            </p>

            <div className="mt-3 space-y-2">
              {question.opts.map((option, optionIndex) => {
                const chosen = answers[index] === optionIndex;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => choose(index, optionIndex)}
                    aria-pressed={chosen}
                    className="block w-full rounded-xl px-4 py-3 text-left text-[15px] leading-snug"
                    style={
                      chosen
                        ? { border: "1px solid #3B6FD4", backgroundColor: "#f0f4ff", color: "#1a2744" }
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
          {Object.keys(answers).length} of {questions.length} answered.
        </p>
      )}

      {result && <Result result={result} onRestart={restart} />}
    </div>
  );
}

function Result({ result, onRestart }: { result: SleepResult; onRestart: () => void }) {
  const band = SLEEP_BANDS[result.type];
  const colour = TYPE_COLOUR[result.type];

  return (
    <div className="mt-10" aria-live="polite">
      <div className="rounded-2xl p-7" style={{ border: "1px solid #e7eef6" }}>
        <div className="flex flex-wrap items-baseline gap-x-4">
          <span
            className="text-[52px] leading-none"
            style={{ fontFamily: "var(--font-dm-serif)", color: colour }}
          >
            {result.overall}
          </span>
          <span className="text-[17px]" style={{ color: "#1a2744" }}>
            {band.label}
          </span>
        </div>

        <h3
          className="mt-5 text-[21px] leading-snug"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#1a2744" }}
        >
          {band.title}
        </h3>
        <p className="mt-3 text-[15.5px] leading-[1.8]" style={{ color: "#5f6673" }}>
          {band.desc}
        </p>

        <div className="mt-7 space-y-4">
          {ORDER.map((key) => (
            <div key={key}>
              <div className="flex items-baseline justify-between text-[14px]">
                <span style={{ color: "#1a2744" }}>{SLEEP_DIMENSIONS[key]}</span>
                <span style={{ color: "#8a94a3" }}>{result.dimensions[key]}</span>
              </div>
              <div
                className="mt-1.5 h-2 overflow-hidden rounded-full"
                style={{ backgroundColor: "#eef2f6" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${result.dimensions[key]}%`, backgroundColor: colour }}
                />
              </div>
            </div>
          ))}
        </div>

        {band.insights.length > 0 && (
          <div className="mt-8 rounded-xl p-5" style={{ backgroundColor: "#f8fbfd" }}>
            <p className="text-[14px] font-medium" style={{ color: "#1a2744" }}>
              What this means
            </p>
            <ul className="mt-2.5 space-y-2">
              {band.insights.map((insight) => (
                <li
                  key={insight}
                  className="flex gap-2.5 text-[14.5px] leading-[1.75]"
                  style={{ color: "#5f6673" }}
                >
                  <span
                    className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: colour }}
                  />
                  <span>{insight}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onRestart}
        className="mt-6 w-full rounded-xl py-3 text-[14px]"
        style={{ border: "1px solid #e7eef6", color: "#5f6673" }}
      >
        Take it again — twelve different questions
      </button>
    </div>
  );
}
