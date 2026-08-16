/**
 * The Stress Load Check, and the four tests it replaces.
 *
 * Shopify carried a burnout test, a cortisol assessment, a nervous-system
 * assessment and a stress-recovery assessment. Between them they asked about a
 * hundred questions, and read closely they asked four wordings of the same
 * eight: how you sleep, what your body is doing, what your head is doing, and
 * how much is being asked of you. So that is the shape here — four dimensions,
 * three questions each, twelve in total.
 *
 * Scores run the same direction as every other tool on the site: higher is
 * better. The old set did not agree with itself — a high "Infla Score" meant
 * low inflammation while a high "Cortisol Load Score" meant trouble — so
 * somebody who took two came away with contradictory instincts about what a
 * big number meant.
 *
 * Nothing here is a diagnosis and the wording never pretends otherwise. It
 * scores what somebody says about their own week and points at the thinnest of
 * the four, which is a useful thing to know and the limit of what twelve
 * questions can honestly do.
 */

import type { Assessment, Question } from "./assessment";

export type StressDimension = "sleep" | "body" | "mind" | "load";

const dimensions: Record<StressDimension, { label: string; meaning: string }> = {
  sleep: {
    label: "Sleep",
    meaning: "Whether the night is repairing what the day costs.",
  },
  body: {
    label: "Body",
    meaning: "Where the week is showing up physically — tension, energy, appetite.",
  },
  mind: {
    label: "Mind",
    meaning: "Patience, focus, and whether you can put the day down.",
  },
  load: {
    label: "Load",
    meaning: "How much is being asked, and how much say you have in it.",
  },
};

const questions: Question<StressDimension>[] = [
  {
    id: "sleep-onset",
    dimension: "sleep",
    text: "When you get into bed, what happens?",
    options: [
      "I drift off within about twenty minutes",
      "It takes half an hour, but it happens",
      "It often takes an hour or more",
      "My mind starts up the moment my head lands",
    ],
  },
  {
    id: "sleep-through",
    dimension: "sleep",
    text: "Do you sleep through the night?",
    options: [
      "Usually, yes",
      "I wake once and settle again",
      "I wake a few times and it takes effort",
      "Broken sleep is normal for me now",
    ],
  },
  {
    id: "sleep-restored",
    dimension: "sleep",
    text: "How do you feel in the first hour after waking?",
    options: [
      "Clear, and ready",
      "Slow to start, but fine",
      "Heavy, and it takes most of the morning",
      "Already tired before anything has happened",
    ],
  },
  {
    id: "body-tension",
    dimension: "body",
    text: "Where does the week sit in your body?",
    options: [
      "I do not really notice it physically",
      "Some tension in the shoulders or jaw",
      "Regular headaches, tightness, or stomach trouble",
      "My whole body feels braced most of the time",
    ],
  },
  {
    id: "body-energy",
    dimension: "body",
    text: "What happens to your energy by mid-afternoon?",
    options: [
      "It holds",
      "A dip, but I carry on",
      "A real crash — I need coffee or sugar",
      "There is nothing left by then",
    ],
  },
  {
    id: "body-recovery",
    dimension: "body",
    text: "After a hard week, how long does it take to feel yourself again?",
    options: [
      "A good night, and I am back",
      "A couple of days",
      "Longer than it should — I stay depleted",
      "I cannot remember the last time I felt recovered",
    ],
  },
  {
    id: "mind-patience",
    dimension: "mind",
    text: "Something small goes wrong. What happens?",
    options: [
      "I deal with it",
      "A flash of irritation, then it passes",
      "It gets to me more than it deserves",
      "It feels like the last straw, most days",
    ],
  },
  {
    id: "mind-switch-off",
    dimension: "mind",
    text: "When the work stops, how long until you actually stop?",
    options: [
      "Quickly — I put it down",
      "Half an hour or so",
      "Hours, if at all",
      "I never really switch off",
    ],
  },
  {
    id: "mind-flat",
    dimension: "mind",
    text: "Do things you used to enjoy still land?",
    options: [
      "Yes, mostly",
      "Some do, some do not",
      "Rarely — it all feels a bit flat",
      "I am going through the motions",
    ],
  },
  {
    id: "load-hours",
    dimension: "load",
    text: "When did you last take a full day with no work in it?",
    options: [
      "In the last week or two",
      "Within the last month",
      "Months ago",
      "I genuinely cannot remember",
    ],
  },
  {
    id: "load-boundaries",
    dimension: "load",
    text: "Can you turn down something extra without dreading it?",
    options: [
      "Yes, without much thought",
      "Sometimes, with a bit of guilt",
      "Rarely — I usually say yes",
      "No. Saying no does not feel like an option",
    ],
  },
  {
    id: "load-control",
    dimension: "load",
    text: "How much say do you have over how your day goes?",
    options: [
      "A good amount",
      "Some, within limits",
      "Very little",
      "None — I am reacting from the moment I wake",
    ],
  },
];

/**
 * What each band is told.
 *
 * Deliberately level. The tests this replaces reached for "your body is under
 * significant physiological load" and "your nervous system is stuck in
 * survival mode" off the back of ten multiple-choice answers. Frightening
 * somebody is not the same as informing them, and a questionnaire has not
 * earned that tone.
 */
export const stressLoad: Assessment<StressDimension> = {
  dimensions,
  questions,

  band: {
    steady: {
      label: "Holding up",
      body: "Your answers describe a week you are getting through with something left over. That is worth protecting — most of what goes wrong here goes wrong slowly, and it is easier to keep a good pattern than to rebuild one.",
    },
    carrying: {
      label: "Carrying it",
      body: "You are managing, but it is costing more than it should. This is the ordinary middle: nothing has broken, and the margin has gone. Usually one thing is doing most of the damage rather than everything at once.",
    },
    low: {
      label: "Running low",
      body: "Your answers point to a stretch that has gone on long enough to show. Sleep, patience, and energy tend to go together, and pulling one back up often takes some weight off the others.",
    },
    depleted: {
      label: "Running on empty",
      body: "This reads like a load carried well past the point it should have been put down. That is not a character failing and it is not fixed by trying harder. If this has been the shape of things for a while, it is worth saying out loud to a doctor or someone who can help.",
    },
  },

  firstStep: {
    sleep:
      "Pick a wake time and keep it, including at the weekend, and get daylight in the first hour. Sleep is the one that pulls the others up with it, and a fixed wake time moves it faster than a fixed bedtime.",
    body:
      "Give your body twenty minutes a day of something unhurried — a walk, stretching, anything that is not exercise you have to win at. Tension leaves through movement more reliably than through rest.",
    mind:
      "Put a fixed gap between finishing and everything else: a walk home, a shower, ten minutes on a step outside. The mind does not switch off on command, but it will follow a routine.",
    load:
      "Find one thing this week to take off the list rather than reschedule. Nothing else on this page works while the load itself keeps growing.",
  },
};
