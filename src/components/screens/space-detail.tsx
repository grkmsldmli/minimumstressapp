"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Key, MapPin, Repeat, Ruler, Sun, Users, Zap } from "lucide-react";

import { AccessPanel } from "@/components/access-panel";
import { ParkingPanel } from "@/components/parking-panel";
import { ReviewsPanel, hasReviewsToShow } from "@/components/reviews-panel";
import { weeksAvailable } from "@/lib/series";
import { sessionDayLong, sessionWeekday } from "@/lib/when";
import { BookingCalendar } from "@/components/booking-calendar";
import { SpaceGallery } from "@/components/space-gallery";
import { PrimaryButton } from "@/components/primitives";
import { DeclareUse } from "@/components/declare-use";
import {
  type DeclaredUse,
  checkDeclaredUse,
  explainUseRejection,
} from "@/lib/booking-use";
import { slotStartsForDate } from "@/lib/availability";
import type { PublicReview, PublicSpace } from "@/lib/domain";
import {
  MAX_UPCOMING_BOOKINGS_FREE,
  PRO_BOOKING_HORIZON_DAYS,
  formatCents,
  isInstantSlot,
  isWithinBookingHorizon,
  quote,
} from "@/lib/money";
import { LATE_CANCELLATION_HOURS } from "@/lib/reliability";
import { spaceTypeBySlug } from "@/lib/space-types";
import { ACCESS_TYPES, amenitiesIn, AMENITY_GROUPS, requirementsByKind, ROOM_SETUPS, roomTypeFor } from "@/lib/taxonomy";
import {
  type CivilDate,
  civilIn,
  sameCivil,
  viewerZone,
  zoneAbbreviation,
  zonesDiffer,
} from "@/lib/timezone";

/** How often the clock is re-read, so "Instant" reflects real time. */
const TICK_MS = 30_000;

/**
 * A slot's instant status is a function of the current time, not a flag on the
 * row. The prototype computed it once per render with nothing to trigger a
 * re-render, so a slot could sit on screen claiming a $5 fee it no longer
 * carried — or quietly acquire one.
 */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

interface Slot {
  startsAt: Date;
  isInstant: boolean;
}

/**
 * The gate's button, named for the state that raised it. Every path leads to the
 * same insurance screen — only the label changes: add cover that is missing,
 * view cover under review, or update cover that was turned down, has lapsed, or
 * doesn't reach the date.
 */
function insuranceCtaLabel(reason: string | null | undefined): string {
  switch (reason) {
    case "insurance_pending":
      return "View insurance";
    case "insurance_rejected":
    case "insurance_expired":
    case "insurance_not_valid_for_date":
      return "Update insurance";
    default:
      // insurance_required / not yet added, and any fallback.
      return "Add insurance";
  }
}

