/**
 * Biological Age Calculator, carried over from the page it replaces.
 *
 * Seven dimensions, their questions, the per-dimension wording and the year
 * deltas were extracted from the original script rather than retyped. The
 * model is theirs: each dimension scores between its own minimum and maximum,
 * that score maps onto a range of years, and the years are added to the age
 * somebody gives.
 *
 * The "Explore ..." buttons into /collections/all-session are gone — that
 * catalogue closes with the store and they would land on a 410.
 */

export type BioDimension = "sleep" | "movement" | "nutrition" | "stress" | "substances" | "social" | "recovery";

/** Each dimension's own maximum, and how many years it can move the answer. */
export const BIO_DELTAS: { key: BioDimension; max: number; min: number; maxDelta: number }[] = [
    {
      "key": "sleep",
      "max": 8,
      "min": -3,
      "maxDelta": 3
    },
    {
      "key": "movement",
      "max": 9,
      "min": -4,
      "maxDelta": 4
    },
    {
      "key": "nutrition",
      "max": 10,
      "min": -3,
      "maxDelta": 3
    },
    {
      "key": "stress",
      "max": 9,
      "min": -4,
      "maxDelta": 4
    },
    {
      "key": "substances",
      "max": 4,
      "min": -5,
      "maxDelta": 2
    },
    {
      "key": "social",
      "max": 4,
      "min": -2,
      "maxDelta": 2
    },
    {
      "key": "recovery",
      "max": 8,
      "min": -3,
      "maxDelta": 3
    }
  ];

export interface BioQuestion {
  text: string;
  opts: string[];
  /** Points per option. Positive is protective, negative is strain. Theirs. */
  scores: number[];
  dim: BioDimension;
}

export interface BioSection {
  key: BioDimension;
  title: string;
  sub: string;
  questions: { text: string; opts: string[]; scores: number[] }[];
}

