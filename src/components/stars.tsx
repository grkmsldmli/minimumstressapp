"use client";

import { Star } from "lucide-react";

import { type Rating, type RatingSummary } from "@/lib/reviews";

/**
 * Stars, for choosing a rating and for showing one.
 *
 * Two components rather than one with a `readOnly` prop, because they are
 * different controls: one is a radio group a keyboard must be able to reach,
 * the other is a picture. Collapsing them tends to produce a picture that
 * announces itself to a screen reader as five unlabelled buttons.
 */

const GOLD = "#E8A33D";
const EMPTY = "#DCE7F2";

export function StarPicker({
  value,
  onChange,
  label,
  size = 30,
}: {
  value: Rating | null;
  onChange: (rating: Rating) => void;
  label: string;
  size?: number;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1.5">
      {([1, 2, 3, 4, 5] as const).map((n) => {
        const filled = value !== null && n <= value;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            // Named, not numbered: "3" alone tells a screen reader nothing
            // about which end of the scale it sits on.
            aria-label={`${n} out of 5`}
            onClick={() => onChange(n)}
            className="press p-0.5"
          >
            <Star
              size={size}
              // Stroke only until chosen, so an unanswered question looks
              // unanswered rather than looking like a deliberate one star.
              fill={filled ? GOLD : "none"}
              color={filled ? GOLD : EMPTY}
              strokeWidth={1.5}
            />
          </button>
        );
      })}
    </div>
  );
}

/**
 * A listing's rating.
 *
 * Under three reviews there is no average to show — see `summarise` for why
 * one bad first night should not decide whether a studio gets a second
 * booking. "New" is both truer and fairer than "3.0".
 */
export function RatingBadge({
  summary,
  size = 13,
}: {
  summary: RatingSummary;
  size?: number;
}) {
  if (summary.count === 0) {
    return (
      <span className="font-body font-normal text-[13.5px] text-ink-faint">No reviews yet</span>
    );
  }

  if (summary.isNew) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span
          className="px-2 py-0.5 rounded-full font-body font-medium text-[15px]"
          style={{ backgroundColor: "#EDF6FE", color: "#2670B0" }}
        >
          New
        </span>
        <span className="font-body font-normal text-[13.5px] text-ink-faint">
          {summary.count} {summary.count === 1 ? "review" : "reviews"}
        </span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Star size={size} fill={GOLD} color={GOLD} strokeWidth={0} />
      <span className="font-body font-medium text-[15px] text-navy">
        {summary.average!.toFixed(1)}
      </span>
      <span className="font-body font-normal text-[13.5px] text-ink-faint">({summary.count})</span>
    </span>
  );
}

/** The same rating, drawn rather than written. Decorative — the number is read out. */
export function StarRow({ rating, size = 12 }: { rating: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-hidden="true">
      {([1, 2, 3, 4, 5] as const).map((n) => (
        <Star
          key={n}
          size={size}
          fill={n <= rating ? GOLD : "none"}
          color={n <= rating ? GOLD : EMPTY}
          strokeWidth={1.5}
        />
      ))}
    </span>
  );
}
