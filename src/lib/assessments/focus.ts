import type { SectionedAssessment, SectionedResult } from "../sectioned";
import type { BurnoutCategory } from "./burnout-data";
import type { SleepDimension } from "./sleep-data";

/**
 * The one thing to start on, per dimension.
 *
 * Every assessment here already finds where somebody is thinnest — the bars on
 * the result page make it obvious at a glance — and then says nothing about
 * it. The reader is left holding five numbers and the job of working out which
 * one to care about, which is the job the tool was supposed to do.
 *
 * Biological Age is the exception: its original carried an action per
 * dimension, and that copy lives with its data. The rest had none, so this
 * file is new writing rather than anything extracted, and it is kept apart
 * from the extracted files for exactly that reason — so nobody later reads it
 * as part of the material that came over from the pages being replaced.
 *
 * Two rules held throughout. Each action is one behaviour, not a programme:
 * a result naming five things to fix is a result nobody acts on. And none of
 * them treat anything — they are the ordinary levers a person already has over
 * their own week, which is the whole of what a set of questions can speak to.
 */

/**
 * A short name for the bar, because the section titles are sentences.
 *
 * The originals wrote them as headings — "What you eat is either fighting or
 * fuelling inflammation" — which reads well above three questions and badly
 * beside a number.
 */
export interface Focus {
  label: string;
  action: string;
}

/** Keyed `slug:sectionKey`, so the three assessments cannot collide. */
export const SECTION_FOCUS: Record<string, Focus> = {
  "cortisol-assessment:morning": {
    label: "Morning activation",
    action:
      "Get daylight on your face within half an hour of waking, before the first screen. It is the strongest signal your body has for where the day starts, and it costs ten minutes standing outside with a coffee.",
  },
  "cortisol-assessment:stress": {
    label: "Stress reactivity",
    action:
      "Pick the moment in your day when you notice yourself bracing — the inbox at 9am, the school run, the walk into a meeting — and give it three slow breaths with a longer exhale before you start. Not to stop the reaction, but to stop it setting the tone for the next hour.",
  },
  "cortisol-assessment:energy": {
    label: "Energy rhythm",
    action:
      "Eat something with protein in the first two hours of being awake. A morning that starts on caffeine alone tends to spend the afternoon paying for it, and the crash is usually read as tiredness when it is timing.",
  },
  "cortisol-assessment:sleep": {
    label: "Sleep and recovery",
    action:
      "Set a finish time rather than a bedtime. The hour before sleep is what decides how the night goes, and it is much easier to protect an hour that ends work than one that begins rest.",
  },
  "cortisol-assessment:load": {
    label: "Lifestyle load",
    action:
      "Take one thing off this week rather than adding a practice to it. The load is the input; nothing you add on top of a full week works as well as the smallest thing you can stop doing.",
  },

  "gut-health-score:digestion": {
    label: "Day-to-day digestion",
    action:
      "Slow the first ten minutes of one meal a day — sitting down, no screen, actually chewing. It is the least interesting advice in this field and the one with the shortest gap between doing it and noticing it.",
  },
  "gut-health-score:microbiome": {
    label: "Variety on the plate",
    action:
      "Add two plants you do not normally eat this week — a different bean, a herb, a bag of frozen greens. Variety does more here than any single food, and the easiest place to find it is the one you keep walking past.",
  },
  "gut-health-score:gutbrain": {
    label: "Gut and mind",
    action:
      "Notice which meals you eat while working. Eating under pressure is a different physiological state from eating at rest, and moving one meal a day out of it is a change to how you digest, not only to how you feel.",
  },
  "gut-health-score:inflammation": {
    label: "Inflammatory signals",
    action:
      "Keep a rough note for a fortnight of when the symptoms show up rather than what you ate. Patterns in timing — after late meals, after a bad week, after alcohol — are usually clearer than patterns in ingredients, and far less work to see.",
  },
  "gut-health-score:lifestyle": {
    label: "Daily rhythm",
    action:
      "Walk for ten minutes after your largest meal. It is the single habit in this section that touches digestion, blood sugar and stress at once, and it needs no equipment and no decision.",
  },

  "inflammation-score:diet": {
    label: "What you eat",
    action:
      "Replace one ultra-processed thing you eat on autopilot — the mid-afternoon snack, the drink with lunch — rather than reforming the whole diet. The item you eat without deciding to is the one worth changing first, because it repeats.",
  },
  "inflammation-score:symptoms": {
    label: "What you are feeling",
    action:
      "Write down the three that bother you most and when they started. Symptoms that have been building for months are worth a doctor's time, and a list is what makes that appointment useful rather than vague.",
  },
  "inflammation-score:metabolic": {
    label: "Metabolic load",
    action:
      "Move for ten minutes after eating rather than adding a workout to your week. Post-meal movement is where the effect on blood sugar is largest, and it is the version of exercise that survives a busy month.",
  },
  "inflammation-score:lifestyle": {
    label: "Daily habits",
    action:
      "Choose the one input you would least like to look at — the drinking, the sitting, the hours — and change its edges rather than the whole thing. Two fewer nights, one flight of stairs, a hard stop at seven.",
  },
  "inflammation-score:recovery": {
    label: "Recovery capacity",
    action:
      "Protect sleep before anything else on this list. Resolution happens at night; a week of short sleep undoes most of what the other four sections are for, and no amount of the rest compensates for it.",
  },
};

