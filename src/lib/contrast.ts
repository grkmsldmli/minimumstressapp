/**
 * Contrast, measured rather than judged.
 *
 * The palette came off a prototype where every colour was picked by eye on a
 * desktop monitor, and it did not survive being measured: the shade most of
 * the app's body text was written in sat at 3.87:1, and white on the primary
 * button — the one control on every screen somebody is meant to press — at
 * 2.98:1. Nothing caught it, because "does this look readable" is answered by
 * whoever is asking, on their screen, at their age, in their light.
 *
 * So it is arithmetic now, and the test beside this file walks the palette.
 */

/** WCAG AA for text under ~24px. */
export const AA_NORMAL = 4.5;

/**
 * WCAG AA for large text — 24px, or 18.66px when bold.
 *
 * A lower bar because thicker strokes carry colour better, not because large
 * text matters less.
 */
export const AA_LARGE = 3;

/** Relative luminance, per WCAG 2.1. */
export function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * The ratio between two colours, from 1 (identical) to 21 (black on white).
 *
 * Order does not matter — the lighter of the two goes on top either way, which
 * is why this can be asked about a pairing without knowing which is the text.
 */
export function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** The surfaces text is actually set on. A card is not white. */
export const SURFACES = {
  white: "#ffffff",
  surface: "#f4f8fc",
  surfaceBlue: "#edf6fe",
} as const;