export const BIO_SECTIONS: BioSection[] = [
    {
      "key": "sleep",
      "title": "Sleep & circadian rhythm",
      "sub": "Sleep is when your body repairs, clears waste, regulates hormones, and rebuilds energy. Disrupted sleep often shows up as accelerated aging pressure.",
      "questions": [
        {
          "text": "How many hours do you typically sleep per night?",
          "opts": [
            "8–9 hours — I protect my sleep",
            "7–8 hours — generally adequate",
            "6–7 hours — often not enough",
            "Under 6 hours — chronically sleep-deprived"
          ],
          "scores": [
            3,
            2,
            0,
            -2
          ]
        },
        {
          "text": "How restorative is your sleep — do you wake feeling genuinely recovered?",
          "opts": [
            "Yes — I feel restored most mornings",
            "Mostly — occasional poor nights",
            "Rarely — I wake tired more often than not",
            "Almost never — sleep does not restore me"
          ],
          "scores": [
            3,
            1,
            -1,
            -3
          ]
        },
        {
          "text": "How consistent is your sleep schedule?",
          "opts": [
            "Very consistent — within 30 minutes daily",
            "Mostly consistent — minor variation",
            "Inconsistent — shifts by 1–2 hours",
            "No rhythm — completely irregular"
          ],
          "scores": [
            2,
            1,
            -1,
            -2
          ]
        }
      ]
    },
    {
      "key": "movement",
      "title": "Physical activity & strength",
      "sub": "Movement supports mitochondrial health, muscle mass, insulin sensitivity, circulation, mood, and long-term resilience.",
      "questions": [
        {
          "text": "How often do you engage in moderate-to-vigorous physical activity?",
          "opts": [
            "5+ times per week — consistent and varied",
            "3–4 times per week — regular",
            "1–2 times per week — occasional",
            "Rarely or never — largely sedentary"
          ],
          "scores": [
            4,
            2,
            0,
            -3
          ]
        },
        {
          "text": "Do you include strength or resistance training in your routine?",
          "opts": [
            "Yes — 2+ times per week",
            "Occasionally — once a week or less",
            "Rarely",
            "No — I do not do strength training"
          ],
          "scores": [
            3,
            1,
            -1,
            -2
          ]
        },
        {
          "text": "How much of your day is spent sitting or inactive?",
          "opts": [
            "Under 4 hours — I move regularly",
            "4–6 hours — moderate sitting",
            "6–9 hours — mostly sedentary",
            "9+ hours — almost entirely sedentary"
          ],
          "scores": [
            2,
            1,
            -1,
            -3
          ]
        }
      ]
    },
    {
      "key": "nutrition",
      "title": "Diet & metabolic health",
      "sub": "Food quality influences inflammation, blood sugar, gut function, oxidative stress, and the body’s ability to repair.",
      "questions": [
        {
          "text": "How would you describe your overall diet quality?",
          "opts": [
            "Whole foods, plants, minimal processing — consistently",
            "Generally healthy with some processed food",
            "Mixed — some healthy meals, a lot of convenience food",
            "Predominantly processed, high sugar, low vegetables"
          ],
          "scores": [
            4,
            2,
            -1,
            -3
          ]
        },
        {
          "text": "How often do you eat vegetables or fruits?",
          "opts": [
            "With every meal — 5+ servings daily",
            "Most days — 3–4 servings",
            "Occasionally — 1–2 servings",
            "Rarely — not a regular part of my diet"
          ],
          "scores": [
            3,
            1,
            -1,
            -2
          ]
        },
        {
          "text": "How would you describe your sugar and ultra-processed food intake?",
          "opts": [
            "Minimal — I actively avoid it",
            "Moderate — mostly limited",
            "Frequent — most days include processed food",
            "High — it is a significant part of my diet"
          ],
          "scores": [
            3,
            1,
            -1,
            -3
          ]
        }
      ]
    },
    {
      "key": "stress",
      "title": "Stress & nervous system",
      "sub": "Chronic stress can keep the body in survival mode, making sleep, digestion, immunity, mood, and recovery harder.",
      "questions": [
        {
          "text": "How would you describe your average daily stress level?",
          "opts": [
            "Low — I feel generally calm and in control",
            "Moderate — manageable with occasional high periods",
            "High — stress is a consistent presence",
            "Very high — I am chronically overwhelmed"
          ],
          "scores": [
            3,
            1,
            -2,
            -4
          ]
        },
        {
          "text": "Do you have regular practices that actively reduce stress?",
          "opts": [
            "Yes — daily practice, deliberate and consistent",
            "Occasionally — when I remember or need it",
            "Rarely — I mostly push through",
            "No — I have no regular stress management practice"
          ],
          "scores": [
            3,
            1,
            -1,
            -2
          ]
        },
        {
          "text": "How do you feel emotionally on a typical week?",
          "opts": [
            "Grounded and resilient — I recover well",
            "Generally okay with difficult periods",
            "Often anxious, irritable, or flat",
            "Consistently overwhelmed, numb, or depleted"
          ],
          "scores": [
            3,
            1,
            -2,
            -3
          ]
        }
      ]
    },
    {
      "key": "substances",
      "title": "Smoking & alcohol",
      "sub": "Tobacco and high alcohol exposure create oxidative stress, liver burden, inflammation, and faster biological wear.",
      "questions": [
        {
          "text": "Do you smoke or use tobacco products?",
          "opts": [
            "Never — I have never smoked",
            "Former smoker — quit 5+ years ago",
            "Former smoker — quit within last 5 years",
            "Current smoker"
          ],
          "scores": [
            2,
            1,
            -1,
            -5
          ]
        },
        {
          "text": "How would you describe your alcohol consumption?",
          "opts": [
            "Rarely or never — less than once a week",
            "Moderate — 1–7 drinks per week",
            "Regular — 8–14 drinks per week",
            "High — more than 14 drinks per week"
          ],
          "scores": [
            2,
            1,
            -1,
            -3
          ]
        }
      ]
    },
    {
      "key": "social",
      "title": "Social connection & purpose",
      "sub": "Connection and purpose influence stress biology, emotional recovery, behavior consistency, and long-term wellbeing.",
      "questions": [
        {
          "text": "How connected do you feel to people around you?",
          "opts": [
            "Deeply connected — strong, meaningful relationships",
            "Generally connected — good relationships",
            "Somewhat isolated — limited deep connection",
            "Significantly isolated — I feel largely alone"
          ],
          "scores": [
            2,
            1,
            -1,
            -2
          ]
        },
        {
          "text": "Do you feel a sense of purpose — that your life has meaning and direction?",
          "opts": [
            "Strongly — I wake up knowing why I am here",
            "Generally yes — most days feel meaningful",
            "Inconsistently — I struggle to find meaning",
            "Rarely or never — I feel directionless"
          ],
          "scores": [
            2,
            1,
            -1,
            -2
          ]
        }
      ]
    },
    {
      "key": "recovery",
      "title": "Recovery & inflammation",
      "sub": "Recovery capacity reflects how well your body repairs between stressors. Low recovery often points to inflammation, nervous-system load, or poor repair rhythm.",
      "questions": [
        {
          "text": "How quickly do you recover from illness, exertion, or stressful periods?",
          "opts": [
            "Quickly — I bounce back within a day or two",
            "Reasonably — takes a few days",
            "Slowly — I feel depleted for extended periods",
            "Very slowly — I rarely feel fully recovered"
          ],
          "scores": [
            3,
            1,
            -1,
            -3
          ]
        },
        {
          "text": "Do you experience chronic symptoms — frequent illness, gut issues, inflammation?",
          "opts": [
            "Rarely — my body feels generally well",
            "Occasionally — minor issues here and there",
            "Often — I have recurring physical symptoms",
            "Frequently — chronic symptoms are part of daily life"
          ],
          "scores": [
            2,
            1,
            -1,
            -3
          ]
        },
        {
          "text": "How would you rate your overall physical energy and vitality?",
          "opts": [
            "High — I feel vital and energised most days",
            "Good — reasonable energy with natural fluctuations",
            "Low — I often feel fatigued or depleted",
            "Very low — energy is a persistent problem"
          ],
          "scores": [
            3,
            1,
            -1,
            -3
          ]
        }
      ]
    }
  ];

