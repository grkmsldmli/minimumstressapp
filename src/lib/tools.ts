/**
 * The tools, as they exist on the site being moved.
 *
 * Eleven of them, under the slugs and names they already have. An earlier
 * version of this file merged them down to six and renamed two, which was not
 * a call to make on somebody else's behalf: the names are indexed, they are
 * what people have linked to, and the questions behind them were written by
 * the person whose site this is.
 *
 * Keeping the slugs also means most of these need no redirect at all — the
 * address a reader has works because it is still the address.
 */

export type ToolKind = "assessment" | "calculator";

export interface Tool {
  /** The Shopify page slug, kept. */
  slug: string;
  name: string;
  /** One line, on the card. */
  blurb: string;
  kind: ToolKind;
  /** Roughly how long it takes, as somebody would say it out loud. */
  minutes: string;
  /**
   * Whether the page behind it exists yet.
   *
   * The hub lists live tools only. A card that opens a 404 costs more trust
   * than a shorter list costs interest.
   */
  live: boolean;
}

export const TOOLS: Tool[] = [
  {
    slug: "burnout-test",
    name: "Burnout Test",
    blurb: "Ten questions from a rotating pool, and where you sit between recovering and burnt out.",
    kind: "assessment",
    minutes: "2 minutes",
    live: true,
  },
  {
    slug: "nervous-system-assessment",
    name: "Nervous System Assessment",
    blurb: "Whether your system is regulated or reactive, across three dimensions.",
    kind: "assessment",
    minutes: "3 minutes",
    live: false,
  },
  {
    slug: "sleep-score",
    name: "Sleep Score",
    blurb:
      "Whether your sleep is restoring you, across five dimensions — not just how many hours.",
    kind: "assessment",
    minutes: "3 minutes",
    live: true,
  },
  {
    slug: "cortisol-assessment",
    name: "Cortisol Assessment",
    blurb:
      "Your stress pattern across five dimensions, from morning activation to lifestyle load.",
    kind: "assessment",
    minutes: "4 minutes",
    live: true,
  },
  {
    slug: "stress-recovery-assessment",
    name: "Stress Recovery Assessment",
    blurb: "How well you come back down after pressure, and what is getting in the way.",
    kind: "assessment",
    minutes: "4 minutes",
    live: false,
  },
  {
    slug: "gut-health-score",
    name: "Gut Health Score",
    blurb:
      "Digestion, microbiome diversity, the gut-brain axis, inflammation signals and daily habits.",
    kind: "assessment",
    minutes: "4 minutes",
    live: true,
  },
  {
    slug: "inflammation-score",
    name: "Inflammation Score",
    blurb: "Your inflammatory load across diet, symptoms, metabolism, lifestyle and recovery.",
    kind: "assessment",
    minutes: "4 minutes",
    live: true,
  },
  {
    slug: "biological-age-calculator",
    name: "Biological Age Calculator",
    blurb: "What your habits add up to in years, across a seven-dimension longevity model.",
    kind: "assessment",
    minutes: "5 minutes",
    live: false,
  },
  {
    slug: "bmi-calculator",
    name: "BMI Calculator",
    blurb: "Your BMI, and an honest account of what the number can and cannot tell you.",
    kind: "calculator",
    minutes: "Instant",
    live: true,
  },
  {
    slug: "body-fat-calculator",
    name: "Body Fat Calculator",
    blurb: "Body fat percentage, lean mass and fat mass from tape measurements.",
    kind: "calculator",
    minutes: "Instant",
    live: false,
  },
  {
    slug: "tdee-calculator",
    name: "TDEE Calculator",
    blurb: "Your total daily energy expenditure, and the macros that follow from your goal.",
    kind: "calculator",
    minutes: "Instant",
    live: false,
  },
];

/** The ones with a page behind them, which is all the hub ever lists. */
export function liveToolsOfKind(kind: ToolKind): Tool[] {
  return TOOLS.filter((tool) => tool.kind === kind && tool.live);
}

export function toolBySlug(slug: string): Tool | undefined {
  return TOOLS.find((tool) => tool.slug === slug);
}
