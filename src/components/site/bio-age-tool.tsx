"use client";

import { useState } from "react";

import { MeasureField } from "@/components/site/measure-field";
import { ResultActions } from "@/components/site/result-actions";
import { CountUp, ResultReveal } from "@/components/site/result-reveal";
import { StepFlow, type StepQuestion } from "@/components/site/step-flow";
import {
  type BioAnswers,
  type BioResult,
  BIO_COPY,
  BIO_DELTAS,
  BIO_SECTIONS,
  MAX_AGE,
  MIN_AGE,
  answerKey,
  isBioComplete,
  narrativeFor,
  scoreBioAge,
} from "@/lib/assessments/bio-age";

/**
 * Your age, then twenty questions about the week around it.
 *
 * The age comes first because everything else is measured against it, and
 * because asking for it last would mean somebody answers twenty questions
 * before finding out it was needed.
 */

export function BioAgeTool() {
  const [age, setAge] = useState("");
  const [answers, setAnswers] = useState<BioAnswers>({});
  const [result, setResult] = useState<BioResult | null>(null);
  /** Bumped to remount the flow, which resets its step. */
  const [run, setRun] = useState(0);
  /** False until the age is in and the questions have been started. */
  const [ready, setReady] = useState(false);

  const years = Number(age);
  const validAge = Boolean(years) && years >= MIN_AGE && years <= MAX_AGE;

  /*
   * The functional updater, not a spread of the value this render captured.
   * The other way two answers in one tick both start from the same object and
   * the second overwrites the first.
   */
  const answer = (key: string, option: number) => {
    setAnswers((previous) => {
      const next = { ...previous, [key]: option };
      if (isBioComplete(next, age)) setResult(scoreBioAge(next, years));
      return next;
    });
  };

  const restart = () => {
    setAnswers({});
    setResult(null);
    setReady(false);
    setRun((n) => n + 1);
    window.scrollTo({ top: 0 });
  };

  const steps: StepQuestion[] = BIO_SECTIONS.flatMap((section) =>
    section.questions.map((question, index) => ({
      id: answerKey(section.key, index),
      eyebrow: section.title,
      text: question.text,
      options: question.opts,
    })),
  );

  /*
   * The age is asked before the questions rather than inside them.
   *
   * Every answer that follows is measured against it, and a flow that reached
   * it at question eleven would have somebody answering ten things before
   * finding out the number they came for needs one more.
   */
  if (!ready) {
    return (
      <div>
        <div className="max-w-[220px]">
          <MeasureField
            label="Your age"
            unit="yrs"
            value={age}
            onChange={setAge}
            placeholder="32"
            hint={`Between ${MIN_AGE} and ${MAX_AGE}. Everything else is measured against it.`}
          />
        </div>

        <button
          type="button"
          disabled={!validAge}
          onClick={() => setReady(true)}
          className="mt-6 rounded-full px-8 py-3.5 text-[15px] font-medium text-white disabled:opacity-40"
          style={{ backgroundColor: "#1a2744" }}
        >
          Begin the assessment
        </button>
      </div>
    );
  }

  return (
    <StepFlow
      key={run}
      questions={steps}
      answers={answers}
      onAnswer={answer}
      onFinish={() => {}}
      accent="#EF9F27"
    >
      {result && (
        <ResultReveal>
          <Result result={result} onRestart={restart} />
        </ResultReveal>
      )}
    </StepFlow>
  );
}

