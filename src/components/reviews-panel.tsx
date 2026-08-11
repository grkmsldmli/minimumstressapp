"use client";

import { useState } from "react";

import { StarRow } from "@/components/stars";
import type { PublicReview } from "@/lib/domain";
import { MIN_REVIEWS_FOR_AVERAGE, summariseAggregate } from "@/lib/reviews";

/**
 * What people wrote about a room.
 *
 * The machinery for this has existed since the reviews work: a view that
 * releases a review only once both sides have written or a fortnight has
 * passed, an aggregate that ignores the sealed ones, a rule that withholds an
 * average under three. Nothing had ever read from any of it. A star count was
 * shown on the browse card and the words themselves were shown nowhere at all,
 * which is the half of a review anybody actually reads.
 *
 * Only the practitioner side is shown here. A studio's reviews of its visitors
 * are real and are kept, but they belong to the studio deciding whether to
 * accept somebody — not on a page where a practitioner is deciding about a
 * room. Publishing them here would turn a listing into a noticeboard about
 * people who are not the subject of it.
 */
/**
 * Whether there is anything to head a section with.
 *
 * Exported so the caller does not render a title above nothing. A heading with
 * an empty space under it is the same fault as the description gap — it reads
 * as something that failed to load rather than something nobody has written.
 */
export function hasReviewsToShow(reviews: PublicReview[] | null, count: number): boolean {
  if (reviews === null) return false;
  return count > 0 || reviews.some((r) => r.role === "practitioner" && r.comment?.trim());
}

export function ReviewsPanel({
  reviews,
  count,
  average,
}: {
  reviews: PublicReview[];
  count: number;
  average: number | null;
}) {
  const [showAll, setShowAll] = useState(false);

  const summary = summariseAggregate(count, average);
  const written = reviews.filter((r) => r.role === "practitioner" && r.comment?.trim());
  const shown = showAll ? written : written.slice(0, 3);

  // Nothing to say and no way to dress it up. A studio with no reviews is new,
  // and an empty panel headed "Reviews" only draws attention to that.
  if (!hasReviewsToShow(reviews, count)) return null;

  return (
    <div>
      <div className="flex items-baseline gap-2.5">
        <StarRow rating={summary.average ?? 0} size={15} />
        <span className="font-body font-medium text-[15px] text-navy">
          {summary.average === null ? "New" : summary.average.toFixed(1)}
        </span>
        <span className="font-body font-normal text-[13.5px] text-ink-faint">
          {count === 1 ? "1 review" : `${count} reviews`}
        </span>
      </div>

      {/*
        Said plainly rather than shown as a caveat next to a number. One
        three-star review renders as "3.0" beside a competitor's "4.9" and
        reads as settled fact; a studio should not lose its second booking to
        its first bad night.
      */}
      {summary.isNew && count > 0 && (
        <p className="font-body font-normal text-[13px] mt-1 text-ink-faint">
          An average appears once a room has {MIN_REVIEWS_FOR_AVERAGE} reviews.
        </p>
      )}

      <div className="flex flex-col gap-3 mt-3.5">
        {shown.map((review) => (
          <div
            key={review.id}
            className="rounded-xl p-3.5"
            style={{ backgroundColor: "#F8FAFD", border: "1px solid #E7EEF6" }}
          >
            <div className="flex items-center gap-2">
              <StarRow rating={review.overall} size={11} />
              <span className="font-body font-normal text-[12.5px] text-ink-faint">
                {review.createdAt.toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </div>
            <p className="font-body font-normal text-[14px] leading-relaxed mt-1.5 text-ink-muted">
              {review.comment}
            </p>
          </div>
        ))}
      </div>

      {written.length > 3 && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-full mt-2.5 py-2.5 rounded-xl font-body font-medium text-[14.5px] press bg-white"
          style={{ border: "1px solid #DCE7F2", color: "#16304E" }}
        >
          Read all {written.length}
        </button>
      )}

      {/*
        A room can have ratings and no words. Saying so is better than an
        average floating above nothing, which reads like something failed.
      */}
      {count > 0 && written.length === 0 && (
        <p className="font-body font-normal text-[13.5px] mt-2 text-ink-faint">
          Nobody has written anything yet — the ratings above came without a comment.
        </p>
      )}
    </div>
  );
}