/**
 * Sleep, per dimension.
 *
 * The original scored five and named none of them, which left the reader with
 * "Getting to sleep: 34" and no sense of what to do about a 34.
 */
export const SLEEP_FOCUS: Record<SleepDimension, Focus> = {
  A: {
    label: "Getting to sleep",
    action:
      "Give the hour before bed the same shape every night — lights down, work closed, the phone somewhere that is not the bedroom. Falling asleep responds to what happened in that hour far more than to anything you do once you are already lying there.",
  },
  C: {
    label: "Circadian rhythm",
    action:
      "Fix the wake-up rather than the bedtime, including at weekends, and get outside soon after it. A rhythm that has drifted is corrected from the morning end; the evening follows on its own within about a week.",
  },
  Q: {
    label: "Sleep quality",
    action:
      "Change the room before the routine. Cooler than feels right, dark enough that you cannot see your hand, and nothing in it that lights up — quality tends to come from the conditions rather than from trying harder to sleep well.",
  },
  R: {
    label: "Recovery",
    action:
      "Put a real gap between the day ending and sleep starting — twenty minutes doing something that is not a screen and not a task. Going straight from work to bed asks the body to switch states with no notice, and it mostly does not.",
  },
  D: {
    label: "Disruptors",
    action:
      "Take the input closest to bedtime — the last coffee, the nightcap, the late meal, the scroll — and move it two hours earlier for a week. One at a time, so you find out which one was actually costing you the night.",
  },
};

/**
 * Burnout, per category — replacing a referral that no longer has anything
 * behind it.
 *
 * The original's four categories were a directory: each one ended by naming
 * the kind of consultant to book, and the copy read "Coaching can help you
 * sort what is yours to carry." There are no consultants and no sessions any
 * more, so that paragraph was an advert for something a reader cannot buy —
 * which is worse than no advice, because it takes the place of some.
 *
 * The categories themselves are worth keeping: they are what the answers
 * pointed at, and the reading of them is the useful part. Only the referral at
 * the end of each is replaced, with something the reader can do this week
 * without anybody's help.
 */
export const BURNOUT_FOCUS: Record<BurnoutCategory, Focus> = {
  physical: {
    label: "Body load",
    action:
      "Move in a way that does not count as training. A walk without headphones, ten minutes of stretching, one flight of stairs taken slowly — the point is to discharge what your body is holding rather than to add another thing you are failing to keep up.",
  },
  traditional: {
    label: "System rhythm",
    action:
      "Pick one anchor and hold it for a fortnight: the same wake-up time, or one proper meal a day eaten sitting down. Depletion at this level responds to rhythm long before it responds to effort, and rhythm needs one fixed point rather than a new routine.",
  },
  social: {
    label: "Life pressure",
    action:
      "Name the one commitment you would drop if you were allowed to, and drop it — or say out loud to somebody what has actually been hard. Both are the same move: taking something off, rather than carrying it better.",
  },
  spiritual: {
    label: "Inner disconnection",
    action:
      "Put twenty minutes a week into something with no outcome attached to it. Not restorative in the productive sense — genuinely pointless, and yours. This is usually the first thing to go and the last thing anybody schedules back in.",
  },
};

/**
 * The dimension to start on, which is not always the lowest number.
 *
 * These assessments do not agree on direction: cortisol and inflammation count
 * upward toward trouble, gut health counts upward toward good. Picking "the
 * smallest" would send somebody with a high cortisol load to work on their
 * strongest area.
 */
export function weakestSection(
  assessment: SectionedAssessment,
  result: SectionedResult,
): string | null {
  const keys = assessment.sections
    .map((section) => section.key)
    .filter((key) => result.sections[key] !== undefined);
  if (keys.length === 0) return null;

  return keys.reduce((worst, key) => {
    const here = result.sections[key];
    const best = result.sections[worst];
    return assessment.higherIsBetter ? (here < best ? key : worst) : here > best ? key : worst;
  });
}

/** Sleep runs one way only: higher is better, so the thinnest is the lowest. */
export function weakestSleep(dimensions: Record<SleepDimension, number>): SleepDimension {
  const keys = Object.keys(dimensions) as SleepDimension[];
  return keys.reduce((worst, key) => (dimensions[key] < dimensions[worst] ? key : worst));
}

/** The section's short name, falling back to its own title where none is set. */
export function sectionLabel(slug: string, sectionKey: string, fallback: string): string {
  return SECTION_FOCUS[`${slug}:${sectionKey}`]?.label ?? fallback;
}
