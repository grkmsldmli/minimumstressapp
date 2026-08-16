/**
 * The free tools, and which ones survived.
 *
 * The Shopify site carried twelve. Four of them — a burnout test, a cortisol
 * assessment, a nervous-system assessment and a stress-recovery assessment —
 * asked the same person the same questions about the same week and returned
 * four differently-worded versions of one answer. Two more, gut and
 * inflammation, overlapped almost as heavily. Twelve tests is not a library;
 * it reads as a content farm, and it is six more things to keep correct.
 *
 * So: six. Three that measure something with arithmetic, three that score what
 * somebody tells us about their own week.
 *
 * Two were also renamed. "Cortisol Assessment" and "Biological Age" both name
 * a measurement neither one takes — one is a questionnaire, the other is a
 * lifestyle estimate — and the FTC treats the impression an advert leaves as a
 * claim to be substantiated, whether or not the words are there. The tools are
 * unchanged; they now say what they actually do.
 */

export type ToolKind = "assessment" | "calculator";

export interface Tool {
  slug: string;
  name: string;
  /** One line, on the card. Says what the person gets, not how it works. */
  blurb: string;
  kind: ToolKind;
  /** Roughly how long it takes, as somebody would say it out loud. */
  minutes: string;
  /** Which of the old Shopify pages fold into this one, for the redirects. */
  replaces: string[];
  /**
   * Whether the page behind it exists yet.
   *
   * The hub shows live tools only. A card that opens a 404 costs more trust
   * than a shorter list costs interest, and "coming soon" on six cards reads
   * as a site that is not finished — which it would be.
   */
  live: boolean;
}

export const TOOLS: Tool[] = [
  {
    slug: "stress-load",
    name: "Stress Load Check",
    blurb:
      "Where the pressure is actually landing — sleep, body, mood, or the hours themselves — and what to change first.",
    kind: "assessment",
    minutes: "4 minutes",
    replaces: [
      "burnout-test",
      "cortisol-assessment",
      "nervous-system-assessment",
      "stress-recovery-assessment",
    ],
    live: true,
  },
  {
    slug: "sleep-score",
    name: "Sleep Score",
    blurb: "Whether your sleep is restoring you, across five dimensions — not just how many hours.",
    kind: "assessment",
    minutes: "3 minutes",
    replaces: ["sleep-score"],
    live: false,
  },
  {
    slug: "lifestyle-age",
    name: "Lifestyle Age Estimate",
    blurb:
      "What your daily habits add up to, expressed in years — sleep, movement, food, recovery, and connection.",
    kind: "assessment",
    minutes: "5 minutes",
    replaces: ["biological-age-calculator", "gut-health-score", "inflammation-score"],
    live: false,
  },
  {
    slug: "bmi",
    name: "BMI Calculator",
    blurb: "Your BMI, and an honest account of what the number can and cannot tell you.",
    kind: "calculator",
    minutes: "Instant",
    replaces: ["bmi-calculator"],
    live: true,
  },
  {
    slug: "body-fat",
    name: "Body Fat Estimate",
    blurb: "Lean mass and fat mass from tape measurements, which BMI cannot separate.",
    kind: "calculator",
    minutes: "Instant",
    replaces: ["body-fat-calculator"],
    live: false,
  },
  {
    slug: "energy-needs",
    name: "Daily Energy Needs",
    blurb: "How much your body uses in a day, from the Mifflin-St Jeor equation.",
    kind: "calculator",
    minutes: "Instant",
    replaces: ["tdee-calculator"],
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

/**
 * Where an old Shopify tool URL should land.
 *
 * Every one of the twelve keeps working. Four of them now arrive at the same
 * place, which is the point — somebody who bookmarked the burnout test is not
 * sent to a 404 because we merged it.
 */
export function toolForLegacyPage(page: string): Tool | undefined {
  return TOOLS.find((tool) => tool.replaces.includes(page));
}
