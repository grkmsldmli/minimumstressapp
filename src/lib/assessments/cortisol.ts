/**
 * Cortisol Assessment, carried over from the page it replaces.
 *
 * The five sections, their fifteen questions, the bands and every line of
 * their wording were extracted from the original script rather than retyped,
 * so nothing drifted in the move.
 *
 * The category cards each ended in an "Explore ..." button into
 * /collections/all-session. That catalogue closes with the store and the
 * button would land on a 410, so the links are gone and the words stay.
 */

import type { SectionedAssessment } from "../sectioned";

export const cortisol: SectionedAssessment = {
  slug: "cortisol-assessment",

  /**
   * Which way the number points.
   *
   * Higher means more load here — the direction the original used, kept. It is not the
   * same on all of these, which is why the page always prints a band name
   * next to the number rather than leaving a bare score to be guessed at.
   */
  higherIsBetter: false,

  thresholds: [
    [
      68,
      "dysregulated"
    ],
    [
      38,
      "elevated"
    ],
    [
      0,
      "balanced"
    ]
  ],
  sections: [
    {
      "key": "morning",
      "title": "Morning Activation",
      "sub": "How your body starts the day and responds to waking.",
      "questions": [
        {
          "text": "How do you usually feel within the first hour of waking?",
          "opts": [
            "Clear, steady, and alert",
            "Slow start but functional",
            "Heavy, foggy, or wired-tired",
            "Exhausted before the day begins"
          ],
          "scores": [
            0,
            1,
            2,
            3
          ]
        },
        {
          "text": "Do you rely on caffeine to feel normal in the morning?",
          "opts": [
            "Rarely or never",
            "A little, but not urgently",
            "Most mornings",
            "I cannot function without it"
          ],
          "scores": [
            0,
            1,
            2,
            3
          ]
        },
        {
          "text": "Do you wake with tension, pressure, or stress already present?",
          "opts": [
            "Rarely",
            "Sometimes",
            "Often",
            "Almost every day"
          ],
          "scores": [
            0,
            1,
            2,
            3
          ]
        }
      ]
    },
    {
      "key": "stress",
      "title": "Stress Reactivity",
      "sub": "How strongly your system reacts to daily pressure.",
      "questions": [
        {
          "text": "When something stressful happens, how quickly does your body activate?",
          "opts": [
            "I stay fairly regulated",
            "I notice some activation",
            "I react strongly",
            "My body goes into overdrive"
          ],
          "scores": [
            0,
            1,
            2,
            3
          ]
        },
        {
          "text": "How long does it take you to settle after stress?",
          "opts": [
            "A few minutes",
            "Less than an hour",
            "Several hours",
            "It carries into the rest of the day"
          ],
          "scores": [
            0,
            1,
            2,
            3
          ]
        },
        {
          "text": "Do you feel wired but tired?",
          "opts": [
            "Rarely",
            "Sometimes",
            "Often",
            "Almost constantly"
          ],
          "scores": [
            0,
            1,
            2,
            3
          ]
        }
      ]
    },
    {
      "key": "energy",
      "title": "Energy Rhythm",
      "sub": "How stable your energy feels across the day.",
      "questions": [
        {
          "text": "What happens to your energy in the afternoon?",
          "opts": [
            "Natural small dip only",
            "Noticeable dip",
            "Strong crash",
            "I depend on caffeine or sugar to continue"
          ],
          "scores": [
            0,
            1,
            2,
            3
          ]
        },
        {
          "text": "Do you get a second wind at night?",
          "opts": [
            "Rarely",
            "Sometimes",
            "Often",
            "Most nights"
          ],
          "scores": [
            0,
            1,
            2,
            3
          ]
        },
        {
          "text": "How consistent is your daily energy?",
          "opts": [
            "Stable",
            "Mostly stable",
            "Up and down",
            "Very unpredictable"
          ],
          "scores": [
            0,
            1,
            2,
            3
          ]
        }
      ]
    },
    {
      "key": "sleep",
      "title": "Sleep & Recovery",
      "sub": "How cortisol patterns may be affecting your night recovery.",
      "questions": [
        {
          "text": "Do you have trouble falling asleep because your mind or body stays active?",
          "opts": [
            "Rarely",
            "Sometimes",
            "Often",
            "Almost every night"
          ],
          "scores": [
            0,
            1,
            2,
            3
          ]
        },
        {
          "text": "Do you wake between 2–4am and struggle to return to sleep?",
          "opts": [
            "Rarely",
            "Sometimes",
            "Often",
            "Very frequently"
          ],
          "scores": [
            0,
            1,
            2,
            3
          ]
        },
        {
          "text": "Do you wake feeling restored?",
          "opts": [
            "Usually",
            "Somewhat",
            "Not really",
            "Almost never"
          ],
          "scores": [
            0,
            1,
            2,
            3
          ]
        }
      ]
    },
    {
      "key": "load",
      "title": "Lifestyle Load",
      "sub": "External inputs that can keep cortisol elevated or unstable.",
      "questions": [
        {
          "text": "How overloaded does your life currently feel?",
          "opts": [
            "Manageable",
            "Moderately full",
            "Very demanding",
            "Unrelenting"
          ],
          "scores": [
            0,
            1,
            2,
            3
          ]
        },
        {
          "text": "How often do you skip meals, eat late, or eat irregularly?",
          "opts": [
            "Rarely",
            "Sometimes",
            "Often",
            "Most days"
          ],
          "scores": [
            0,
            1,
            2,
            3
          ]
        },
        {
          "text": "How much screen/work stimulation do you have close to bedtime?",
          "opts": [
            "Minimal",
            "Some",
            "A lot",
            "It is part of my nightly routine"
          ],
          "scores": [
            0,
            1,
            2,
            3
          ]
        }
      ]
    }
  ],
  bands: {
    "balanced": {
      "label": "Balanced Cortisol Rhythm",
      "title": "Your cortisol pattern looks relatively regulated.",
      "desc": "Your stress system appears to be recovering reasonably well. You may still experience pressure, but your daily rhythm shows signs of resilience. The goal now is to protect your sleep, morning light exposure, movement, and recovery habits so your stress system stays flexible.",
      "insights": [
        "Your morning and evening rhythm may be supporting better recovery",
        "Your system likely has some capacity to return to baseline after stress",
        "Small consistency upgrades can protect this pattern long-term"
      ]
    },
    "elevated": {
      "label": "Elevated Cortisol Load",
      "title": "Your cortisol load appears elevated.",
      "desc": "Your body may be spending too much time in activation mode. This can show up as afternoon crashes, irritability, sleep disruption, tension, cravings, or feeling wired but tired. Your system does not need more pressure — it needs predictable recovery signals.",
      "insights": [
        "Your body may be staying activated longer than it should after stress",
        "Sleep, meal timing, and evening stimulation may be affecting your rhythm",
        "Nervous system practices can help your body return to baseline more easily"
      ]
    },
    "dysregulated": {
      "label": "Cortisol Dysregulation Pattern",
      "title": "Your stress rhythm may need a full reset.",
      "desc": "Your responses suggest disruption across multiple cortisol-related dimensions. This can happen when the body has been carrying pressure for too long. The path forward is not simply doing less — it is rebuilding rhythm, safety, nourishment, and recovery.",
      "insights": [
        "Your system may be alternating between overactivation and exhaustion",
        "Night waking, crashes, and wired-tired patterns can reflect rhythm disruption",
        "A multi-modal support plan is usually more effective than one isolated habit"
      ]
    }
  },
};