export const BIO_COPY: Record<BioDimension, {
  name: string;
  short: string;
  strong: string;
  mid: string;
  weak: string;
  science: string;
  action: string;
}> = {
    "sleep": {
      "name": "Sleep & Circadian Rhythm",
      "short": "Sleep",
      "strong": "Your sleep rhythm is protecting your biological age.",
      "mid": "Your sleep is usable, but not yet deeply restorative.",
      "weak": "Your sleep pattern is one of the clearest aging accelerators in your profile.",
      "science": "Sleep supports growth hormone release, brain clearance, immune regulation, glucose control, and overnight cellular repair.",
      "action": "Start with a consistent wake time, morning daylight, lower evening light, and a 30–45 minute wind-down routine before bed."
    },
    "movement": {
      "name": "Movement & Strength",
      "short": "Movement",
      "strong": "Your movement habits are acting like a longevity signal.",
      "mid": "Your body is getting some movement input, but not enough to fully protect metabolic and muscular aging.",
      "weak": "Low movement or low strength training is likely pushing your biological age upward.",
      "science": "Movement improves insulin sensitivity, mitochondrial density, muscle mass, blood pressure, mood, and inflammatory signaling.",
      "action": "Build toward 150 minutes of weekly movement plus 2 strength sessions. Short walks after meals are a powerful starting point."
    },
    "nutrition": {
      "name": "Nutrition & Metabolic Health",
      "short": "Nutrition",
      "strong": "Your nutrition pattern is helping control inflammation and metabolic aging.",
      "mid": "Your nutrition is mixed — some protective inputs, but also room for more consistency.",
      "weak": "Your diet pattern may be increasing inflammatory load and metabolic strain.",
      "science": "Food quality affects blood sugar, lipid metabolism, gut microbiome diversity, oxidative stress, and chronic low-grade inflammation.",
      "action": "Prioritize protein, fiber, colorful plants, hydration, and fewer ultra-processed foods before making complicated diet changes."
    },
    "stress": {
      "name": "Stress & Nervous System",
      "short": "Stress",
      "strong": "Your nervous system appears relatively regulated and resilient.",
      "mid": "Your stress system is carrying some load, but it may still be recoverable with better regulation practices.",
      "weak": "Chronic stress is one of the strongest aging signals in your result.",
      "science": "Long-term stress can increase cortisol load, inflammation, sleep disruption, blood pressure, and immune wear.",
      "action": "Use breathwork, meditation, coaching, slower transitions, and daily decompression windows to train down the stress response."
    },
    "substances": {
      "name": "Smoking & Alcohol",
      "short": "Substances",
      "strong": "Your substance profile is not adding major aging pressure.",
      "mid": "Your alcohol or tobacco exposure may be adding mild biological stress.",
      "weak": "Smoking or high alcohol intake is a major biological age accelerator.",
      "science": "Tobacco and high alcohol exposure increase oxidative stress, DNA damage, liver strain, inflammation, and cardiovascular risk.",
      "action": "Reducing exposure is one of the fastest ways to improve long-term biological risk. Start with frequency reduction and support if needed."
    },
    "social": {
      "name": "Connection & Purpose",
      "short": "Connection",
      "strong": "Your sense of connection and purpose is a protective longevity factor.",
      "mid": "Your connection score is moderate — enough support exists, but it may not be deeply replenishing.",
      "weak": "Isolation or low purpose may be quietly aging your nervous and immune systems.",
      "science": "Connection and purpose affect stress biology, immune function, inflammation, health behavior consistency, and emotional recovery.",
      "action": "Schedule meaningful contact, join group sessions, reconnect with supportive people, and choose one weekly activity that gives direction."
    },
    "recovery": {
      "name": "Recovery & Inflammation",
      "short": "Recovery",
      "strong": "Your recovery capacity suggests your body still repairs well between stressors.",
      "mid": "Your recovery is uneven — your body may repair, but not always quickly or completely.",
      "weak": "Low recovery and recurring symptoms suggest a higher inflammatory or repair burden.",
      "science": "Recovery reflects autonomic balance, immune load, gut health, inflammation, sleep quality, and mitochondrial efficiency.",
      "action": "Focus on sleep, hydration, anti-inflammatory meals, gentle movement, gut support, and reducing repeated stress spikes."
    }
  };
