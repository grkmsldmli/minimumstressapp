/**
 * The colours and sizes the content site is built from.
 *
 * These were hex codes scattered across a dozen files, and the scattering hid
 * a real fault: the grey used for most of the secondary text on the site,
 * #8a94a3, sits at 3.07:1 on white. WCAG AA asks for 4.5:1 on body text. The
 * sky blue used for every link was worse, at 2.77:1. Both looked fine to
 * somebody with good eyes on a good screen and were genuinely hard to read for
 * everybody else — which is not a matter of taste, and is not something a
 * reviewer can catch by looking, because looking is exactly what it defeats.
 *
 * So the palette lives here with its contrast measured, and site-theme.test.ts
 * fails the build if a colour used for text drops below the threshold. Adding
 * a paler grey is now a thing somebody has to do on purpose.
 *
 * Numbers in the comments are contrast against white, computed in the test
 * rather than typed from memory.
 */

export const COLOUR = {
  /** Headings. 13.5:1 — as strong as this palette gets. */
  ink: "#0F2F55",
  /** Body text. 10.6:1, replacing a grey that sat at 5.8. */
  body: "#33404F",
  /** Secondary text: captions, hints, the line under a heading. 7.4:1. */
  muted: "#4A5765",
  /**
   * Links and anything else that is text and wants to be blue. 6.6:1.
   *
   * Not `accent` below, which is the brand sky and fails badly as text. The
   * distinction is the whole point of having two: one is for filling a shape,
   * the other is for words.
   */
  link: "#0A6390",
  /**
   * The brand sky. For fills, rules, icons and large display type only —
   * 2.8:1, which is fine behind white text and unreadable as text on white.
   */
  accent: "#0EA5E9",
  /** Pale sky, for a heading or an accent on the navy ground. 8.1:1 against it. */
  onDark: "#7DD3FC",
  /**
   * The two greys that work on navy, measured the same way as the light ones.
   *
   * The footer moved onto the dark ground and reaching for rgba(255,255,255,…)
   * is how a dark surface ends up with text at 3:1 — an alpha is a guess, and
   * the number it produces depends on what is behind it. These are opaque and
   * checked: 9.1 and 7.1 against #0F2F55.
   */
  onDarkBody: "#C7D6E6",
  onDarkMuted: "#A9BED3",

  /** Grounds. */
  page: "#ffffff",
  wash: "#F4F8FC",
  dark: "#0F2F55",
  line: "#DDE7F1",
} as const;

/**
 * A type scale with actual range.
 *
 * The page it replaces ran from 13.5px to 32px and spent most of its time
 * between 14 and 17, which reads as one long undifferentiated column — nothing
 * on it was large enough to be a landmark or small enough to recede. Body text
 * starts at 17px here rather than 15: on a marketing page read at arm's length
 * that is the single biggest readability gain available, and it costs nothing.
 */
export const TYPE = {
  hero: "text-[44px] leading-[1.04] sm:text-[62px]",
  h2: "text-[30px] leading-[1.12] sm:text-[38px]",
  h3: "text-[19px] leading-[1.3]",
  lead: "text-[18px] leading-[1.65] sm:text-[19px]",
  body: "text-[17px] leading-[1.75]",
  small: "text-[15px] leading-[1.7]",
  eyebrow: "text-[12px] uppercase tracking-[0.16em] font-medium",
} as const;
