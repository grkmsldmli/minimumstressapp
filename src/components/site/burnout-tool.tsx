"use client";

import { useState } from "react";

import { ResultActions } from "@/components/site/result-actions";
import { CountUp, ResultReveal } from "@/components/site/result-reveal";
import { StepFlow, type StepQuestion } from "@/components/site/step-flow";

import { BURNOUT_FOCUS } from "@/lib/assessments/focus";
import {
  type BurnoutQuestion,
  type BurnoutResult,
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
  /** Bumped to remount the flow, which resets its step. */
  const [run, setRun] = useState(0);

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
      return next;
    });
  };

  const restart = () => {
    setRun((n) => n + 1);
    setQuestions(drawQuestions());
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
      answers={Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v]))}
      onAnswer={(id, option) => choose(Number(id), option)}
      onFinish={() => {}}
      accent="#1D9E75"
    >
      {result && (
        <ResultReveal>
          <Result result={result} onRestart={restart} />
        </ResultReveal>
      )}
    </StepFlow>
  );
}

function Result({ result, onRestart }: { result: BurnoutResult; onRestart: () => void }) {
  const profile = PROFILES[result.level];
  const colour = LEVEL_COLOUR[result.level];
  const shown = result.ranked.slice(0, categoriesToShow(result.level));

  return (
    <div aria-live="polite">
      <div className="rounded-2xl p-7" style={{ border: "1px solid #e7eef6" }}>
        <div className="flex flex-wrap items-baseline gap-x-4">
          <CountUp
            to={result.percent}
            className="text-[52px] leading-none"
            style={{ fontFamily: "var(--font-dm-serif)", color: colour }}
          />
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
        The categories the answers pointed at.

        Each one used to end by naming the kind of consultant to book, above an
        "Explore ..." button into /collections/all-session. There are no
        consultants and no sessions now, and that catalogue closes with the
        store — so the referral is replaced by something the reader can do this
        week on their own. What the category says about where the strain is
        landing was always the useful part, and it stays as it was.
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
            {BURNOUT_FOCUS[category].action}
          </p>
        </div>
      ))}

      {/*
        The same result, in an inbox. Not the number — the number on its own is
        a receipt for something they have just spent two minutes reading. What
        travels is the story their level tells, the categories their own
        answers pointed at, and the seven days the page recommends.
      */}
      <ResultActions
        accent="#1a2744"
        result={{
          slug: "burnout-test",
          toolName: "Burnout Test",
          score: String(result.percent),
          band: LEVEL_LABEL[result.level],
          summary: profile.scoreNote,
          headline: profile.storyTitle,
          story: profile.story,
          dimensions: result.ranked.map(({ category, percent }, index) => ({
            label: CATEGORY_INSIGHTS[category].label,
            value: percent,
            // The heaviest one, which is also the first the page names.
            focus: index === 0,
          })),
          insights: shown.map(({ category }) => CATEGORY_INSIGHTS[category].text),
          focus: BURNOUT_FOCUS[result.ranked[0].category],
          steps: profile.actions,
        }}
      />

      <button
        type="button"
        onClick={onRestart}
        className="mt-3 w-full rounded-xl py-3 text-[14px]"
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
