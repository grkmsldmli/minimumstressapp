"use client";

import { useState } from "react";

import {
  type SectionAnswers,
  type SectionedAssessment,
  type SectionedResult,
  answerKey,
  isComplete,
  scoreSectioned,
} from "@/lib/sectioned";

/**
 * The form the three sectioned assessments share.
 *
 * All five sections are on the page. The originals showed one at a time behind
 * a progress bar and a Continue button, which turns fifteen questions into a
 * form to be got through and hides how much is left.
 *
 * And the result is not held behind an email field. On the original you
 * answered everything, and then had to hand over an address before you were
 * shown anything — the address went to Klaviyo first and the score appeared
 * after. It appears here when the last question is answered.
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

  const total = assessment.sections.reduce((n, s) => n + s.questions.length, 0);
  const answered = Object.keys(answers).length;

  /*
   * The functional updater, not a spread of the value this render captured.
   * The other way, every click within a tick starts from the same stale answers
   * and overwrites the one before it — which loses answers silently for anybody
   * moving quickly on a phone.
   */
  const choose = (key: string, option: number) => {
    setAnswers((previous) => {
      const next = { ...previous, [key]: option };
      setResult(isComplete(assessment, next) ? scoreSectioned(assessment, next) : null);
      return next;
    });
  };

  return (
    <div>
      {assessment.sections.map((section, sectionIndex) => (
        <section key={section.key} className={sectionIndex === 0 ? "" : "mt-14"}>
          <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "#0EA5E9" }}>
            Section {sectionIndex + 1} of {assessment.sections.length}
          </p>
          <h2
            className="mt-1.5 text-[24px] leading-snug"
            style={{ fontFamily: "var(--font-dm-serif)", color: "#1a2744" }}
          >
            {section.title}
          </h2>
          <p className="mt-1.5 text-[14.5px] leading-[1.7]" style={{ color: "#8a94a3" }}>
            {section.sub}
          </p>

          <ol className="mt-6 space-y-7">
            {section.questions.map((question, index) => {
              const key = answerKey(section.key, index);
              return (
                <li key={key}>
                  <p className="text-[16px] leading-snug" style={{ color: "#1a2744" }}>
                    {question.text}
                  </p>
                  <div className="mt-3 space-y-2">
                    {question.opts.map((option, optionIndex) => {
                      const chosen = answers[key] === optionIndex;
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => choose(key, optionIndex)}
                          aria-pressed={chosen}
                          className="block w-full rounded-xl px-4 py-3 text-left text-[15px] leading-snug"
                          style={
                            chosen
                              ? {
                                  border: "1px solid #0EA5E9",
                                  backgroundColor: "#f0f9ff",
                                  color: "#1a2744",
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
              );
            })}
          </ol>
        </section>
      ))}

      {!result && (
        <p className="mt-10 text-[14.5px]" style={{ color: "#8a94a3" }} aria-live="polite">
          {answered} of {total} answered. The result appears when they all are.
        </p>
      )}

      {result && <Result assessment={assessment} result={result} />}
    </div>
  );
}

function Result({
  assessment,
  result,
}: {
  assessment: SectionedAssessment;
  result: SectionedResult;
}) {
  const band = assessment.bands[result.band];
  const colour = colourFor(result.overall, assessment.higherIsBetter);

  return (
    <div className="mt-12 rounded-2xl p-7" style={{ border: "1px solid #e7eef6" }} aria-live="polite">
      <div className="flex flex-wrap items-baseline gap-x-4">
        <span
          className="text-[52px] leading-none"
          style={{ fontFamily: "var(--font-dm-serif)", color: colour }}
        >
          {result.overall}
        </span>
        {/*
          The band name always sits beside the number. These three do not agree
          on which direction is good — a bare 68 is a high cortisol load on one
          and a healthy gut on another — and nobody should have to remember
          which page they are on to read their own result.
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
  );
}
