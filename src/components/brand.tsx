import Image from "next/image";

import { CATEGORIES, type CategoryKey } from "@/lib/taxonomy";
import { Activity, LayoutGrid, Leaf, MessagesSquare, Sparkles } from "lucide-react";

/**
 * Served locally rather than from the Shopify CDN the prototype pointed at.
 * That storefront is a separate property we were told not to touch, so the app
 * should not depend on a URL that can move out from under it.
 */
export const LOGO_MARK = "/logo-mark.png";
const LOGO_ASPECT = 300 / 122;

interface IconProps {
  size?: number;
  color?: string;
  className?: string;
}

/**
 * Category icons, kept out of `taxonomy.ts` so the icon library stays clear of
 * server bundles that only need the data.
 *
 * Written as a switch rather than a lookup because returning a component from a
 * function and rendering it reads to React as constructing a component during
 * render, which resets its state on every pass.
 *
 * "All" gets its own glyph. The prototype gave both "All" and Mind & Spirit the
 * Sparkles icon, leaving the two indistinguishable in the filter row. Mind &
 * Spirit keeps Sparkles — it is one of the four locked categories — so the
 * utility filter is the one that moves.
 */
export function CatIcon({ cat, size = 16, color, className }: IconProps & { cat: CategoryKey }) {
  switch (cat) {
    case "physical":
      return <Activity size={size} color={color} className={className} />;
    case "traditional":
      return <Leaf size={size} color={color} className={className} />;
    case "social":
      return <MessagesSquare size={size} color={color} className={className} />;
    case "spirit":
      return <Sparkles size={size} color={color} className={className} />;
  }
}

export function AllCategoriesIcon({ size = 16, color, className }: IconProps) {
  return <LayoutGrid size={size} color={color} className={className} />;
}

/** Gradient used for a category's cards, tiles, and pins. */
export function categoryGradient(cat: CategoryKey): readonly [string, string] {
  return CATEGORIES.find((c) => c.key === cat)!.gradient;
}

/** Twinkling stars and drifting orbs, for the navy screens. */
export function Ambient() {
  return (
    <div className="ambient" aria-hidden="true">
      <div className="amb-stars" />
      <div className="amb-orb o1" />
      <div className="amb-orb o2" />
      <div className="amb-orb o3" />
    </div>
  );
}

/** The 4-7-8 breathing mark: 19 seconds per cycle, driven entirely by CSS. */
export function BreathingLogo({ size = 150 }: { size?: number }) {
  return (
    <div className="breathing-logo" style={{ width: size, height: size }}>
      <div className="logo-disc">
        <Image
          src={LOGO_MARK}
          alt="Minimum Stress"
          width={Math.round(size * 0.68)}
          height={Math.round((size * 0.68) / LOGO_ASPECT)}
          priority
          style={{ width: "68%", height: "auto", objectFit: "contain" }}
        />
      </div>
      <div className="logo-ring r1" />
      <div className="logo-ring r2" />
    </div>
  );
}

export function LogoBadge({ size = 34 }: { size?: number }) {
  return (
    <div
      className="rounded-full bg-white flex items-center justify-center shrink-0"
      style={{ width: size, height: size, boxShadow: "0 3px 10px -3px rgba(22,48,78,0.35)" }}
    >
      <Image
        src={LOGO_MARK}
        alt=""
        width={Math.round(size * 0.66)}
        height={Math.round((size * 0.66) / LOGO_ASPECT)}
        style={{ width: "66%", height: "auto", objectFit: "contain" }}
      />
    </div>
  );
}

export function Wordmark({ size = 13 }: { size?: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="font-body font-semibold tracking-[0.22em] text-sky"
        style={{ fontSize: size }}
      >
        MINIMUM
      </span>
      <span
        className="font-body font-semibold tracking-[0.22em] text-coral"
        style={{ fontSize: size }}
      >
        STRESS
      </span>
    </div>
  );
}

/** Lora headline with the accent clause in sky italic. */
export function Headline({
  pre,
  accent,
  size = 26,
  light = false,
}: {
  pre: string;
  accent: string;
  size?: number;
  light?: boolean;
}) {
  return (
    <h2
      className={`font-display leading-[1.22] font-semibold ${light ? "text-white" : "text-navy"}`}
      style={{ fontSize: size }}
    >
      {pre} <em className={light ? "text-sky-soft italic" : "text-sky italic"}>{accent}</em>
    </h2>
  );
}
