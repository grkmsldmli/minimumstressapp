"use client";

/**
 * The Minimum Stress waiting sign: two very small navy paws gently "making
 * biscuits". Not a logo — a quiet, brand-specific loading micro-interaction.
 *
 * Kept deliberately small and calm: no spinning, bouncing, gradients, or sound.
 * The kneading (a left/right alternating press) lives in globals.css so it can
 * be disabled under prefers-reduced-motion in one place; `animate={false}`
 * renders the paws static, which is what the pull-to-refresh gesture wants while
 * the finger is still dragging (they only knead once a refresh is under way).
 */

/** One paw, drawn small and clean in the current text colour. */
function PawGlyph({ px }: { px: number }) {
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      {/* Four toe beans — the two inner ones sit higher, like a real paw. */}
      <ellipse cx="6.2" cy="10.6" rx="2.5" ry="3.1" />
      <ellipse cx="10.4" cy="6.3" rx="2.7" ry="3.4" />
      <ellipse cx="15" cy="6.3" rx="2.7" ry="3.4" />
      <ellipse cx="18.7" cy="11" rx="2.4" ry="3" />
      {/* The main pad. */}
      <path d="M12.4 12.1c-3 0-5.4 2.3-6 5-.5 2.4 1.2 4 3.5 4.5 1.7.3 3.4.3 5 0 2.3-.5 4-2.1 3.5-4.5-.6-2.7-3-5-6-5Z" />
    </svg>
  );
}

function PawCell({
  px,
  right,
  animate,
  inline,
}: {
  px: number;
  right: boolean;
  animate: boolean;
  /** Inside a button the ground shadow adds height and reads as clutter, so it
   *  is dropped — leaving the paw's own line to match the button text exactly. */
  inline: boolean;
}) {
  const side = right ? "--right" : "";
  return (
    <span className="relative inline-flex flex-col items-center" style={{ width: px }}>
      <span
        className={animate ? `paw-knead paw-knead${side}` : ""}
        style={{ lineHeight: 0, opacity: animate ? undefined : 0.8 }}
      >
        <PawGlyph px={px} />
      </span>
      {/* A very subtle ground shadow that widens as the paw presses. */}
      {!inline && (
        <span
          className={animate ? `paw-knead-shadow paw-knead-shadow${side}` : ""}
          style={{
            width: px * 0.7,
            height: Math.max(2, Math.round(px * 0.14)),
            marginTop: Math.round(px * 0.12),
            borderRadius: 9999,
            background: "var(--color-navy)",
            opacity: animate ? undefined : 0.14,
          }}
        />
      )}
    </span>
  );
}

export function PawLoader({
  size = 14,
  gap = 5,
  label,
  animate = true,
  inline = false,
  className = "",
}: {
  /** Per-paw px. ~13–14 on mobile keeps the pair ~30–34px wide. */
  size?: number;
  /** Space between the two paws, px. */
  gap?: number;
  /** Optional line beside/under the paws — this is what a screen reader announces. */
  label?: string;
  /** Kneading on (a refresh in flight) or static (still being pulled). */
  animate?: boolean;
  /**
   * Row rather than column: paws and label on one line, the label inheriting
   * the surrounding font size and colour. Used inside a button so swapping the
   * label in for text does not change the button's height.
   */
  inline?: boolean;
  className?: string;
}) {
  const paws = (
    <span
      className={`${inline ? "inline-flex align-middle" : "flex"} items-end`}
      style={{ gap, color: "var(--color-navy)" }}
      aria-hidden="true"
    >
      <PawCell px={size} right={false} animate={animate} inline={inline} />
      <PawCell px={size} right animate={animate} inline={inline} />
    </span>
  );

  // Inline: a plain text-flow span so it sits on the host's own line (a button's
  // text line), swapping in for label text without changing the line's height.
  if (inline) {
    return (
      <span role="status" aria-live="polite" className={className}>
        {paws}
        {label ? (
          <span className="font-body font-medium ml-2">{label}</span>
        ) : (
          <span className="sr-only">Loading</span>
        )}
      </span>
    );
  }

  // Block: paws stacked over the label, centred — the standalone waiting sign.
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center ${className}`}
    >
      {paws}
      {label ? (
        <span className="font-body font-normal text-[13.5px] mt-2 text-ink-soft">{label}</span>
      ) : (
        <span className="sr-only">Loading</span>
      )}
    </div>
  );
}
