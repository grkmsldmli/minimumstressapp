import { describe, expect, it } from "vitest";

import { BRAND } from "./company";
import { type ResultEmail, looksLikeEmail, resultHtml, resultText } from "./result-email";

/**
 * The message somebody gets after asking for their result.
 *
 * Two things are being pinned here. One is that the whole result travels — the
 * band's own words, the bars, the focus — because the version before this sent
 * a score and a button, which is a receipt for something the reader had just
 * finished reading. The other is that a field cannot become markup: every one
 * of them started life as somebody's answer, and this renders into an inbox
 * where nobody will ever see the source.
 */

/**
 * A result with every part filled in.
 *
 * Typed as the literal rather than as `ResultEmail` so the optional fields
 * stay non-optional to the tests below — they are asserting that this exact
 * material comes out the other side, and `full.focus?.action` would quietly
 * assert nothing the day one of them stopped being passed.
 */
const full = {
  toolName: "Burnout Test",
  score: "37",
  band: "Burning",
  summary: "Moderate burnout risk. Your stress signals deserve attention now.",
  headline: "You are still functioning, but it may be costing more than it should.",
  story: "Your answers suggest the classic middle zone of burnout.",
  dimensions: [
    { label: "Body load", value: 72, focus: true },
    { label: "Life pressure", value: 40 },
  ],
  insights: ["Tension and low stamina may be part of your stress pattern."],
  focus: { label: "Physical Activity", action: "Gentle movement can help discharge activation." },
  steps: ["Remove one non-essential task.", "Create a 15-minute transition ritual."],
  related: [{ name: "Sleep Score", url: "https://minimumstress.com/tools/sleep-score" }],
  url: "https://minimumstress.com/tools/burnout-test",
} satisfies ResultEmail;

describe("the whole result travels", () => {
  const html = resultHtml(full);
  const text = resultText(full);

  it("carries the band's own words, not only the number", () => {
    for (const words of [full.headline, full.story, full.insights[0], full.focus.action]) {
      expect(html).toContain(words);
      expect(text).toContain(words);
    }
  });

  it("names the score's band beside it, never the number alone", () => {
    // These tools disagree on direction — 68 is a high cortisol load on one
    // page and a healthy gut on another — so a bare number is unreadable.
    const score = html.indexOf(full.score);
    expect(score).toBeGreaterThan(-1);
    expect(html.indexOf(full.band)).toBeGreaterThan(score);
  });

  it("marks the one dimension to start on", () => {
    expect(html).toContain("start here");
    expect(text).toContain("Body load: 72   <- start here");
  });

  it("numbers the steps in order", () => {
    expect(text).toContain("1. Remove one non-essential task.");
    expect(text).toContain("2. Create a 15-minute transition ritual.");
  });

  it("says what it is not", () => {
    expect(html).toContain("not medical advice");
    expect(html).toContain(`${BRAND} is not a medical provider`);
    expect(text).toContain("not a diagnosis");
  });
});

describe("the sections that are missing", () => {
  /*
   * A calculator has no bands and no dimensions. Rendering their headings
   * anyway leaves "What this means" sitting above nothing, which reads as a
   * broken email rather than a short one.
   */
  const bare = resultHtml({
    toolName: "BMI Calculator",
    score: "24.1",
    band: "Healthy range",
    summary: "Within the range the NHS uses.",
    url: "https://minimumstress.com/tools/bmi-calculator",
  });

  it("leaves out every heading it has nothing to put under", () => {
    for (const heading of ["Where it sits", "What this means", "Start here", "next seven days"]) {
      expect(bare).not.toContain(heading);
    }
  });

  it("still renders the score, the band and the disclaimer", () => {
    expect(bare).toContain("24.1");
    expect(bare).toContain("Healthy range");
    expect(bare).toContain("not medical advice");
  });

  it("treats an empty list as no list", () => {
    const empty = resultHtml({ ...full, insights: [], steps: [], dimensions: [] });
    expect(empty).not.toContain("What this means");
    expect(empty).not.toContain("Where it sits");
  });
});

describe("nothing becomes markup", () => {
  const nasty = "<script>alert(1)</script>";

  it("escapes every field, including the ones inside lists", () => {
    const html = resultHtml({
      ...full,
      toolName: nasty,
      band: nasty,
      summary: nasty,
      headline: nasty,
      story: nasty,
      dimensions: [{ label: nasty, value: 50 }],
      insights: [nasty],
      focus: { label: nasty, action: nasty },
      steps: [nasty],
      related: [{ name: nasty, url: nasty }],
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("cannot break out of an attribute", () => {
    const html = resultHtml({ ...full, url: '" onload="alert(1)' });
    expect(html).not.toContain('onload="');
  });

  /*
   * The bar is a table cell whose width is the score. An unclamped value puts
   * a cell at four thousand percent in somebody's inbox, which in Outlook
   * takes the surrounding table with it.
   */
  it("keeps a bar inside its own table", () => {
    const html = resultHtml({ ...full, dimensions: [{ label: "Sleep", value: 4000 }] });
    expect(html).toContain('width="100%"');
    expect(html).not.toContain('width="4000%"');
  });

  it("gives a zero score a visible bar rather than none", () => {
    const html = resultHtml({ ...full, dimensions: [{ label: "Sleep", value: 0 }] });
    expect(html).toContain('width="2%"');
  });
});

describe("looksLikeEmail", () => {
  it("passes an ordinary address", () => {
    expect(looksLikeEmail("someone@example.com")).toBe(true);
    expect(looksLikeEmail("  someone@example.co.uk ")).toBe(true);
  });

  it("catches the typos worth catching", () => {
    expect(looksLikeEmail("someone")).toBe(false);
    expect(looksLikeEmail("someone@")).toBe(false);
    expect(looksLikeEmail("someone@example")).toBe(false);
    expect(looksLikeEmail("some one@example.com")).toBe(false);
  });
});
