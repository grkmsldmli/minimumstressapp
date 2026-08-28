"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AccountBadge } from "@/components/account-badge";
import { LocationPrompt, type LocationChoice } from "@/components/location-prompt";
import type { Rebookable } from "@/lib/rebook";
import { RatingBadge } from "@/components/stars";
import { summariseAggregate } from "@/lib/reviews";
import {
  Bell,
  Calendar,
  ChevronRight,
  List,
  Map as MapIcon,
  MapPin,
  Moon,
  Search,
  Sun,
  X,
} from "lucide-react";

import {
  AllCategoriesIcon,
  Ambient,
  CatIcon,
  Headline,
  LogoBadge,
  categoryGradient,
} from "@/components/brand";
import { BookAgain } from "@/components/book-again";
import { BrowseMap } from "@/components/browse-map";
import { HostBadges } from "@/components/host-badges";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { TiltCard } from "@/components/primitives";
import type { PublicSpace } from "@/lib/domain";
import { PRO_BOOKING_HORIZON_DAYS, formatCents, quote } from "@/lib/money";
import { CATEGORIES, type CategoryKey, roomTypeFor, specialtiesFor } from "@/lib/taxonomy";

type Filter = CategoryKey | "all";

/**
 * The all-in price for a listing card.
 *
 * Every surface that shows a price shows this one — search results, the map
 * card, the detail header — so the number a practitioner first sees is the
 * number they pay. Instant and credit are excluded here on purpose: both
 * depend on the specific slot, and quoting a best case on a browse card is
 * exactly the pattern the pricing rules exist to avoid.
 */
function browsePriceCents(space: PublicSpace, isPro: boolean): number {
  return quote({
    hostRateCents: space.hourlyRateCents,
    isInstant: false,
    isPro,
  }).totalCents;
}

