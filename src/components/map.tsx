"use client";

import type { CategoryKey } from "@/lib/taxonomy";

import { CatIcon, categoryGradient } from "./brand";

/**
 * Illustrated stand-in for the real map. Deliberately abstract: a listing's
 * street address is private until a practitioner has booked, so nothing here
 * should ever resolve to a recognisable location.
 */
export function MapBackdrop() {
  return (
    <svg
      className="absolute inset-0 w-full h-full"
      viewBox="0 0 300 400"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <rect width="300" height="400" fill="#F1F6FB" />
      <path d="M300,0 C230,20 260,120 300,150 Z" fill="#DCEAF7" />
      <ellipse cx="60" cy="330" rx="90" ry="60" fill="#E4EEE1" />
      <ellipse cx="230" cy="90" rx="60" ry="42" fill="#E9F0E5" />
      <g stroke="#DDE4EC" strokeWidth="2">
        <path d="M0,60 L300,90" />
        <path d="M0,150 L300,120" />
        <path d="M0,230 L300,260" />
        <path d="M0,320 L300,300" />
        <path d="M40,0 L70,400" />
        <path d="M150,0 L130,400" />
        <path d="M240,0 L260,400" />
      </g>
    </svg>
  );
}

export function PinMarker({
  x,
  y,
  cat,
  active = false,
  index = 0,
  onClick,
  label,
}: {
  x: number;
  y: number;
  cat: CategoryKey;
  active?: boolean;
  index?: number;
  onClick?: () => void;
  label?: string;
}) {
  const [from, to] = categoryGradient(cat);
  const size = active ? 40 : 32;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className="absolute pin-drop press"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        transform: "translate(-50%,-100%)",
        animationDelay: `${index * 70}ms`,
        zIndex: active ? 20 : 10,
      }}
    >
      <div
        className="pin-shape"
        style={{ width: size, height: size, background: `linear-gradient(135deg, ${from}, ${to})` }}
      >
        <div className="pin-icon">
          <CatIcon cat={cat} size={active ? 15 : 12} color="#fff" />
        </div>
      </div>
    </button>
  );
}

/** A plain location pin, for the host dropping a marker on their own space. */
export function DroppedPin({ x, y }: { x: number; y: number }) {
  return (
    <div
      className="absolute pin-drop"
      style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%,-100%)" }}
      aria-hidden="true"
    >
      <div
        className="pin-shape"
        style={{ width: 34, height: 34, background: "linear-gradient(135deg, #3B9BE8, #16304E)" }}
      >
        <div className="pin-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
        </div>
      </div>
    </div>
  );
}

export function YouDot({ x = 50, y = 90 }: { x?: number; y?: number }) {
  return (
    <div
      className="absolute"
      style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%,-50%)" }}
      aria-hidden="true"
    >
      <div className="you-dot" />
      <div className="you-ring" />
    </div>
  );
}
