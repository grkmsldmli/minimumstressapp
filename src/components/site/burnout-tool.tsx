"use client";

import { useState } from "react";

import { useRevealOnce } from "@/components/site/use-reveal";

import {
  type BurnoutQuestion,
  type BurnoutResult,
  CATEGORIES,
  CATEGORY_INSIGHTS,
  LEVEL_LABEL,
  PROFILES,
  categoriesToShow,
  drawQuestions,
  scoreBurnout,
} from "@/lib/assessments/burnout";

/**
 * The Burnout Test.
 *
 * Ten questions drawn from the hundred, which is what makes it worth taking
 * again — the original did this and it is the best thing about it.
 *
 * The draw happens when somebody presses Begin, which is how the original
 * worked and is also the only place it can happen. Picking at random during
 * render gives one set of ten in the server's HTML and a different set once
 * React takes over — a hydration mismatch, seen as the questions flickering
 * from one thing to another. Drawing in an effect avoids that and trades it
 * for a flash of empty page. A button avoids both.
 *
 * The result appears when the tenth is answered. The original held it behind
 * an email field — you finished the work, then paid with your address to see
 * it — and posted the address to Klaviyo before showing anything.
 */

const LEVEL_COLOUR = {
  low: "#1D9E75",
  mid: "#E8A020",
  high: "#C0392B",
} as const;

export function BurnoutTool() {
  const [questions, setQuestions] = useState<BurnoutQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<BurnoutResult | null>(null);
  const reveal = useRevealOnce();

  if (!questions) {
    return (
      <button
        type="button"
        onClick={() => setQuestions(drawQuestions())}
        className="rounded-full px-8 py-3.5 text-[15px] font-medium text-white"
        style={{ backgroundColor: "#1a2744" }}
      >
        Begin the assessment
      </button>
    );
  }

  /*
   * The functional updater, not a spread of the value this render captured.
   * Written the other way every click in a tick starts from the same stale
   * answers and overwrites the one before it, which loses answers silently for
   * anybody moving quickly.
   */
  const choose = (index: number, option: number) => {
    setAnswers((previous) => {
      const next = { ...previous, [index]: option };
      const done = questions.every((_, position) => next[position] !== undefined);
      setResult(done ? scoreBurnout(questions, next) : null);
      if (done) reveal.reveal();
      return next;
    });
  };

  const restart = () => {
    reveal.reset();
    setQuestions(drawQuestions());
    setAnswers({});
    setResult(null);
  };

  const answered = Object.keys(answers).length;

  return (
    <div>
      <ol className="space-y-9">
        {questions.map((question, index) => (
          <li key={question.q}>
            <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "#1D9E75" }}>
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
                        ? { border: "1px solid #1D9E75", backgroundColor: "#f0faf6", color: "#1a2744" }
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
          {answered} of {questions.length} answered.
        </p>
      )}

      {result && <Result result={result} onRestart={restart} panelRef={reveal.ref} />}
    </div>
  );
}

function Result({
  result,
  onRestart,
  panelRef,
}: {
  result: BurnoutResult;
  onRestart: () => void;
  panelRef: (node: HTMLElement | null) => void;
}) {
  const profile = PROFILES[result.level];
  const colour = LEVEL_COLOUR[result.level];
  const shown = result.ranked.slice(0, categoriesToShow(result.level));

  return (
    <div ref={panelRef} className="mt-10" aria-live="polite">
      <div className="rounded-2xl p-7" style={{ border: "1px solid #e7eef6" }}>
        <div className="flex flex-wrap items-baseline gap-x-4">
          <span
            className="text-[52px] leading-none"
            style={{ fontFamily: "var(--font-dm-serif)", color: colour }}
          >
            {result.percent}
          </span>
          <span className="text-[17px]" style={{ color: "#1a2744" }}>
            {LEVEL_LABEL[result.level]}
          </span>
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full" style={{ backgroundColor: "#eef2f6" }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${result.percent}%`, backgroundColor: colour }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px]" style={{ color: "#8a94a3" }}>
          <span>Recovering</span>
          <span>Burning</span>
          <span>Burnt out</span>
        </div>

        <p className="mt-5 text-[15px] leading-[1.8]" style={{ color: "#5f6673" }}>
          {profile.scoreNote}
        </p>
      </div>

      <Card kicker="Your story" title={profile.storyTitle} body={profile.story} />
      <Card kicker="What your answers suggest" title={profile.patternTitle} body={profile.pattern} chips={profile.chips} />
      <Card kicker="Science-based lens" title={profile.scienceTitle} body={profile.science} />

      <div className="mt-3 rounded-2xl p-6" style={{ border: "1px solid #e7eef6" }}>
        <p className="text-[10px] uppercase tracking-[0.14em]" style={{ color: "#1D9E75" }}>
          Next 7 days
        </p>
        <h3 className="mt-1.5 text-[16px] font-medium" style={{ color: "#1a2744" }}>
          {profile.planTitle}
        </h3>
        <p className="mt-1.5 text-[14.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
          {profile.planText}
        </p>
        <ol className="mt-4 space-y-2.5">
          {profile.actions.map((action, index) => (
            <li key={action} className="flex gap-3 text-[14px] leading-[1.7]" style={{ color: "#5f6673" }}>
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium"
                style={{ backgroundColor: "#f0faf6", color: "#1D9E75" }}
              >
                {index + 1}
              </span>
              <span>{action}</span>
            </li>
          ))}
        </ol>
      </div>

      {/*
        The categories the answers pointed at. The original ended each of these
        with an "Explore ..." button into /collections/all-session, and that
        catalogue closes with the store — the buttons would land on a 410. What
        the category says about where the strain is landing is the useful part
        and it stays.
      */}
      <p className="mt-8 text-[14px] font-medium" style={{ color: "#1a2744" }}>
        Where your answers pointed
      </p>
      {shown.map(({ category }) => (
        <div key={category} className="mt-3 rounded-2xl p-6" style={{ border: "1px solid #e7eef6" }}>
          <p className="text-[15px] font-medium" style={{ color: "#1a2744" }}>
            {CATEGORY_INSIGHTS[category].label}
          </p>
          <p className="mt-1.5 text-[14.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
            {CATEGORY_INSIGHTS[category].text}
          </p>
          <p className="mt-3 text-[14px] leading-[1.75]" style={{ color: "#8a94a3" }}>
            {CATEGORIES[category].desc}
          </p>
        </div>
      ))}

      <button
        type="button"
        onClick={onRestart}
        className="mt-6 w-full rounded-xl py-3 text-[14px]"
        style={{ border: "1px solid #e7eef6", color: "#5f6673" }}
      >
        Take it again — ten different questions
      </button>
    </div>
  );
}

function Card({
  kicker,
  title,
  body,
  chips,
}: {
  kicker: string;
  title: string;
  body: string;
  chips?: string[];
}) {
  return (
    <div className="mt-3 rounded-2xl p-6" style={{ border: "1px solid #e7eef6" }}>
      <p className="text-[10px] uppercase tracking-[0.14em]" style={{ color: "#1D9E75" }}>
        {kicker}
      </p>
      <h3 className="mt-1.5 text-[16px] font-medium" style={{ color: "#1a2744" }}>
        {title}
      </h3>
      <p className="mt-1.5 text-[14.5px] leading-[1.75]" style={{ color: "#5f6673" }}>
        {body}
      </p>

      {chips && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded-full px-2.5 py-1 text-[11px]"
              style={{ backgroundColor: "#fbfdff", border: "1px solid #e6edf3", color: "#5f6673" }}
            >
              {chip}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