export function Discover({
  spaces,
  isPro,
  onRefresh,
  onOpenSpace,
  onGoPro,
  onGoBookings,
  onGoNotifications,
  undeliveredCount,
  onGoProfile,
  onGoLegal,
  greetingName,
  you,
  rebookable,
  onRebook,
  savedPostcode,
  onChangePostcode,
  nearbyOrder,
  onChooseLocation,
  distanceLabels,
  locationError,
}: {
  spaces: PublicSpace[];
  isPro: boolean;
  /** Pull-to-refresh: re-fetches discovery data in place. */
  onRefresh: () => Promise<unknown> | unknown;
  onOpenSpace: (id: string) => void;
  onGoPro: () => void;
  onGoBookings: () => void;
  onGoNotifications: () => void;
  /** Messages that never arrived. The only reason to interrupt somebody. */
  undeliveredCount: number;
  onGoProfile: () => void;
  onGoLegal: () => void;
  greetingName: string | null;
  /** Ids nearest-first, or null while nobody has said where they are. */
  /** Where the practitioner is, when they have shared it. This visit only. */
  you: { lat: number; lng: number } | null;
  /** Rooms they have used, at the hour they used them. */
  rebookable: Rebookable[];
  onRebook: (entry: Rebookable) => void;
  /** A postcode they saved, if any. Replaces the prompt with the answer. */
  savedPostcode: string | null;
  onChangePostcode: () => void;
  nearbyOrder: string[] | null;
  onChooseLocation: (choice: LocationChoice) => void;
  /** Coarse label per space id — "0.8 mi". Never a coordinate. */
  distanceLabels: Record<string, string>;
  locationError: string | null;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  // Dismissing hides the prompt for this visit only. Storing the refusal would
  // mean remembering a "no" that was about one moment, not about the feature.
  const [askedAlready, setAskedAlready] = useState(false);
  const [view, setView] = useState<"list" | "map">("list");

  // The featured rail scrolls horizontally, so it keeps its own position. When
  // the set it shows changes — a category tapped, a search typed — that position
  // is stale, and leaving it there is how the rail opens half-scrolled onto a
  // card that is no longer the first match. Reset it to the start instead.
  const railRef = useRef<HTMLDivElement>(null);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const GreetIcon = hour < 18 ? Sun : Moon;

  // Only offer a filter that would return something. The prototype listed all
  // five regardless, so a tap could land on an empty screen.
  const offered = useMemo(
    () => CATEGORIES.filter((c) => spaces.some((s) => s.category === c.key)),
    [spaces],
  );

  // If the chosen category stops being offered — the last listing in it was
  // delisted, say — fall back during render rather than correcting it in an
  // effect, which would paint an empty screen first and then fix itself.
  const active: Filter =
    filter !== "all" && !offered.some((c) => c.key === filter) ? "all" : filter;

  // Back to the first card whenever the filter or the search changes what the
  // rail is showing. Cheap and layout-safe: one scroll assignment, no listener.
  useEffect(() => {
    railRef.current?.scrollTo({ left: 0 });
  }, [active, query]);

  const byCategory = active === "all" ? spaces : spaces.filter((s) => s.category === active);

  /**
   * Ordered by the server's answer, not by anything computed here.
   *
   * The listings a browser holds carry no coordinates — that is the whole
   * point of `spaces_public` — so the order arrives as a list of ids and this
   * only applies it. Anything the server did not rank keeps its place at the
   * end rather than vanishing.
   */
  const visible = useMemo(() => {
    const ordered = nearbyOrder
      ? [...byCategory].sort(
          (a, b) =>
            (new Map(nearbyOrder.map((id, i) => [id, i])).get(a.id) ?? Infinity) -
            (new Map(nearbyOrder.map((id, i) => [id, i])).get(b.id) ?? Infinity),
        )
      : byCategory;

    const needle = query.trim().toLowerCase();
    if (!needle) return ordered;

    /**
     * Everything the listing already shows, which now includes where it is.
     *
     * The address used to be left out on purpose, and the reason was sound
     * while it held: matching on a street turned the box into an oracle —
     * type an address, see whether anything comes back — and a room private
     * until booked would not have stayed private. 0032 publishes the address
     * on the listing, so the oracle answers a question anybody can already ask
     * by scrolling, and leaving it out only meant somebody could read "San
     * Mateo" on a card and find nothing by typing it.
     *
     * The category's specialties go in too. A Movement Studio is a room for
     * yoga and pilates whether or not the host happened to write those words,
     * and somebody searching for their own practice is searching for the
     * thing, not for a host's choice of adjective.
     */
    return ordered.filter((space) => {
      const haystack = [
        space.name,
        roomTypeFor(space.category),
        space.description,
        space.area ?? "",
        ...specialtiesFor(space.category),
        ...space.amenities,
      ]
        .join(" ")
        .toLowerCase();

      // Every word has to appear somewhere, so "quiet mirror" narrows rather
      // than widening the way an any-word match would.
      return needle.split(/\s+/).every((word) => haystack.includes(word));
    });
  }, [byCategory, nearbyOrder, query]);

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      {!isPro && (
        <button
          type="button"
          onClick={onGoPro}
          className="flex items-center justify-between gap-3 px-6 py-2.5 press shrink-0"
          style={{ backgroundColor: "#16304E" }}
        >
          {/*
            This said "book instantly, no extra fee". Pro has never waived the
            instant fee — quote() charges it to everyone and says why: a fee
            waived per booking is unbounded against a fixed subscription, and
            it was tried and taken back out. The benefit stayed on the banner
            after the code stopped delivering it.
          */}
          <span className="font-body font-normal text-[13.5px] text-white/70 min-w-0 truncate">
            Unlimited sessions, {PRO_BOOKING_HORIZON_DAYS} days ahead
          </span>
          {/*
            The half of this row that is a button should look like one.
            "Go Pro" was white on navy at the same weight as the sentence
            beside it, so the strip read as a notice somebody had left there
            rather than something to press. Blue is the colour every other
            action in the app uses, and the pill is what separates the offer
            from the way to take it.
          */}
          <span
            className="flex items-center gap-0.5 font-body text-[13.5px] font-semibold shrink-0 px-3 py-1 rounded-full"
            style={{
              /*
               * sky-cta rather than the brand blue, which is the distinction
               * globals.css draws and contrast.test.ts pins: #3b9be8 is for
               * filling and drawing, and carries white lettering at 2.98 —
               * under the line for text this size. This one clears it at 4.62.
               *
               * The ring is because sky-cta sits at 2.90 against the navy
               * strip, just under the 3:1 a control's own edge wants. A pill
               * that needs looking for is not a button.
               */
              backgroundColor: "#2578C2",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.28)",
            }}
          >
            Go Pro <ChevronRight size={12} />
          </span>
        </button>
      )}

      <div
        className="px-6 pt-8 pb-7 rounded-b-[30px] relative overflow-hidden shrink-0"
        style={{ background: "radial-gradient(130% 130% at 20% 0%, #1E4066 0%, #16304E 80%)" }}
      >
        <Ambient />
        <div className="flex items-center justify-between gap-2 relative z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <button type="button" onClick={onGoProfile} className="press shrink-0" aria-label="Your profile">
              <LogoBadge size={34} />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <GreetIcon size={11} color="#8FC6F5" className="shrink-0" />
                <p className="font-body font-normal text-[13.5px] tracking-wide text-white/70 truncate">
                  {greetingName ? `${greeting}, ${greetingName}` : greeting}
                </p>
              </div>
              {/* Which side they are on, on the screen they spend most time on. */}
              <div className="mt-1">
                <AccountBadge accountType="practitioner" tone="dark" />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <RoundButton label="Your bookings" onClick={onGoBookings}>
              <Calendar size={15} color="#fff" />
            </RoundButton>
            <RoundButton label="What we've sent you" onClick={onGoNotifications}>
              <Bell size={15} color="#fff" />
              {/*
                A dot only when something failed to arrive. An unread badge
                would nag about messages somebody has already had by email;
                the one thing worth interrupting for is one they never got.
              */}
              {undeliveredCount > 0 && (
                <span
                  className="absolute rounded-full"
                  style={{
                    top: 1,
                    right: 1,
                    width: 8,
                    height: 8,
                    backgroundColor: "#F2695C",
                    border: "1.5px solid #16304E",
                  }}
                />
              )}
            </RoundButton>
            <RoundButton
              label={view === "list" ? "Show map" : "Show list"}
              onClick={() => setView(view === "list" ? "map" : "list")}
            >
              {view === "list" ? <MapIcon size={15} color="#fff" /> : <List size={15} color="#fff" />}
            </RoundButton>
          </div>
        </div>

        <div className="mt-4 relative z-10">
          <Headline pre="Where will you" accent="practice today?" size={24} light />
        </div>

        <div
          className="flex items-center gap-2.5 mt-5 px-4 py-3 rounded-full relative z-10"
          style={{
            backgroundColor: "rgba(255,255,255,0.1)",
            border: "1px solid rgba(255,255,255,0.16)",
          }}
        >
          <Search size={14} color="#8FC6F5" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search spaces"
            aria-label="Search spaces"
            className="font-body font-normal text-[14px] outline-none w-full min-w-0 bg-transparent text-white placeholder:text-white/50 placeholder:truncate"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="press shrink-0"
            >
              <X size={13} color="#8FC6F5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2 px-6 py-4 overflow-x-auto no-scrollbar shrink-0">
        <FilterChip active={active === "all"} onClick={() => setFilter("all")}>
          <AllCategoriesIcon size={12} />
          All
        </FilterChip>
        {offered.map((category) => (
          <FilterChip
            key={category.key}
            active={active === category.key}
            onClick={() => setFilter(category.key)}
          >
            <CatIcon cat={category.key} size={12} />
            {category.shortLabel}
          </FilterChip>
        ))}
      </div>

      {view === "map" ? (
        <MapView spaces={visible} isPro={isPro} onOpen={onOpenSpace} you={you} />
      ) : (
        <PullToRefresh className="flex-1 pb-8" onRefresh={onRefresh}>
          {active === "all" && visible.length > 0 && (
            <>
              <SectionLabel className="px-6">Open right now</SectionLabel>
              {/*
                One card at a time, with the next just peeking. Snap holds a card
                flush at the left rather than resting between two, and scroll-pl
                matches the px-6 gutter so the snapped card sits inside the
                padding rather than clipped against the edge. Card width is a
                share of this rail's own width (see FeaturedCard), so the peek is
                the same on a 320px phone as on a 430px one without any vw maths.
              */}
              <div
                ref={railRef}
                // Proximity, not mandatory: the finger drags freely and the rail
                // only settles toward a card when it comes to rest near one, so a
                // flick never feels caught. Snap is kept, just gentler.
                className="flex gap-3.5 px-6 pb-6 overflow-x-auto no-scrollbar snap-x snap-proximity scroll-pl-6"
                style={{ perspective: 800 }}
              >
                {visible.slice(0, 4).map((space, i) => (
                  <FeaturedCard
                    key={space.id}
                    space={space}
                    isPro={isPro}
                    index={i}
                    onClick={() => onOpenSpace(space.id)}
                  />
                ))}
              </div>
            </>
          )}

          {/*
            Above the location prompt on purpose. Somebody returning to a room
            they use weekly has already answered "where", and asking again
            before offering the shortcut puts a question in front of an answer.
          */}
          <BookAgain rooms={rebookable} onPick={onRebook} />

          {savedPostcode ? (
            /*
              Already answered. What replaces the prompt is the answer itself,
              because a setting somebody cannot see is one they cannot change —
              and this one decides the order of everything below it.
            */
            <div className="px-6 mb-4 flex items-center gap-2">
              <MapPin size={13} className="shrink-0 text-sky-text" />
              <p className="font-body font-normal text-[14px] text-ink-soft">
                Sorted by distance from {savedPostcode}
              </p>
              <button
                type="button"
                onClick={onChangePostcode}
                className="font-body font-medium text-[14px] press text-sky-text"
              >
                Change
              </button>
            </div>
          ) : (
            nearbyOrder === null &&
            !askedAlready && (
              <div className="px-6 mb-4">
                <LocationPrompt
                  onChoose={onChooseLocation}
                  onDismiss={() => setAskedAlready(true)}
                />
              </div>
            )
          )}

          {locationError && (
            <p className="px-6 mb-3 font-body font-normal text-[14px] text-coral-deep">
              {locationError}
            </p>
          )}

          <SectionLabel className="px-6">
            {active === "all"
              ? nearbyOrder
                ? "Nearest first"
                : "All spaces"
              : `${CATEGORIES.find((c) => c.key === active)?.shortLabel} spaces`}
          </SectionLabel>

          {visible.length === 0 ? (
            /*
              "No spaces listed yet" was shown for both of these, and they are
              not the same sentence. One says the platform is empty; the other
              says this particular search found nothing — and reading the first
              when the second is true tells somebody there is nothing here and
              sends them away.
            */
            <div className="px-6">
              <p className="font-body font-normal text-[15px] text-ink-soft">
                {query.trim()
                  ? `Nothing matches “${query.trim()}”.`
                  : "No spaces listed yet."}
              </p>
              {query.trim() && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="font-body font-medium text-[15px] mt-1.5 press text-sky-text"
                >
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <div className="px-6 flex flex-col gap-2.5">
              {visible.map((space, i) => (
                <SpaceRow
                  key={space.id}
                  space={space}
                  isPro={isPro}
                  index={i}
                  distanceLabel={distanceLabels[space.id]}
                  onClick={() => onOpenSpace(space.id)}
                />
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={onGoLegal}
            className="w-full text-center font-body font-normal text-[13.5px] mt-6 press text-ink-faint"
          >
            Terms &amp; Privacy
          </button>
        </PullToRefresh>
      )}
    </div>
  );
}

function RoundButton({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="w-9 h-9 rounded-full flex items-center justify-center press"
      style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
    >
      {children}
    </button>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex items-center gap-1.5 px-3.5 py-2 rounded-full whitespace-nowrap font-body text-[13.5px] press transition-colors"
      style={{
        backgroundColor: active ? "#3B9BE8" : "#FFFFFF",
        color: active ? "#fff" : "#16304E",
        border: `1px solid ${active ? "#3B9BE8" : "#DCE7F2"}`,
      }}
    >
      {children}
    </button>
  );
}

function SectionLabel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`font-body font-semibold text-[12px] uppercase tracking-[0.2em] mb-3 text-sky-text ${className}`}
    >
      {children}
    </p>
  );
}

function FeaturedCard({
  space,
  isPro,
  index,
  onClick,
}: {
  space: PublicSpace;
  isPro: boolean;
  index: number;
  onClick: () => void;
}) {
  const [from, to] = categoryGradient(space.category);
  const price = browsePriceCents(space, isPro);
  const cover = space.media[0] ?? null;
  const photoCount = space.media.length;

  return (
    <TiltCard
      onClick={onClick}
      // Width is a share of the rail, not a fixed 230px: one card fills the
      // viewport with a small peek of the next at every phone width, and the cap
      // keeps it from ballooning on a wide screen. snap-start pairs with the
      // rail's scroll-snap so it comes to rest flush, never half-shown.
      className="snap-start shrink-0 basis-[85%] max-w-[320px] rounded-[24px] overflow-hidden text-left press card-in"
      style={{
        animationDelay: `${index * 90}ms`,
        boxShadow: "0 16px 34px -16px rgba(22,48,78,0.35)",
        border: "1px solid #E7EEF6",
      }}
    >
      {/*
        The room itself, when there is one. Every card used to be the same
        coloured rectangle with the same icon, which made a wall of listings
        indistinguishable at exactly the moment somebody is choosing between
        them.
      */}
      <div className="h-[145px] relative">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover.url} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ background: `radial-gradient(130% 110% at 20% 0%, ${from} 0%, ${to} 90%)` }}
          >
            <CatIcon cat={space.category} size={24} color="rgba(255,255,255,0.92)" />
          </div>
        )}
        <div
          className="absolute inset-x-0 bottom-0 pointer-events-none"
          style={{
            height: 72,
            background: "linear-gradient(to top, rgba(10,26,44,0.6), transparent)",
          }}
        />
        <span
          className="absolute right-4 bottom-4 px-2 py-1 rounded-full font-body text-[12px] text-white"
          style={{ backgroundColor: "rgba(255,255,255,0.18)", backdropFilter: "blur(6px)" }}
        >
          {roomTypeFor(space.category)}
        </span>
        {photoCount > 1 && (
          <span
            className="absolute left-4 bottom-4 px-2 py-1 rounded-full font-body text-[12px] text-white"
            style={{ backgroundColor: "rgba(10,26,44,0.45)", backdropFilter: "blur(6px)" }}
          >
            {photoCount} photos
          </span>
        )}
      </div>
      <div className="p-4 bg-white">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-display italic font-semibold text-[17px] text-navy min-w-0 truncate">
            {space.name}
          </p>
          <p className="font-body text-[13.5px] text-navy shrink-0">
            <span className="font-semibold">{formatCents(price)}</span>
            <span className="text-ink-faint">/hr</span>
          </p>
        </div>
        <p className="font-body font-normal text-[12px] mt-0.5 text-ink-faint">
          All fees included
        </p>
        <p className="font-body font-normal text-[13.5px] mt-0.5 text-ink-soft">
          {roomTypeFor(space.category)} · {space.distanceLabel}
        </p>
        {/* At most two restrained host signals, below the room, never over it. */}
        <div className="mt-1.5">
          <HostBadges space={space} variant="compact" />
        </div>
      </div>
    </TiltCard>
  );
}