function Result({ result, onRestart }: { result: BioResult; onRestart: () => void }) {
  const narrative = narrativeFor(result.difference);
  const colour =
    result.difference <= -3 ? "#1D9E75" : result.difference <= 3 ? "#EF9F27" : "#C0392B";

  return (
    <div aria-live="polite">
      <div className="rounded-2xl p-7" style={{ border: "1px solid #e7eef6" }}>
        <div className="flex flex-wrap items-baseline gap-x-4">
          <CountUp
            to={result.biological}
            className="text-[56px] leading-none"
            style={{ fontFamily: "var(--font-dm-serif)", color: colour }}
          />
          <span className="text-[15px]" style={{ color: "#8a94a3" }}>
            against {result.chronological} on the calendar
          </span>
        </div>

        <span
          className="mt-4 inline-block rounded-full px-3.5 py-1.5 text-[13px] font-medium"
          style={{ backgroundColor: `${colour}14`, color: colour }}
        >
          {narrative.badge}
        </span>

        <h3
          className="mt-4 text-[21px] leading-snug"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#1a2744" }}
        >
          {narrative.headline}
        </h3>

        <div className="mt-7 space-y-4">
          {BIO_DELTAS.map(({ key }) => {
            const value = result.dimensions[key];
            return (
              <div key={key}>
                <div className="flex items-baseline justify-between text-[14px]">
                  <span style={{ color: "#1a2744" }}>{BIO_COPY[key].short}</span>
                  <span style={{ color: "#8a94a3" }}>{value}</span>
                </div>
                <div
                  className="mt-1.5 h-2 overflow-hidden rounded-full"
                  style={{ backgroundColor: "#eef2f6" }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${value}%`,
                      backgroundColor:
                        key === result.weakest ? colour : value >= 60 ? "#1D9E75" : "#c9d6e3",
                    }}
                  />
                </div>
                <p className="mt-1 text-[13px]" style={{ color: "#8a94a3" }}>
                  {value >= 70
                    ? BIO_COPY[key].strong
                    : value >= 45
                      ? BIO_COPY[key].mid
                      : BIO_COPY[key].weak}
                </p>
              </div>
            );
          })}
        </div>

        <div className="mt-8 rounded-xl p-5" style={{ backgroundColor: "#f8fbfd" }}>
          <p className="text-[14px] font-medium" style={{ color: "#1a2744" }}>
            Where to start: {BIO_COPY[result.weakest].short.toLowerCase()}
          </p>
          <p className="mt-1.5 text-[14.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
            {BIO_COPY[result.weakest].action}
          </p>
          <p className="mt-3 text-[14px] leading-[1.75]" style={{ color: "#8a94a3" }}>
            Then {BIO_COPY[result.secondWeakest].short.toLowerCase()}:{" "}
            {BIO_COPY[result.secondWeakest].action}
          </p>
        </div>

        <p className="mt-5 text-[14px] leading-[1.75]" style={{ color: "#8a94a3" }}>
          Your strongest area is {BIO_COPY[result.strongest].short.toLowerCase()}.{" "}
          {BIO_COPY[result.strongest].strong}
        </p>
      </div>

      <ResultActions
        accent="#1a2744"
        result={{
          slug: "biological-age-calculator",
          toolName: "Biological Age Calculator",
          score: String(result.biological),
          band: narrative.badge,
          summary: `Against ${result.chronological} on the calendar.`,
          headline: narrative.headline,
          dimensions: BIO_DELTAS.map(({ key }) => ({
            label: BIO_COPY[key].short,
            value: result.dimensions[key],
            focus: key === result.weakest,
          })),
          // What each bar is actually saying, in the assessment's own words —
          // the line the page prints under it, for the same three thresholds.
          insights: BIO_DELTAS.map(({ key }) => {
            const value = result.dimensions[key];
            const copy = value >= 70 ? "strong" : value >= 45 ? "mid" : "weak";
            return `${BIO_COPY[key].short}: ${BIO_COPY[key][copy]}`;
          }),
          focus: {
            label: BIO_COPY[result.weakest].short,
            action: BIO_COPY[result.weakest].action,
          },
          steps: [
            BIO_COPY[result.weakest].action,
            BIO_COPY[result.secondWeakest].action,
            `Keep what is already working: ${BIO_COPY[result.strongest].strong}`,
          ],
        }}
      />

      <button
        type="button"
        onClick={onRestart}
        className="mt-3 w-full rounded-xl py-3 text-[14px]"
        style={{ border: "1px solid #e7eef6", color: "#5f6673" }}
      >
        Start again
      </button>
    </div>
  );
}