export function SpaceDetail({
  space,
  isPro,
  onBack,
  onBook,
  onGoPro,
  preview = false,
  error,
  notice,
  skipped = [],
  startAt,
  reviews,
  insuranceGate,
  insuranceGateReason,
  onAddInsurance,
}: {
  space: PublicSpace;
  isPro: boolean;
  /** Null while they are still loading, so the section does not flash empty. */
  reviews: PublicReview[] | null;
  onBack: () => void;
  /** `weeks` is 1 for a single session, more for a term. */
  onBook: (startsAt: Date, weeks: number, declared: DeclaredUse) => void | Promise<void>;
  /** Why the booking was refused. Silence here was the bug. */
  error?: string | null;
  /**
   * A booking refused for eligibility rather than availability — no
   * professional profile, or cover that is missing, pending, expired or short
   * of the date. Shown apart from `error` because it is not "try again": it is
   * answered by adding insurance, so it is rendered with a way there.
   */
  insuranceGate?: string | null;
  /** Which eligibility reason raised the gate, so the CTA can name the right action. */
  insuranceGateReason?: string | null;
  onAddInsurance?: () => void;
  /** What a term booking managed, when it managed some of it. */
  notice?: string | null;
  /** The weeks it could not take, each with its own reason. */
  skipped?: { startsAt: string; because: string }[];
  /**
   * A slot to open on, from "book again".
   *
   * The shortcut is the hour, not the room: opening the listing and leaving
   * somebody to find Tuesday 2pm themselves is most of the work they were
   * trying to skip.
   */
  startAt?: Date | null;
  /**
   * True when the viewer is this listing's host.
   *
   * The screen is otherwise identical, deliberately — a preview that renders
   * differently from the thing it previews is worth nothing. Only the action
   * changes, because a host booking their own room is not a booking.
   */
  preview?: boolean;
  onGoPro: () => void;
}) {
  /* Itemisation is available on request, not led with. */
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [booking, setBooking] = useState(false);
  /** What this booking says it is for. Null until somebody answers. */
  const [declared, setDeclared] = useState<DeclaredUse | null>(null);
  const now = useNow();
  /**
   * The day being looked at, on the studio's calendar.
   *
   * It was an offset into an eight-item strip, then a `Date`, and a `Date` was
   * still wrong: reading its day fields asks the reader's timezone what day it
   * is, and the room is the one with opening hours. A room's Tuesday is the
   * same Tuesday from anywhere, so the day carries no zone at all.
   */
  const [day, setDay] = useState<CivilDate>(() =>
    civilIn(startAt ?? now, space.timeZone),
  );
  const [selected, setSelected] = useState<Date | null>(startAt ?? null);
  /** 1 is a single session. More is a term, and Pro only. */
  const [weeks, setWeeks] = useState(1);

  /*
   * The hero collapses as the page scrolls, driven by the one scroll container's
   * own position — not a second scroll area, and not a scroll-timeline, which
   * iOS Safari does not run. A passive listener reads scrollTop once per frame
   * and writes a single custom property; there is no layout read interleaved
   * with the write, so nothing thrashes, and SpaceGallery's height simply
   * follows `--hero-h`. At the top the hero is its full self; a short scroll
   * trims it to about two-thirds and it holds there; scrolling back up restores
   * it. The number the hero starts at (320) matches the height passed below.
   */
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = scrollRef.current;
    const root = rootRef.current;
    if (!scroller || !root) return;

    const EXPANDED = 320;
    const COLLAPSED = 200;
    const DISTANCE = 160;
    let frame = 0;

    const apply = () => {
      frame = 0;
      const p = Math.min(1, Math.max(0, scroller.scrollTop / DISTANCE));
      root.style.setProperty(
        "--hero-h",
        `${Math.round(EXPANDED - (EXPANDED - COLLAPSED) * p)}px`,
      );
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  /*
   * The window is no longer computed here. The calendar owns which days are
   * offered, and `isWithinBookingHorizon` below is what actually refuses one —
   * so there is one rule rather than a screen-side copy that can drift from it,
   * which is exactly how a free account ended up being shown a single day long
   * after the rule had stopped agreeing.
   */
  const slots = useMemo<Slot[]>(() => {
    return slotStartsForDate(space.availability, day, space.timeZone, space.bufferMinutes)
      .filter((startsAt) => startsAt.getTime() > now.getTime())
      .filter((startsAt) => isWithinBookingHorizon(startsAt, now, isPro, space.timeZone))
      .map((startsAt) => ({ startsAt, isInstant: isInstantSlot(startsAt, now) }));
  }, [day, space.availability, space.timeZone, space.bufferMinutes, now, isPro]);

  const isToday = sameCivil(day, civilIn(now, space.timeZone));
  /*
   * "Request" rather than "Book", because the two do different things and the
   * button is where somebody decides.
   */
  const byRequest = space.bookingMode === "request";
  const verb = byRequest ? "Request" : "Book";

  /*
   * Times are the room's times. Said out loud only when the reader is somewhere
   * else, because for everybody in the same city it is noise — but for anyone
   * who is not, a bare "9:00 AM" is the difference between arriving on time and
   * arriving three hours early.
   */
  /*
   * The same function the server runs, so the button and the API agree. The
   * server is still the enforcement — this only decides what the screen says.
   */
  const useProblem = selected
    ? checkDeclaredUse(declared, { allowedUses: space.allowedUses, capacity: space.capacity })
    : null;
  const ready = declared !== null && useProblem === null;

  const zoneNote = zonesDiffer(space.timeZone, viewerZone(), now)
    ? zoneAbbreviation(now, space.timeZone)
    : null;

  const clock = (at: Date) =>
    at.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: space.timeZone,
    });

  const selectedIsInstant = selected ? isInstantSlot(selected, now) : false;

  /*
   * How many weekly repeats this hour could actually reach, so the picker
   * never offers a week the horizon will refuse. Computed for a Pro account
   * even when this one is not, because a free account is being shown what it
   * would get — offering "repeat weekly" and then one week is not an offer.
   */
  const repeatable = selected ? weeksAvailable(selected, space.timeZone, true, now) : 0;

  const priced = quote({
    hostRateCents: space.hourlyRateCents,
    isInstant: selectedIsInstant,
    isPro,
  });

  /*
   * The tile wants a word, not a sentence.
   *
   * ACCESS_TYPES carries "Someone lets you in", which is the right phrasing
   * where a host is choosing how their door works — it says what will happen
   * to you. Inside a 104px tile under the heading ENTRY it stacks a word per
   * line and drags every other tile down to match, and the heading has
   * already supplied the noun.
   */
  const accessLabel =
    space.accessType === "greeter"
      ? "Greeter"
      : (ACCESS_TYPES.find((a) => a.key === space.accessType)?.label ?? "Keypad code");
  const requirementGroups = requirementsByKind(space.requirements);

  /**
   * The uses worth printing, which is not all of them.
   *
   * Four of the ten share a name with a room type — a Treatment Room is both —
   * and the badge at the top of this page already says which room type it is.
   * Printing it again under "Good for" is the listing repeating itself in the
   * one place a reader is scanning for new information. What survives is the
   * part the badge does not already say: that the movement studio above is
   * also set up for pilates.
   *
   * Unknown slugs drop out here too. The column is filtered on the way in, so
   * this is the second of two guards — and the failure it prevents is a
   * listing showing a stranger "reiki-room".
   */
  const roomType = roomTypeFor(space.category);
  const extraUses = space.suitableFor
    .map(spaceTypeBySlug)
    // flatMap rather than filter, because a filter narrows nothing: the
    // compiler still has to be told the nulls are gone, and being told is how
    // one gets through later.
    .flatMap((type) => (type && type.label !== roomType ? [type] : []));

  /*
   * The booking bar is anchored to the bottom and scrolls its own content, so a
   * refusal added to the top of it (the insurance gate) can land above the fold.
   * Bringing it into view is what turns "Book did nothing" back into an answer:
   * the message sits at the top of the bar, and the finger that pressed Book was
   * at the bottom of it.
   */
  return (
    <div ref={rootRef} className="h-full flex flex-col relative screen-in bg-white">
      <SpaceGallery media={space.media} category={space.category} height={320}>
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center press"
          style={{ backgroundColor: "rgba(255,255,255,0.22)", backdropFilter: "blur(8px)" }}
        >
          <ArrowLeft size={16} color="#fff" />
        </button>
        <div>
          <span
            className="px-2.5 py-1 rounded-full font-body text-[12px] text-white"
            style={{ backgroundColor: "rgba(255,255,255,0.2)", backdropFilter: "blur(6px)" }}
          >
            {roomTypeFor(space.category)}
          </span>
          <h2
            className="font-display italic font-semibold text-[28px] text-white leading-tight mt-2"
            style={{ textShadow: "0 2px 12px rgba(0,0,0,0.25)" }}
          >
            {space.name}
          </h2>
          <p className="font-body font-normal text-[13.5px] text-white/80 mt-0.5">
            {space.distanceLabel} · fits {space.capacity}
          </p>
        </div>
      </SpaceGallery>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 pt-5">
        <p className="font-body font-normal text-[15px] leading-relaxed text-ink-muted">
          {space.description}
        </p>

        {/*
          One row that slides, rather than a grid that grows.

          Three to a row meant a fourth fact started a second row and pushed
          the hours further down the page — and the number of facts is not
          fixed, since floor area is optional and more may follow. A grid
          answers that by taking more of the screen every time; a row answers
          it by staying one row.

          `pr-6 -mx-6 px-6` lets the strip run to the edges of a padded page,
          so the last tile is cut off rather than tidily inset. That clipping
          is the only thing telling a thumb there is more to the right.
        */}
        <div className="no-scrollbar flex gap-2.5 mt-5 overflow-x-auto -mx-6 px-6">
          <Fact icon={Users} label="Fits" value={`${space.capacity} ppl`} />
          {space.floorAreaSqft !== null && (
            <Fact icon={Ruler} label="Floor" value={`${space.floorAreaSqft} sq ft`} />
          )}
          <Fact icon={Sun} label="Turnover" value={space.bufferMinutes === 0 ? "None" : `${space.bufferMinutes} min`} />
          <Fact icon={Key} label="Entry" value={accessLabel} />
        </div>

        {/*
          Four answered facts, where a single chip used to read "Wheelchair
          accessible". Somebody who uses a wheelchair could not act on that —
          a step at the door, a lift too narrow to turn in and an unusable
          restroom are all compatible with a ticked box — so they booked,
          travelled, paid, and could not get in.
        */}
        {/*
          Under the description, above everything a host wrote about their own
          room. Somebody deciding reads what other people said before they read
          the pitch.
        */}
        {hasReviewsToShow(reviews, space.reviewCount) && reviews && (
          <>
            <Label>What people said</Label>
            <ReviewsPanel
              reviews={reviews}
              count={space.reviewCount}
              average={space.averageRating}
            />
          </>
        )}

        <Label>Getting in</Label>
        <AccessPanel details={space.access} />

        {/*
          Under "getting in" rather than as its own section, because arriving
          by car is part of the same question — and because a listing with no
          parking answer should not grow an empty heading.
        */}
        <div className="mt-2.5">
          <ParkingPanel parking={space.parking} />
        </div>

        {/*
          What the host says the room suits.

          Shown because it is asked for. A field a host fills in and never sees
          again is a field they stop filling in — and this one decides which
          pages the listing appears on, so it is the last one that should rot.
          It also answers the question a practitioner is actually asking: not
          "what category is this" but "can I teach pilates in it".
        */}
        {extraUses.length > 0 && (
          <>
            <Label>Good for</Label>
            <div className="flex flex-wrap gap-1.5">
              {extraUses.map((type) => (
                <Tag key={type.slug}>{type.label}</Tag>
              ))}
            </div>
          </>
        )}

        {/*
          Split into what is in the room and what the room is like.

          It was one heap headed "Good to know", which is where "Reformers"
          and "Natural light" read as the same kind of fact. They are not: one
          decides whether the work can happen at all, the other decides
          whether it is pleasant. The first is why somebody books.
        */}
        {AMENITY_GROUPS.map((group) => {
          const shown = amenitiesIn(group.group).filter((a) => space.amenities.includes(a.key));
          if (shown.length === 0) return null;
          return (
            <Fragment key={group.group}>
              <Label>{group.heading}</Label>
              <div className="flex flex-wrap gap-1.5">
                {shown.map((amenity) => (
                  <Tag key={amenity.key}>{amenity.label}</Tag>
                ))}
              </div>
            </Fragment>
          );
        })}

        {/*
          Whether the room is theirs for the hour. For anybody seeing one
          person at a time this decides whether the room is usable, and until
          now it was left to be guessed from the capacity.
        */}
        <Label>The space</Label>
        <p className="font-body font-normal text-[15px] leading-relaxed text-ink-muted">
          {ROOM_SETUPS.find((setup) => setup.key === space.roomSetup)?.detail}
        </p>

        {/*
          Above the slot grid on purpose. These are the things that would make
          someone choose a different room, and they are worthless below the
          moment of choosing — the same reasoning as showing the all-in price
          on the card rather than at checkout.
        */}
        {(requirementGroups.length > 0 || space.houseRules) && (
          <>
            <Label>Before you book</Label>
            <div
              className="rounded-2xl p-4"
              style={{ backgroundColor: "#FFF8F1", border: "1px solid #F5DFC4" }}
            >
              {requirementGroups.map((group, i) => (
                <div key={group.kind} className={i > 0 ? "mt-3" : ""}>
                  <p className="font-body font-semibold text-[12px] uppercase tracking-[0.14em] text-warn mb-1.5">
                    {group.heading}
                  </p>
                  <ul className="flex flex-col gap-1">
                    {group.items.map((item) => (
                      <li key={item.key} className="flex items-start gap-2">
                        <span
                          className="w-1 h-1 rounded-full mt-1.5 shrink-0"
                          style={{ backgroundColor: "#8B6C37" }}
                        />
                        <span className="font-body font-normal text-[13.5px] leading-relaxed text-[#7A5B33]">
                          {item.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {space.houseRules && (
                <p
                  className={`font-body font-normal text-[15px] leading-relaxed text-[#7A5B33] ${requirementGroups.length > 0 ? "mt-3 pt-3" : ""}`}
                  style={
                    requirementGroups.length > 0 ? { borderTop: "1px solid #F5DFC4" } : undefined
                  }
                >
                  {space.houseRules}
                </p>
              )}
            </div>
          </>
        )}

        <div
          className="mt-5 rounded-2xl p-3.5 flex items-start gap-2.5"
          style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
        >
          <MapPin size={13} color="#3B9BE8" className="mt-0.5 shrink-0" />
          <div>
            {/*
              The area only, before a booking. The exact address and the way in
              are held back until a session is confirmed — see the access flow
              (space_access_details) and migration 0055. Showing the street here
              would hand every listing's address to anybody browsing.
            */}
            <p className="font-body font-medium text-[15px] text-navy">
              {space.area ?? "Area shared on the listing"}
            </p>
            <p className="font-body font-normal text-[13.5px] leading-relaxed mt-0.5 text-ink-soft">
              Exact address is shared after your booking is confirmed. Entry instructions arrive a
              day before, your door code half an hour before.
            </p>
          </div>
        </div>

        <Label>Pick a day</Label>

        <div className="mb-4">
          <BookingCalendar
            availability={space.availability}
            timeZone={space.timeZone}
            isPro={isPro}
            selected={day}
            now={now}
            onPick={(picked) => {
              setDay(picked);
              setSelected(null);
            }}
          />
        </div>


        {zoneNote && slots.length > 0 && (
          <p className="font-body font-normal text-[13.5px] text-ink-faint mb-2">
            Times shown in {zoneNote}, where the room is.
          </p>
        )}

        {slots.length === 0 ? (
          <p className="font-body font-normal text-[15px] text-ink-faint">
            Nothing open {isToday ? "for the rest of today" : "on this day"}.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {slots.map(({ startsAt, isInstant }) => {
              const active = selected?.getTime() === startsAt.getTime();
              const chargesInstantFee = isInstant && !isPro;
              return (
                <button
                  key={startsAt.toISOString()}
                  type="button"
                  onClick={() => setSelected(startsAt)}
                  className={`relative py-3 rounded-xl font-body text-[15px] press transition-colors ${active ? "slot-pop" : ""}`}
                  style={{
                    backgroundColor: active ? "#16304E" : "#FFFFFF",
                    color: active ? "#fff" : "#16304E",
                    border: `1px solid ${active ? "#16304E" : chargesInstantFee ? "#F5DFC4" : "#DCE7F2"}`,
                  }}
                >
                  {isInstant && (
                    <span
                      className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-full font-body text-[12px] font-medium"
                      style={{
                        backgroundColor: active ? "#8FC6F5" : chargesInstantFee ? "#FFF8F1" : "#EFF4EC",
                        color: active ? "#16304E" : chargesInstantFee ? "#8B6C37" : "#557255",
                        border: active
                          ? "none"
                          : `1px solid ${chargesInstantFee ? "#F5DFC4" : "#DCE6D6"}`,
                      }}
                    >
                      {chargesInstantFee ? "Instant" : "Free"}
                    </span>
                  )}
                  {clock(startsAt)}
                </button>
              );
            })}
          </div>
        )}

        {/*
          What the booking is for and how it repeats, in the page's own scroll
          rather than the pinned bar — so the bar below stays the compact action
          area and this screen keeps a single vertical scroll. Asked only once an
          hour is chosen: answering earlier is answering for a booking not yet
          decided on.
        */}
        {!preview && selected && repeatable > 1 && (
          <button
            type="button"
            onClick={() => (isPro ? setWeeks(weeks > 1 ? 1 : Math.min(4, repeatable)) : onGoPro())}
            className="flex items-center justify-between w-full mt-6 px-3.5 py-2.5 rounded-xl press"
            style={{
              backgroundColor: weeks > 1 ? "#EDF6FE" : "#fff",
              border: `1px solid ${weeks > 1 ? "#3B9BE8" : "#DCE7F2"}`,
            }}
          >
            <span className="flex items-center gap-2 font-body text-[15px] text-navy">
              <Repeat size={13} color={weeks > 1 ? "#3B9BE8" : "#8CA3BD"} />
              {weeks > 1
                ? `Every ${sessionWeekday(selected, space.timeZone)} for ${weeks} weeks`
                : `Repeat weekly${isPro ? "" : " — Pro"}`}
            </span>
            <span className="font-body font-medium text-[15px] text-navy">
              {weeks > 1 ? formatCents(priced.totalCents * weeks) : ""}
            </span>
          </button>
        )}

        {!preview && weeks > 1 && (
          <div className="flex gap-1.5 mt-2.5">
            {Array.from({ length: Math.min(4, repeatable) }, (_, i) => i + 1)
              .filter((n) => n > 1)
              .map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setWeeks(n)}
                  className="flex-1 py-2 rounded-lg font-body text-[13.5px] press"
                  style={{
                    backgroundColor: weeks === n ? "#16304E" : "#fff",
                    color: weeks === n ? "#fff" : "#16304E",
                    border: `1px solid ${weeks === n ? "#16304E" : "#DCE7F2"}`,
                  }}
                >
                  {n} weeks
                </button>
              ))}
          </div>
        )}

        {!preview && selected && (
          <DeclareUse
            allowedUses={space.allowedUses}
            capacity={space.capacity}
            value={declared}
            onChange={setDeclared}
          />
        )}

        {/*
          Said before the card, not after it. A room the host has to accept looks
          identical to one that books straight through until the confirmation
          screen — the button verb and this line are the whole difference.
        */}
        {!preview && byRequest && selected && (
          <p
            className="rounded-xl px-3.5 py-3 font-body font-normal text-[13.5px] leading-relaxed mt-3"
            style={{ backgroundColor: "#FFF8F1", border: "1px solid #F5DFC4", color: "#8B6C37" }}
          >
            This host accepts bookings themselves. Your card is held, not charged, until they say
            yes — and released in full if they say no or do not answer within a day.
          </p>
        )}

        {!isPro && (
          <button
            type="button"
            onClick={onGoPro}
            className="w-full mt-3 rounded-2xl p-3.5 text-left press"
            style={{ backgroundColor: "#FFF8F1", border: "1px solid #F5DFC4" }}
          >
            {/*
              A hook, not the Pro page.
              This carried the whole comparison — four benefits in one sentence
              with two numbers in it — beside a grid of hours somebody is
              trying to choose from. It interrupts either way, so it should
              cost one line and lead somewhere with room to explain, which is
              what the screen it opens now does.
            */}
            <span className="flex items-center gap-1.5 font-body font-medium text-[15px] text-navy">
              <Zap size={12} color="#E8A23D" />
              Booking more than {MAX_UPCOMING_BOOKINGS_FREE} at a time?
            </span>
            <span className="block font-body font-normal text-[13.5px] mt-0.5 text-ink-soft">
              Pro lifts the limit and reaches {PRO_BOOKING_HORIZON_DAYS} days ahead.
            </span>
          </button>
        )}

        {/*
          One price, and the breakdown a tap away.
          A practitioner is choosing a room, not auditing a fee — leading with
          "Session $35, Service fee $7" made the number they pay the third
          thing on the card and invited them to price the two apart.
          It is not hidden, though, and that is deliberate rather than
          cautious: disclosing what a mandatory fee is and what it costs before
          somebody pays is a legal requirement in several places we will
          operate, and a price that cannot be itemised on request is the thing
          those rules exist to stop.
        */}
        <div
          className="mt-6 rounded-2xl p-4"
          style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
        >
          <div className="flex items-center gap-1.5">
            <Check size={11} color="#557255" />
            {/*
              "All In Price — nothing added later" said the same thing twice,
              in a label that is read in a glance. The promise is the half
              worth keeping; the number underneath is already visibly a price.
            */}
            <p className="font-body font-semibold text-[12px] uppercase tracking-[0.14em] text-positive">
              Nothing added later
            </p>
          </div>

          <div className="flex items-baseline justify-between mt-2.5">
            <span className="font-display italic font-semibold text-[26px] text-navy">
              {formatCents(priced.totalCents)}
            </span>
            <span className="font-body font-normal text-[13.5px] text-ink-faint">an hour</span>
          </div>

          {priced.proDiscountCents > 0 && (
            <p className="font-body font-medium text-[15px] mt-1 text-positive">
              Pro discount applied — {formatCents(priced.proDiscountCents)} off
            </p>
          )}

          <button
            type="button"
            onClick={() => setShowBreakdown((open) => !open)}
            className="font-body text-[15px] font-medium mt-2 press text-sky-text"
          >
            {showBreakdown ? "Hide breakdown" : "What's included?"}
          </button>

          {showBreakdown && (
            <div className="mt-2.5 pt-2.5" style={{ borderTop: "1px solid #E7EEF6" }}>
              <Row label="Room" value={formatCents(priced.hostCents)} />
              <Row label="Service fee" value={formatCents(priced.serviceFeeCents)} />
              {priced.instantFeeCents > 0 && (
                <Row label="Instant booking" value={formatCents(priced.instantFeeCents)} />
              )}
              {priced.proDiscountCents > 0 && (
                <Row
                  label="Pro discount"
                  value={`-${formatCents(priced.proDiscountCents)}`}
                  positive
                />
              )}
            </div>
          )}
        </div>

        <div
          className="mt-3 rounded-2xl p-4 flex items-start gap-3"
          style={{ backgroundColor: "#EDF6FE", border: "1px solid #D4E8FA" }}
        >
          {/*
             Four sentences sat here, directly above the button, and nobody
             read them. Two of the four answered questions that only arise
             after something has gone wrong — the studio cancelling, a session
             that went badly — which is not the moment somebody is in when they
             are about to tap Book. They are in the terms, where they belong,
             and they reach the person by notification when the thing actually
             happens.

             What is left is the two facts that change the decision in front of
             them: the money leaves now, and it comes back if they change their
             mind in time.
           */}
          <Check size={14} color="#3B9BE8" className="mt-0.5 shrink-0" />
          <p className="font-body font-normal text-[15px] leading-relaxed text-[#2E5578]">
            You pay now. Cancel {LATE_CANCELLATION_HOURS} hours ahead for a refund.
          </p>
        </div>

      {/*
        The compact action area, kept inside the page's own scroll as a sticky
        footer rather than an absolute overlay. It holds only the final action —
        the Book button, and the insurance gate when a booking is refused for
        cover. Being in flow, it reserves its own space and simply pins to the
        bottom while there is more above to scroll, so it can never cover the
        content and needs no measured padding to compensate: one scroll
        container, friendly to a future pull-to-refresh. `-mx-6` lets its fade
        reach the screen edges past the scroll's own horizontal padding.
      */}
      <div
        className="sticky bottom-0 -mx-6 px-6 pt-4 pb-6"
        style={{ background: "linear-gradient(to top, #FFFFFF 75%, transparent)" }}
      >
        {/*
          Above the button, where somebody is already looking after pressing it.
          A booking can be refused for reasons nobody could have known about
          when they chose the hour — it was taken a second earlier, the host's
          payouts are unfinished, the session expired — and every one of those
          messages is written for the person reading it.
        */}
        {error && (
          <p className="font-body font-normal text-[15px] leading-relaxed mb-2.5 text-coral-deep">
            {error}
          </p>
        )}

        {/*
          Eligibility refused, not availability. This is answered by adding
          cover rather than trying again, so it carries a way there instead of
          sitting as a red line under a button that will keep refusing.
        */}
        {insuranceGate && (
          <div
            className="rounded-xl p-3.5 mb-2.5"
            style={{ backgroundColor: "#FFF8F1", border: "1px solid #F5DFC4" }}
          >
            <p className="font-body font-semibold text-[14px] text-[#8B6C37]">
              Liability insurance
            </p>
            <p className="font-body font-normal text-[13.5px] leading-relaxed mt-1 text-[#8B6C37]">
              {insuranceGate}
            </p>
            {onAddInsurance && (
              <button
                type="button"
                onClick={onAddInsurance}
                className="mt-3 px-4 py-2 rounded-full font-body font-medium text-[13.5px] press"
                style={{ backgroundColor: "#2E5578", color: "#fff" }}
              >
                {insuranceCtaLabel(insuranceGateReason)}
              </button>
            )}
          </div>
        )}

        {/*
          A term rarely lands whole. Naming the weeks that did not is the
          difference between a number somebody has to interpret and an answer
          they can act on.
        */}
        {notice && (
          <div
            className="rounded-xl p-3 mb-2.5"
            style={{ backgroundColor: "#EDF6FE", border: "1px solid #D4E8FA" }}
          >
            <p className="font-body font-medium text-[15px] text-[#2E5578]">{notice}</p>
            {skipped.map((week) => (
              <p
                key={week.startsAt}
                className="font-body font-normal text-[13.5px] mt-1 text-[#2E5578]"
              >
                {sessionDayLong(new Date(week.startsAt), space.timeZone)} — {week.because}
              </p>
            ))}
          </div>
        )}

        {preview ? (
          <PrimaryButton onClick={onBack}>Back to your studio</PrimaryButton>
        ) : (
        /*
          A disabled button reading "Choose a time" when there is no time to
          choose looks like the app is broken. It says which it is now.
        */
        <>
        <PrimaryButton
          disabled={!selected || !ready || booking}
          onClick={() => {
            if (!selected || !declared || useProblem) return;
            setBooking(true);
            void Promise.resolve(onBook(selected, weeks, declared)).finally(() =>
              setBooking(false),
            );
          }}
        >
          {booking
            ? "One moment…"
            : selected
              ? weeks > 1
                ? `${verb} ${weeks} weeks · ${formatCents(priced.totalCents * weeks)}`
                : `${verb} ${clock(selected)}${zoneNote ? ` ${zoneNote}` : ""} · ${formatCents(priced.totalCents)}`
            : slots.length === 0
              ? isToday
                ? "Nothing left today"
                : "Nothing open this day"
              : "Choose a time"}
        </PrimaryButton>

        {/*
          The reason, under the button rather than after a failed attempt.
          A greyed-out button with no explanation is the fault this codebase
          has fixed twice already.
        */}
        {selected && useProblem && (
          <p className="font-body font-normal text-[13.5px] leading-relaxed mt-2 text-ink-soft">
            {explainUseRejection(useProblem, { allowedUses: space.allowedUses, capacity: space.capacity })}
          </p>
        )}
        </>
        )}
      </div>
      </div>
    </div>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div
      /*
       * Fixed width and no shrinking, because these now sit in a row that
       * slides rather than a grid that wraps. Left to itself, flex would
       * squeeze four tiles into the width of three and "Someone lets you in"
       * would stack a word per line, making every tile as tall as the worst
       * one.
       */
      className="rounded-2xl p-3 text-center shrink-0 w-[104px]"
      style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
    >
      <Icon size={14} color="#3B9BE8" className="mx-auto" />
      <p className="font-body font-medium text-[15px] mt-1.5 leading-snug text-navy">{value}</p>
      <p className="font-body text-[12px] uppercase tracking-wide mt-0.5 text-ink-faint">
        {label}
      </p>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] mt-7 mb-3 text-sky-text">
      {children}
    </p>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-full font-body text-[13.5px] text-ink-muted"
      style={{ backgroundColor: "#F4F8FC" }}
    >
      {children}
    </span>
  );
}

function Row({
  label,
  value,
  positive = false,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div
      className={`flex justify-between font-body text-[13.5px] mb-1.5 ${positive ? "text-positive" : "text-ink-soft"}`}
    >
      <span>{label}</span>
      <span className={positive ? "" : "text-navy"}>{value}</span>
    </div>
  );
}
