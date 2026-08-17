"use client";

import { useState } from "react";

import { ResultActions } from "@/components/site/result-actions";
import { CountUp, ResultReveal } from "@/components/site/result-reveal";
import { StepFlow, type StepQuestion } from "@/components/site/step-flow";
import {
  type SectionAnswers,
  type SectionedAssessment,
  type SectionedResult,
  answerKey,
  isComplete,
  scoreSectioned,
} from "@/lib/sectioned";
import { toolBySlug } from "@/lib/tools";

/**
 * The three sectioned assessments, asked one question at a time.
 *
 * The five sections are flattened into one run. Somebody working through this
 * does not care that question eight begins a new section — they care how many
 * are left — so the section name rides along as an eyebrow and the count runs
 * straight through to fifteen.
 *
 * The result is not held behind an email field, which is what the pages this
 * replaces did: the address went to Klaviyo and the score appeared afterwards.
 * Here it appears on the last answer, and the email is an offer underneath it.
 */

/** Green when the number is good news, amber in the middle, red at the end. */
function colourFor(percent: number, higherIsBetter: boolean): string {
  const good = higherIsBetter ? percent >= 67 : percent <= 33;
  const bad = higherIsBetter ? percent < 34 : percent > 66;
  return good ? "#1D9E75" : bad ? "#C0392B" : "#E8A020";
}

export function SectionedTool({ assessment }: { assessment: SectionedAssessment }) {
  const [answers, setAnswers] = useState<SectionAnswers>({});
  const [result, setResult] = useState<SectionedResult | null>(null);
  /** Bumped to remount the flow, which is how starting again resets its step. */
  const [run, setRun] = useState(0);

  const steps: StepQuestion[] = assessment.sections.flatMap((section) =>
    section.questions.map((question, index) => ({
      id: answerKey(section.key, index),
      eyebrow: section.title,
      text: question.text,
      options: question.opts,
    })),
  );

  /*
   * The functional updater, not a spread of the value this render captured.
   * The other way, two answers inside one tick both start from the same object
   * and the second overwrites the first — which loses answers silently for
   * anybody moving quickly.
   */
  const answer = (id: string, option: number) => {
    setAnswers((previous) => {
      const next = { ...previous, [id]: option };
      if (isComplete(assessment, next)) setResult(scoreSectioned(assessment, next));
      return next;
    });
  };

  const restart = () => {
    setAnswers({});
    setResult(null);
    setRun((n) => n + 1);
    window.scrollTo({ top: 0 });
  };

  return (
    <StepFlow
      key={run}
      questions={steps}
      answers={answers}
      onAnswer={answer}
      onFinish={() => {}}
      accent="#0EA5E9"
    >
      {result && (
        <ResultReveal>
          <Result assessment={assessment} result={result} onRestart={restart} />
        </ResultReveal>
      )}
    </StepFlow>
  );
}

function Result({
  assessment,
  result,
  onRestart,
}: {
  assessment: SectionedAssessment;
  result: SectionedResult;
  onRestart: () => void;
}) {
  const band = assessment.bands[result.band];
  const colour = colourFor(result.overall, assessment.higherIsBetter);
  const name = toolBySlug(assessment.slug)?.name ?? "Your result";

  return (
    <div aria-live="polite">
      <div className="rounded-2xl p-7" style={{ border: "1px solid #e7eef6" }}>
        <div className="flex flex-wrap items-baseline gap-x-4">
          <CountUp
            to={result.overall}
            className="text-[52px] leading-none"
            style={{ fontFamily: "var(--font-dm-serif)", color: colour }}
          />
          {/*
            The band name always sits beside the number. These three do not
            agree on which direction is good — a bare 68 is a high cortisol
            load on one and a healthy gut on another — and nobody should have
            to remember which page they are on to read their own result.
          */}
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
          {assessment.sections.map((section) => {
            const value = result.sections[section.key];
            return (
              <div key={section.key}>
                <div className="flex items-baseline justify-between text-[14px]">
                  <span style={{ color: "#1a2744" }}>{section.title}</span>
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
                      backgroundColor: colourFor(value, assessment.higherIsBetter),
                    }}
                  />
                </div>
              </div>
            );
          })}
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
        accent="#0F2F55"
        result={{
          toolName: name,
          score: String(result.overall),
          band: band.label,
          summary: band.desc,
          breakdown: assessment.sections.map(
            (section) => `${section.title}: ${result.sections[section.key]}`,
          ),
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
