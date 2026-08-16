/**
 * The engine behind the sectioned assessments.
 *
 * Cortisol, gut health and inflammation were three copies of the same page —
 * five sections of three questions, a percentage, a band, and a paragraph. The
 * copies had already drifted: one scores upward, two score downward, and each
 * carried its own slightly different rendering of the same bar.
 *
 * The direction is kept per assessment because it is theirs, and it is exactly
 * why every result here prints a band name beside the number. A bare 68 means
 * "your cortisol load is high" on one page and "your gut is doing well" on
 * another, and nobody should have to remember which.
 */

export interface SectionQuestion {
  text: string;
  opts: string[];
  /** Points per option, in order. Their arrays, unchanged. */
  scores: number[];
}

export interface Section {
  key: string;
  title: string;
  sub: string;
  questions: SectionQuestion[];
}

export interface Band {
  label: string;
  title: string;
  desc: string;
  insights: string[];
}

export interface SectionedAssessment {
  slug: string;
  /** True where a big number is good news. Not the same on all of them. */
  higherIsBetter: boolean;
  /** `[minimum, band]`, highest first. */
  thresholds: [number, string][];
  sections: Section[];
  bands: Record<string, Band>;
}

/** Answers keyed `sectionKey:questionIndex`, as the option index chosen. */
export type SectionAnswers = Record<string, number>;

export interface SectionedResult {
  /** 0–100, in whichever direction this assessment runs. */
  overall: number;
  band: string;
  /** Per section, same direction. */
  sections: Record<string, number>;
}

export function answerKey(sectionKey: string, index: number): string {
  return `${sectionKey}:${index}`;
}

export function isComplete(
  assessment: SectionedAssessment,
  answers: SectionAnswers,
): boolean {
  return assessment.sections.every((section) =>
    section.questions.every((_, index) => answers[answerKey(section.key, index)] !== undefined),
  );
}

export function bandFor(assessment: SectionedAssessment, overall: number): string {
  for (const [minimum, band] of assessment.thresholds) {
    if (overall >= minimum) return band;
  }
  // The thresholds end at zero, so this is unreachable — but a band name that
  // does not exist renders an empty result panel, and returning the last one
  // is a better failure than a blank page.
  return assessment.thresholds[assessment.thresholds.length - 1][1];
}

export function scoreSectioned(
  assessment: SectionedAssessment,
  answers: SectionAnswers,
): SectionedResult {
  const sections: Record<string, number> = {};
  let total = 0;
  let counted = 0;

  for (const section of assessment.sections) {
    let points = 0;
    let answered = 0;
    let max = 0;

    section.questions.forEach((question, index) => {
      const chosen = answers[answerKey(section.key, index)];
      if (chosen === undefined) return;
      points += question.scores[chosen];
      answered += 1;
      // Read off the question rather than assumed to be three: the arrays are
      // theirs and nothing guarantees every one runs 0–3.
      max += Math.max(...question.scores);
    });

    sections[section.key] = max > 0 ? Math.round((points / max) * 100) : 0;
    total += points;
    counted += max;
    void answered;
  }

  const overall = counted > 0 ? Math.round((total / counted) * 100) : 0;
  return { overall, band: bandFor(assessment, overall), sections };
}
