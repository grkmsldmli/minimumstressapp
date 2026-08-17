"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One question at a time, with somewhere to go back to.
 *
 * The earlier version put every question on one page. That was a reaction to
 * the original, which hid how much was left behind a Continue button — but the
 * fix threw out what the format is good at. Fifteen questions on one screen is
 * a form; one at a time with the count on it is a conversation, and people
 * finish conversations.
 *
 * So it steps, and it also says exactly where you are and lets you go back,
 * which the original never did.
 *
 * Choosing an answer advances on its own after a beat. The beat is not
 * decoration: without it the question is gone before the tap has registered
 * anywhere but the finger, and there is no way to tell a recorded answer from
 * a mis-tap.
 */

const ADVANCE_DELAY_MS = 260;

export interface StepQuestion {
  /** Stable across renders — the animation is keyed on it. */
  id: string;
  /** Shown above the question, e.g. the section it belongs to. */
  eyebrow?: string;
  text: string;
  options: string[];
}

export function StepFlow({
  questions,
  answers,
  onAnswer,
  onFinish,
  accent = "#0EA5E9",
  children,
}: {
  questions: StepQuestion[];
  /** Answer index by question id. */
  answers: Record<string, number>;
  onAnswer: (id: string, option: number) => void;
  /** Called once, when the last question is answered. */
  onFinish: () => void;
  accent?: string;
  /** The result, rendered after the last answer. */
  children?: React.ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [back, setBack] = useState(false);
  const [motionOk, setMotionOk] = useState(true);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  /** Skips the focus move on first paint, which would scroll the page. */
  const started = useRef(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setMotionOk(!query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  // A pending advance has to be dropped when this goes away, or it fires into
  // a form that is no longer on screen.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  /*
   * Focus follows the question.
   *
   * The button that was just pressed is removed from the document, and a
   * browser drops focus to the body when that happens — so a keyboard user
   * lands nowhere and a screen reader says nothing at all. Moving focus to the
   * heading reads the new question out and puts the next Tab in the right
   * place.
   */
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      return;
    }
    heading.current?.focus({ preventScroll: true });
  }, [index]);

  const question = questions[index];
  const answered = Object.keys(answers).length;

  const goBack = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setBack(true);
    setIndex((current) => Math.max(0, current - 1));
  }, []);

  const choose = useCallback(
    (option: number) => {
      onAnswer(question.id, option);
      setBack(false);

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (index + 1 < questions.length) {
          setIndex(index + 1);
        } else {
          setDone(true);
          onFinish();
        }
      }, ADVANCE_DELAY_MS);
    },
    [index, onAnswer, onFinish, question.id, questions.length],
  );

  /*
   * The number keys pick an answer and the left arrow goes back.
   *
   * Somebody working through twenty questions on a laptop should not have to
   * tab past four options each time. The listener sits on the container rather
   * than on the window so it cannot fight with anything else on the page.
   */
  const onKeyDown = (event: React.KeyboardEvent) => {
    const digit = Number(event.key);
    if (digit >= 1 && digit <= question.options.length) {
      event.preventDefault();
      choose(digit - 1);
      return;
    }
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      goBack();
    }
  };

  if (done) return <>{children}</>;

  return (
    <div onKeyDown={onKeyDown}>
      <div className="flex items-center gap-4">
        <div
          className="h-1 flex-1 overflow-hidden rounded-full"
          style={{ backgroundColor: "#eef2f6" }}
          role="progressbar"
          aria-valuenow={answered}
          aria-valuemin={0}
          aria-valuemax={questions.length}
          aria-label="Questions answered"
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${(answered / questions.length) * 100}%`,
              backgroundColor: accent,
              transition: motionOk ? "width 350ms ease" : undefined,
            }}
          />
        </div>
        <span className="shrink-0 text-[13px] tabular-nums" style={{ color: "#8a94a3" }}>
          {index + 1} / {questions.length}
        </span>
      </div>

      {/*
        Keyed on the question so React replaces the node rather than editing it,
        which is what makes the entry animation run again. Without the key the
        text swaps in place and nothing moves.
      */}
      <div
        key={question.id}
        className={motionOk ? (back ? "step-in-back" : "step-in") : undefined}
        style={{ marginTop: "2rem" }}
      >
        {question.eyebrow && (
          <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: accent }}>
            {question.eyebrow}
          </p>
        )}

        <h2
          ref={heading}
          tabIndex={-1}
          className="mt-2 text-[24px] leading-snug outline-none sm:text-[28px]"
          style={{ fontFamily: "var(--font-dm-serif)", color: "#1a2744" }}
        >
          {question.text}
        </h2>

        <div className="mt-6 space-y-2.5">
          {question.options.map((option, optionIndex) => {
            const chosen = answers[question.id] === optionIndex;
            return (
              <button
                key={option}
                type="button"
                onClick={() => choose(optionIndex)}
                aria-pressed={chosen}
                className="block w-full rounded-xl px-5 py-4 text-left text-[15.5px] leading-snug"
                style={{
                  border: `1px solid ${chosen ? accent : "#e7eef6"}`,
                  backgroundColor: chosen ? "#f0f9ff" : "#fff",
                  color: chosen ? "#1a2744" : "#5f6673",
                  transition: motionOk ? "border-color 120ms, background-color 120ms" : undefined,
                }}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>

      {index > 0 && (
        <button type="button" onClick={goBack} className="mt-6 text-[14px]" style={{ color: "#8a94a3" }}>
          ← Back
        </button>
      )}
    </div>
  );
}