function SpaceRow({
  space,
  isPro,
  index,
  distanceLabel,
  onClick,
}: {
  space: PublicSpace;
  isPro: boolean;
  index: number;
  /** Coarse, from the server. Absent until somebody has shared a location. */
  distanceLabel?: string;
  onClick: () => void;
}) {
  const [from, to] = categoryGradient(space.category);
  const price = browsePriceCents(space, isPro);
  const cover = space.media[0] ?? null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3.5 p-3 rounded-2xl text-left press card-in bg-white"
      style={{
        border: "1px solid #E7EEF6",
        animationDelay: `${index * 70}ms`,
        boxShadow: "0 4px 14px -8px rgba(22,48,78,0.12)",
      }}
    >
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cover.url}
          alt=""
          className="w-14 h-14 rounded-xl shrink-0 object-cover"
        />
      ) : (
        <div
          className="w-14 h-14 rounded-xl shrink-0 flex items-center justify-center"
          style={{ background: `radial-gradient(120% 120% at 25% 15%, ${from}, ${to})` }}
        >
          <CatIcon cat={space.category} size={18} color="rgba(255,255,255,0.92)" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-body font-medium text-[15px] text-navy">
          {space.name} · {roomTypeFor(space.category)}
        </p>
        <p className="font-body font-normal text-[14px] mt-0.5 text-ink-soft truncate">
          {space.description}
        </p>
        <div className="mt-1">
          <RatingBadge summary={summariseAggregate(space.reviewCount, space.averageRating)} />
        </div>
        <p className="font-body font-normal text-[13.5px] mt-0.5 flex items-center gap-1 text-ink-faint">
          {/*
            The measured distance when somebody has shared where they are,
            and the listing's own vague word when they have not. Never a
            fabricated number — the seeded demo rows carry one, real rows say
            "nearby" and mean it.
          */}
          <MapPin size={10} /> {distanceLabel ?? space.distanceLabel} · fits {space.capacity}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="font-body font-semibold text-[14.5px] text-navy">{formatCents(price)}</p>
        <p className="font-body font-normal text-[12px] text-ink-faint">incl. fees</p>
        <ChevronRight size={14} color="#8BA3BD" className="ml-auto mt-0.5" />
      </div>
    </button>
  );
}

