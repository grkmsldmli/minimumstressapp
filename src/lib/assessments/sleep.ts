import type { Assessment } from "../assessment";

/**
 * Sleep Score.
 *
 * The Shopify version held a seventy-question pool, drew twelve at random, and
 * sorted people into "Deep Restorer", "Light Sleeper", "Exhausted Cyclist" and
 * "Sleep Dysregulated" through a chain of if-statements whose last branch
 * caught everything that had not matched a specific pattern. Score 65 without
 * matching one and you were told your sleep system "needs a full reset" — the
 * tool getting it wrong about the one thing it exists to measure.
 *
 * Twelve fixed questions, four dimensions, the shared scale.
 */

export type SleepDimension = "onset" | "through" | "restore" | "rhythm";

export const sleep: Assessment<SleepDimension> = {
  dimensions: {
    onset: {
      label: "Getting to sleep",
      meaning: "How long it takes, and what is happening while you wait.",
    },
    through: {
      label: "Staying asleep",
      meaning: "Whether the night holds together once it has started.",
    },
    restore: {
      label: "Waking up",
      meaning: "Whether the hours you spent asleep gave anything back.",
    },
    rhythm: {
      label: "Rhythm",
      meaning: "How steady your timing is, which the rest tends to follow.",
    },
  },

  questions: [
    {
      id: "onset-speed",
      dimension: "onset",
      text: "How long does falling asleep take?",
      options: [
        "Fifteen or twenty minutes",
        "About half an hour",
        "Often an hour or more",
        "I lie there, sometimes for hours",
      ],
    },
    {
      id: "onset-mind",
      dimension: "onset",
      text: "What is your mind doing while you wait?",
      options: [
        "Winding down on its own",
        "Going over the day for a while",
        "Racing, more often than not",
        "Tomorrow starts the moment I lie down",
      ],
    },
    {
      id: "onset-body",
      dimension: "onset",
      text: "And your body, when you get into bed?",
      options: [
        "It lets go fairly quickly",
        "Tense at first, then it settles",
        "Tight most nights",
        "I carry the whole day into bed with me",
      ],
    },
    {
      id: "through-waking",
      dimension: "through",
      text: "Do you wake in the night?",
      options: [
        "Rarely",
        "Once, and I go back off",
        "A few times, and it takes effort",
        "Most nights, often for a long time",
      ],
    },
    {
      id: "through-early",
      dimension: "through",
      text: "Do you wake earlier than you meant to and stay awake?",
      options: ["Rarely", "Occasionally", "Often", "Almost every morning"],
    },
    {
      id: "through-length",
      dimension: "through",
      text: "On an ordinary night, how long do you actually sleep?",
      options: ["Seven to nine hours", "About seven", "Around six", "Under six, most nights"],
    },
    {
      id: "restore-morning",
      dimension: "restore",
      text: "How do you feel in the first hour up?",
      options: [
        "Clear enough to start",
        "Slow, but it lifts",
        "Foggy for most of the morning",
        "As tired as when I went to bed",
      ],
    },
    {
      id: "restore-afternoon",
      dimension: "restore",
      text: "What happens to you in the afternoon?",
      options: [
        "A small dip, nothing more",
        "Noticeably tired, but fine",
        "A real slump, most days",
        "I need caffeine or sugar to keep going",
      ],
    },
    {
      id: "restore-catchup",
      dimension: "restore",
      text: "After one good night, do you feel caught up?",
      options: [
        "Yes — one good night does it",
        "Mostly",
        "Not really; it takes several",
        "I never feel caught up",
      ],
    },
    {
      id: "rhythm-timing",
      dimension: "rhythm",
      text: "How close together are your bedtimes across the week?",
      options: [
        "Within about half an hour",
        "Within an hour",
        "They move by a couple of hours",
        "There is no pattern",
      ],
    },
    {
      id: "rhythm-weekend",
      dimension: "rhythm",
      text: "And at the weekend?",
      options: [
        "Much the same",
        "An hour later, maybe",
        "Considerably later, and I sleep in",
        "The weekend is a different timetable entirely",
      ],
    },
    {
      id: "rhythm-light",
      dimension: "rhythm",
      text: "Do you get daylight in the first hour or two of your day?",
      options: [
        "Most days — I get outside",
        "Sometimes",
        "Rarely",
        "Almost never; I go from bed to indoors",
      ],
    },
  ],

  band: {
    steady: {
      label: "Sleeping well",
      body: "Your answers describe sleep that is doing its job. It is the foundation most other things sit on, and far easier to protect than to rebuild.",
    },
    carrying: {
      label: "Good enough, mostly",
      body: "You are getting sleep, but not reliably the restoring kind. This is the common middle, and usually one part of the night is the problem rather than all of it.",
    },
    low: {
      label: "Not restoring",
      body: "Your answers point to sleep that is happening without giving much back. That shows up in patience and energy long before anybody calls it a sleep problem.",
    },
    depleted: {
      label: "Badly disrupted",
      body: "This reads like sleep that has been going wrong for a while. Persistent insomnia is treatable and worth taking to a doctor — it responds to the right help far better than to trying harder.",
    },
  },

  firstStep: {
    onset:
      "Put a fixed half hour between the last screen and the pillow, doing something dull. Falling asleep is not a decision, and the run-up is the only part of it you control.",
    through:
      "Look at the last three hours before bed. Alcohol and a late heavy meal both let you fall asleep easily and then break the night in half.",
    restore:
      "Hold your wake time steady for two weeks, including after a bad night. Chasing lost sleep by sleeping in is usually what keeps the next night bad.",
    rhythm:
      "Same wake time daily, and daylight within an hour of it. Timing is the lever that moves the other three, and the cheapest one to pull.",
  },
};
