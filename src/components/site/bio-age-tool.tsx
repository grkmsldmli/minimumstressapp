"use client";

import { useState } from "react";

import { MeasureField } from "@/components/site/measure-field";
import { useRevealOnce } from "@/components/site/use-reveal";
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
  totalQuestions,
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
  const reveal = useRevealOnce();

  const total = totalQuestions();
  const answered = Object.keys(answers).length;

  const settle = (nextAnswers: BioAnswers, nextAge: string) => {
    if (isBioComplete(nextAnswers, nextAge)) {
      setResult(scoreBioAge(nextAnswers, Number(nextAge)));
      reveal.reveal();
    } else {
      setResult(null);
    }
  };

  const choose = (key: string, option: number) => {
    setAnswers((previous) => {
      const next = { ...previous, [key]: option };
      settle(next, age);
      return next;
    });
  };

  const onAge = (value: string) => {
    setAge(value);
    settle(answers, value);
  };

  return (
    <div>
      <div className="max-w-[200px]">
        <MeasureField
          label="Your age"
          unit="yrs"
          value={age}
          onChange={onAge}
          placeholder="32"
          hint={`Between ${MIN_AGE} and ${MAX_AGE}. Everything else is measured against it.`}
        />
      </div>

      {BIO_SECTIONS.map((section, sectionIndex) => (
        <section key={section.key} className="mt-14">
          <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "#BA7517" }}>
            Dimension {sectionIndex + 1} of {BIO_SECTIONS.length}
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
                              ? { border: "1px solid #EF9F27", backgroundColor: "#fdf8ee", color: "#1a2744" }
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
          {answered} of {total} answered
          {age ? "" : ", and your age is still needed"}.
        </p>
      )}

      {result && (
        <Result
          result={result}
          panelRef={reveal.ref}
          onRestart={() => {
            setAnswers({});
            setResult(null);
            reveal.reset();
            window.scrollTo({ top: 0 });
          }}
        />
      )}
    </div>
  );
}

function Result({
  result,
  panelRef,
  onRestart,
}: {
  result: BioResult;
  panelRef: (node: HTMLElement | null) => void;
  onRestart: () => void;
}) {
  const narrative = narrativeFor(result.difference);
  const colour =
    result.difference <= -3 ? "#1D9E75" : result.difference <= 3 ? "#EF9F27" : "#C0392B";

  return (
    <div ref={panelRef} className="mt-12" aria-live="polite">
      <div className="rounded-2xl p-7" style={{ border: "1px solid #e7eef6" }}>
        <div className="flex flex-wrap items-baseline gap-x-4">
          <span
            className="text-[56px] leading-none"
            style={{ fontFamily: "var(--font-dm-serif)", color: colour }}
          >
            {result.biological}
          </span>
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

      <button
        type="button"
        onClick={onRestart}
        className="mt-6 w-full rounded-xl py-3 text-[14px]"
        style={{ border: "1px solid #e7eef6", color: "#5f6673" }}
      >
        Start again
      </button>
    </div>
  );
}