function MapView({
  spaces,
  isPro,
  onOpen,
  you,
}: {
  spaces: PublicSpace[];
  isPro: boolean;
  onOpen: (id: string) => void;
  /** Where the practitioner is, when they have shared it. */
  you: { lat: number; lng: number } | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const active = spaces.find((s) => s.id === selected) ?? null;

  return (
    <div className="relative flex-1 overflow-hidden">
      {/*
        A real map. What was here drew painted roads and placed markers at two
        decorative numbers from the prototype — it looked like a map, so it was
        read as one.
      */}
      <BrowseMap
        pins={spaces
          .filter((space) => space.approxLat !== null && space.approxLng !== null)
          .map((space) => ({
            id: space.id,
            name: space.name,
            // The coarse point, not the building — see approxLat/approxLng.
            point: { lat: space.approxLat!, lng: space.approxLng! },
            category: space.category,
            active: selected === space.id,
          }))}
        you={you}
        onSelect={(id) => setSelected(selected === id ? null : id)}
      />

      {active && (
        <div className="absolute bottom-4 left-4 right-4 z-30 card-in">
          <div
            className="flex items-center gap-3 p-3 rounded-2xl bg-white"
            style={{
              boxShadow: "0 18px 40px -14px rgba(22,48,78,0.35)",
              border: "1px solid #E7EEF6",
            }}
          >
            <div
              className="w-14 h-14 rounded-xl shrink-0 flex items-center justify-center"
              style={{
                background: `radial-gradient(120% 120% at 25% 15%, ${categoryGradient(active.category)[0]}, ${categoryGradient(active.category)[1]})`,
              }}
            >
              <CatIcon cat={active.category} size={18} color="rgba(255,255,255,0.92)" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-body font-medium text-[14.5px] text-navy">
                {active.name} · {roomTypeFor(active.category)}
              </p>
              <p className="font-body font-normal text-[13.5px] mt-0.5 text-ink-soft">
                {active.distanceLabel} · {formatCents(browsePriceCents(active, isPro))}/hr{" "}
                <span className="text-ink-faint">incl. fees</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpen(active.id)}
              className="px-3.5 py-2 rounded-full font-body font-medium text-[15px] text-white shrink-0 press"
              style={{ backgroundColor: "#2578C2" }}
            >
              View
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
