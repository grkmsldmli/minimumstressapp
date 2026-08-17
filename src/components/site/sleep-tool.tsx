"use client";

import { useState } from "react";

import { ResultActions } from "@/components/site/result-actions";
import { CountUp, ResultReveal } from "@/components/site/result-reveal";
import { StepFlow, type StepQuestion } from "@/components/site/step-flow";

import { SLEEP_FOCUS, weakestSleep } from "@/lib/assessments/focus";
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
  /** Bumped to remount the flow, which resets its step. */
  const [run, setRun] = useState(0);

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
    setRun((n) => n + 1);
    setQuestions(drawSleepQuestions());
    setAnswers({});
    setResult(null);
  };

  const steps: StepQuestion[] = questions.map((question, index) => ({
    id: String(index),
    text: question.q,
    options: question.opts,
  }));

  return (
    <StepFlow
      key={run}
      questions={steps}
      answers={answers}
      onAnswer={(id, option) => choose(Number(id), option)}
      onFinish={() => {}}
      accent="#3B6FD4"
    >
      {result && (
        <ResultReveal>
          <Result result={result} onRestart={restart} />
        </ResultReveal>
      )}
    </StepFlow>
  );
}

function Result({ result, onRestart }: { result: SleepResult; onRestart: () => void }) {
  const band = SLEEP_BANDS[result.type];
  const colour = TYPE_COLOUR[result.type];
  /*
   * The thinnest dimension, named. Five numbers and no steer leaves the reader
   * doing the work the tool was for — and five things to fix is five things
   * nobody starts.
   */
  const weakest = weakestSleep(result.dimensions);

  return (
    <div aria-live="polite">
      <div className="rounded-2xl p-7" style={{ border: "1px solid #e7eef6" }}>
        <div className="flex flex-wrap items-baseline gap-x-4">
          <CountUp
            to={result.overall}
            className="text-[52px] leading-none"
            style={{ fontFamily: "var(--font-dm-serif)", color: colour }}
          />
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
                <span style={{ color: key === weakest ? "#1a2744" : "#5f6673" }}>
                  {SLEEP_DIMENSIONS[key]}
                </span>
                <span style={{ color: "#8a94a3" }}>{result.dimensions[key]}</span>
              </div>
              <div
                className="mt-1.5 h-2 overflow-hidden rounded-full"
                style={{ backgroundColor: "#eef2f6" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${result.dimensions[key]}%`,
                    backgroundColor: key === weakest ? colour : "#c9d6e3",
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-xl p-5" style={{ backgroundColor: "#f8fbfd" }}>
          <p className="text-[10px] uppercase tracking-[0.14em]" style={{ color: colour }}>
            Start here
          </p>
          <p className="mt-1.5 text-[15px] font-medium" style={{ color: "#1a2744" }}>
            {SLEEP_FOCUS[weakest].label}
          </p>
          <p className="mt-1.5 text-[14.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
            {SLEEP_FOCUS[weakest].action}
          </p>
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

      <ResultActions
        accent="#1a2744"
        result={{
          slug: "sleep-score",
          toolName: "Sleep Score",
          score: String(result.overall),
          band: band.label,
          // The band's own sentence sits under the score, its paragraph under
          // that — the same order the page reads in.
          summary: band.title,
          story: band.desc,
          dimensions: ORDER.map((key) => ({
            label: SLEEP_DIMENSIONS[key],
            value: result.dimensions[key],
            focus: key === weakest,
          })),
          insights: band.insights,
          focus: SLEEP_FOCUS[weakest],
        }}
      />

      <button
        type="button"
        onClick={onRestart}
        className="mt-3 w-full rounded-xl py-3 text-[14px]"
        style={{ border: "1px solid #e7eef6", color: "#5f6673" }}
      >
        Take it again — twelve different questions
      </button>
    </div>
  );
}
