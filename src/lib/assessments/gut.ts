/**
 * Gut Health Score, carried over from the page it replaces.
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

export const gut: SectionedAssessment = {
  slug: "gut-health-score",

  /**
   * Which way the number points.
   *
   * Higher is better here — the direction the original used, kept. It is not the
   * same on all of these, which is why the page always prints a band name
   * next to the number rather than leaving a bare score to be guessed at.
   */
  higherIsBetter: true,

  thresholds: [
    [
      75,
      "thriving"
    ],
    [
      50,
      "moderate"
    ],
    [
      25,
      "compromised"
    ],
    [
      0,
      "critical"
    ]
  ],
  sections: [
    {
      "key": "digestion",
      "title": "Your digestion — day to day",
      "sub": "Digestive comfort, bowel regularity, bloating, reflux, and abdominal discomfort are direct indicators of gut ecosystem health.",
      "questions": [
        {
          "text": "How often do you experience bloating, gas, or abdominal distension?",
          "opts": [
            "Rarely — my digestion is generally comfortable",
            "Occasionally — after certain foods or stress",
            "Often — most days involve some discomfort",
            "Almost always — bloating is my baseline state"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        },
        {
          "text": "How would you describe your bowel regularity?",
          "opts": [
            "Very regular — once or twice daily, well-formed",
            "Mostly regular — minor variation",
            "Irregular — alternating between constipation and loose stools",
            "Consistently problematic — rarely comfortable"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        },
        {
          "text": "Do you experience acid reflux, heartburn, or a sensation of food not moving well?",
          "opts": [
            "Rarely",
            "Occasionally — a few times a month",
            "Often — weekly or more",
            "Almost daily — it significantly affects my comfort"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        }
      ]
    },
    {
      "key": "microbiome",
      "title": "Feeding your inner ecosystem",
      "sub": "Microbiome diversity is built through dietary variety, fermented foods, and fiber from diverse plant sources.",
      "questions": [
        {
          "text": "How many different plant foods do you eat in a typical week?",
          "opts": [
            "30+ varieties — I eat very diversely",
            "15–30 varieties — fairly varied",
            "5–15 varieties — limited variety",
            "Under 5 varieties — my diet is fairly repetitive"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        },
        {
          "text": "How regularly do you consume fermented foods — yogurt, kefir, kimchi, sauerkraut, miso?",
          "opts": [
            "Daily — fermented foods are a regular part of my diet",
            "A few times per week",
            "Occasionally — once a week or less",
            "Rarely or never"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        },
        {
          "text": "How would you describe your daily fiber intake?",
          "opts": [
            "High — lots of vegetables, legumes, whole grains, seeds",
            "Moderate — some fiber but room for improvement",
            "Low — my diet is fairly refined and low in plant foods",
            "Very low — I eat little to no fiber-rich food"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        }
      ]
    },
    {
      "key": "gutbrain",
      "title": "The connection between your gut and mind",
      "sub": "Stress, mood, food anxiety, and digestive symptoms can influence each other through the gut-brain axis.",
      "questions": [
        {
          "text": "Do your digestive symptoms worsen noticeably during periods of stress or anxiety?",
          "opts": [
            "Rarely — stress does not seem to affect my gut",
            "Sometimes — I notice a connection",
            "Often — stress reliably triggers gut symptoms",
            "Always — my gut is a direct mirror of my emotional state"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        },
        {
          "text": "How would you describe your mood and energy in relation to your gut health?",
          "opts": [
            "Generally good — I feel mentally clear and energized",
            "Okay — some fluctuations I cannot always explain",
            "Frequently foggy, low mood, or fatigued in ways that feel gut-related",
            "Significantly impacted — low mood and brain fog are persistent"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        },
        {
          "text": "Do you experience food anxiety — worry about how food will affect you, avoidance, or stress around eating?",
          "opts": [
            "Rarely — I eat without significant worry",
            "Sometimes — certain foods make me cautious",
            "Often — I have a list of foods I avoid due to gut reactions",
            "Significantly — eating creates consistent anxiety or avoidance"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        }
      ]
    },
    {
      "key": "inflammation",
      "title": "Signs of gut-driven inflammation",
      "sub": "Skin changes, joint discomfort, food sensitivities, and fatigue can sometimes reflect gut-related inflammatory load.",
      "questions": [
        {
          "text": "Do you experience skin issues — eczema, acne, rashes, or unexplained skin reactions?",
          "opts": [
            "Rarely — my skin is generally settled",
            "Occasionally — minor and manageable",
            "Often — skin issues are a recurring problem",
            "Persistently — chronic skin conditions are part of daily life"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        },
        {
          "text": "Have you developed new food sensitivities or intolerances in recent years?",
          "opts": [
            "No — I tolerate most foods well",
            "One or two foods I have become cautious with",
            "Several foods I now avoid or react to",
            "Many foods cause reactions — my tolerance has significantly narrowed"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        },
        {
          "text": "Do you experience joint stiffness, unexplained aches, or a general sense of physical inflammation?",
          "opts": [
            "Rarely — I feel physically comfortable",
            "Occasionally — minor stiffness or aches",
            "Often — it affects my daily movement and comfort",
            "Almost constantly — widespread discomfort is my baseline"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        }
      ]
    },
    {
      "key": "lifestyle",
      "title": "What shapes your microbiome daily",
      "sub": "Sleep, movement, stress, medication exposure, and daily rhythm all influence the gut ecosystem.",
      "questions": [
        {
          "text": "How often do you take antibiotics or medications that affect gut flora — NSAIDs, PPIs, antacids?",
          "opts": [
            "Rarely — less than once a year",
            "Occasionally — once or twice a year",
            "Regularly — several times a year",
            "Frequently — ongoing or chronic use"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        },
        {
          "text": "How well do you sleep — and do you feel your gut symptoms are connected to sleep quality?",
          "opts": [
            "Well — 7–9 hours, restorative, no clear gut connection",
            "Okay — some nights are poor but generally adequate",
            "Poorly — disrupted sleep and I notice gut symptoms correlate",
            "Significantly disrupted — gut discomfort and poor sleep reinforce each other"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        },
        {
          "text": "How would you describe your physical activity level?",
          "opts": [
            "Active — I move most days and it helps my digestion",
            "Moderately active — 2–4 times per week",
            "Lightly active — occasional movement",
            "Sedentary — I sit most of the day with minimal movement"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        }
      ]
    }
  ],
  bands: {
    "thriving": {
      "label": "Thriving Gut",
      "title": "Your gut ecosystem is in good health.",
      "desc": "Your gut is showing the hallmarks of a healthy, diverse microbiome — digestive comfort, resilience to stress, and lower inflammatory signals. The goal now is to keep building diversity and protect your gut from common modern disruptors.",
      "insights": [
        "Dietary diversity is one of the strongest foundations for gut health",
        "Fermented foods and fiber can help maintain microbial variety",
        "Low inflammation signals suggest your gut barrier may be functioning well",
        "A stable gut-brain axis can support mood, energy, and cognitive clarity"
      ]
    },
    "moderate": {
      "label": "Moderate Gut Health",
      "title": "Your gut is functional but showing strain.",
      "desc": "Your gut health appears moderate. Some symptoms may be early signals that your microbiome, digestion, or gut-brain axis is under pressure. Targeted changes in food variety, stress regulation, sleep, and movement can meaningfully support your gut profile.",
      "insights": [
        "Bloating and irregularity can reflect microbial or digestive imbalance",
        "Stress is often an underestimated driver of gut symptoms",
        "Increasing plant variety can support microbiome diversity",
        "Consistent routines can help digestion become more predictable"
      ]
    },
    "compromised": {
      "label": "Compromised Gut",
      "title": "Your gut is significantly under pressure.",
      "desc": "Your assessment suggests gut strain across multiple dimensions. Digestive discomfort, food sensitivity, inflammation signals, or lifestyle load may be combining into a pattern that needs more structured support.",
      "insights": [
        "Multiple food sensitivities can reflect reduced gut tolerance",
        "Skin, joint, and brain fog symptoms can sometimes connect with gut stress",
        "Stress regulation is central to gut restoration",
        "Traditional and holistic support can help rebuild structure and rhythm"
      ]
    },
    "critical": {
      "label": "Gut in Crisis",
      "title": "Your gut needs dedicated attention.",
      "desc": "Your responses suggest a severely stressed gut ecosystem. Persistent digestive symptoms, food intolerance, inflammation signals, and lifestyle stressors may require a more consistent, guided restoration plan.",
      "insights": [
        "Chronic gut disruption can affect energy, mood, inflammation, and immune balance",
        "A structured food and lifestyle reset may be more effective than random changes",
        "Professional support can help identify triggers and rebuild tolerance",
        "A multi-modal plan usually works better than focusing on one habit alone"
      ]
    }
  },
};
