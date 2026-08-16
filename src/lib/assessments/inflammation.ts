/**
 * Inflammation Score, carried over from the page it replaces.
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

export const inflammation: SectionedAssessment = {
  slug: "inflammation-score",

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
      "low"
    ],
    [
      50,
      "moderate"
    ],
    [
      25,
      "high"
    ],
    [
      0,
      "critical"
    ]
  ],
  sections: [
    {
      "key": "diet",
      "title": "What you eat is either fighting or fuelling inflammation",
      "sub": "The Dietary Inflammation Score (DIS) — validated across multiple large cohort studies — measures how pro- or anti-inflammatory your diet is. Ultra-processed foods, refined sugar, and seed oils elevate CRP and IL-6; vegetables, omega-3s, and polyphenols suppress them.",
      "questions": [
        {
          "text": "How would you describe your intake of vegetables, fruits, and whole plant foods?",
          "opts": [
            "High — 7+ servings daily, very diverse",
            "Moderate — 4–6 servings, some variety",
            "Low — 2–3 servings, limited variety",
            "Very low — I rarely eat vegetables or fruit"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        },
        {
          "text": "How often do you consume ultra-processed foods — packaged snacks, fast food, refined carbohydrates?",
          "opts": [
            "Rarely — I eat mostly whole foods",
            "Occasionally — a few times a week",
            "Often — most days include some processed food",
            "Daily and significantly — it's a large part of my diet"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        },
        {
          "text": "How would you describe your omega-3 intake — fatty fish, walnuts, flaxseed, quality oils?",
          "opts": [
            "High — I eat omega-3 rich foods regularly",
            "Moderate — a few times per week",
            "Low — occasionally",
            "Rarely or never — I don't prioritise these foods"
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
      "key": "symptoms",
      "title": "What inflammation looks like in your body",
      "sub": "Chronic low-grade inflammation produces a recognisable pattern of physical symptoms — joint pain, fatigue, skin reactions, and slow recovery. These are the body's visible output of elevated CRP, IL-6, and TNF-α — the primary inflammatory cytokines tracked in clinical research.",
      "questions": [
        {
          "text": "Do you experience joint stiffness, aching, or pain — particularly in the morning or after rest?",
          "opts": [
            "Rarely — my joints are generally comfortable",
            "Occasionally — mild and transient",
            "Often — it affects my daily movement",
            "Almost constantly — joint discomfort is my baseline"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        },
        {
          "text": "Do you experience persistent fatigue that sleep doesn't fully resolve?",
          "opts": [
            "Rarely — my energy is generally good",
            "Sometimes — certain periods are draining",
            "Often — I feel chronically tired despite adequate sleep",
            "Almost always — fatigue is my dominant experience"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        },
        {
          "text": "Do you experience skin conditions — eczema, psoriasis, acne, rosacea, or unexplained rashes?",
          "opts": [
            "Rarely — my skin is generally clear",
            "Occasionally — minor and manageable",
            "Often — recurring skin issues are a pattern",
            "Persistently — chronic skin conditions affect me daily"
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
      "key": "metabolic",
      "title": "The inflammation-metabolism connection",
      "sub": "Insulin resistance, abdominal adiposity, and blood sugar instability are both drivers and consequences of chronic inflammation. Elevated hs-CRP — the gold-standard inflammatory biomarker — is consistently linked with metabolic syndrome across large-scale clinical trials.",
      "questions": [
        {
          "text": "Do you carry excess weight around your abdomen — even if your overall weight seems normal?",
          "opts": [
            "No — my weight distribution feels balanced",
            "Minor abdominal fullness I notice",
            "Yes — I carry noticeable weight around my midsection",
            "Significantly — abdominal weight is persistent and resistant to change"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        },
        {
          "text": "Do you experience blood sugar fluctuations — energy crashes, intense hunger, shakiness between meals?",
          "opts": [
            "Rarely — my energy is stable between meals",
            "Occasionally — some afternoons are challenging",
            "Often — I need to eat frequently to avoid crashes",
            "Almost always — blood sugar instability is a daily pattern"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        },
        {
          "text": "Have you been told your blood pressure, cholesterol, or blood sugar levels are elevated?",
          "opts": [
            "No — all markers are in healthy ranges",
            "One marker is slightly elevated",
            "Two or more markers are elevated or borderline",
            "Multiple metabolic markers are significantly out of range"
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
      "title": "The habits that fan the inflammatory fire",
      "sub": "The Lifestyle Inflammation Score identifies smoking, alcohol, physical inactivity, and chronic stress as independent inflammatory drivers — each measurably elevating CRP and pro-inflammatory cytokines, independent of diet.",
      "questions": [
        {
          "text": "Do you smoke or use tobacco products?",
          "opts": [
            "Never — I have never smoked",
            "Former smoker — quit 5+ years ago",
            "Former smoker — quit in the last 5 years",
            "Current smoker"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        },
        {
          "text": "How would you describe your alcohol consumption?",
          "opts": [
            "Rarely or never",
            "Moderate — 1–7 drinks per week",
            "Regular — 8–14 drinks per week",
            "High — more than 14 drinks per week"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        },
        {
          "text": "How would you rate your physical activity level?",
          "opts": [
            "Active — I move most days with intention",
            "Moderately active — 2–4 sessions per week",
            "Lightly active — occasional movement",
            "Sedentary — largely inactive most days"
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
      "key": "recovery",
      "title": "Your body's capacity to resolve inflammation",
      "sub": "Inflammation is a normal, necessary process — the problem is when it fails to resolve. Sleep is when the body executes its anti-inflammatory protocols. Chronic stress suppresses resolution pathways. Your recovery capacity is a direct measure of your inflammatory resilience.",
      "questions": [
        {
          "text": "How is your sleep quality — do you wake feeling genuinely restored?",
          "opts": [
            "Good — I sleep well and wake restored",
            "Generally okay — some poor nights",
            "Often poor — I frequently wake tired",
            "Significantly disrupted — restorative sleep is rare"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        },
        {
          "text": "How would you describe your chronic stress load?",
          "opts": [
            "Low — I feel generally regulated and calm",
            "Moderate — manageable with some peaks",
            "High — chronic stress is a consistent presence",
            "Very high — I feel persistently overwhelmed"
          ],
          "scores": [
            3,
            2,
            1,
            0
          ]
        },
        {
          "text": "How quickly does your body recover from physical exertion, illness, or injury?",
          "opts": [
            "Quickly — I bounce back within a day or two",
            "Reasonably — takes a few days",
            "Slowly — recovery takes longer than expected",
            "Very slowly — I rarely feel I've fully recovered"
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
    "low": {
      "label": "Low Inflammation",
      "title": "Your inflammatory load appears low.",
      "desc": "Your lifestyle, diet, and recovery patterns are collectively anti-inflammatory. Low systemic inflammation is associated with lower risk of cardiovascular disease, metabolic syndrome, cancer, and neurodegenerative conditions. It also supports better mood, cognitive function, and physical recovery. The goal now is to protect what you've built and deepen the anti-inflammatory practices already working for you.",
      "insights": [
        "Low CRP and inflammatory cytokine levels are associated with longer healthspan and reduced all-cause mortality",
        "Your dietary pattern appears anti-inflammatory — diverse plants, omega-3s, and minimal processed food are the most powerful dietary modulators",
        "Adequate sleep and low stress are your two most powerful non-dietary anti-inflammatory tools",
        "Maintaining this profile long-term is associated with measurably slower biological aging"
      ]
    },
    "moderate": {
      "label": "Moderate Inflammation",
      "title": "Your inflammatory load is elevated — and addressable.",
      "desc": "Your assessment suggests moderate chronic low-grade inflammation across one or more dimensions. This is the most common inflammatory state in Western populations — often invisible until it manifests as fatigue, joint discomfort, skin issues, or metabolic changes. The good news: inflammation at this level is highly responsive to targeted lifestyle intervention. Small, consistent changes across diet, sleep, and stress regulation produce measurable reductions in inflammatory markers within 4–8 weeks.",
      "insights": [
        "Moderate elevation of CRP is associated with 2–3x increased cardiovascular risk — it is addressable through lifestyle alone at this stage",
        "Ultra-processed food and refined sugar are the most potent dietary drivers of CRP elevation — their reduction has the fastest measurable impact",
        "Omega-3 fatty acids have clinical trial evidence for reducing IL-6 and TNF-α — two of the primary inflammatory cytokines",
        "Chronic stress maintains a state of low-grade sympathetic activation that continuously signals for inflammatory cytokine release"
      ]
    },
    "high": {
      "label": "High Inflammation",
      "title": "Your body is carrying a significant inflammatory burden.",
      "desc": "Your assessment indicates chronically elevated systemic inflammation across multiple dimensions. At this level, inflammation is actively contributing to fatigue, joint and tissue damage, metabolic dysfunction, and accelerated cellular aging. Elevated CRP at this range is independently associated with significantly higher risk of cardiovascular events, type 2 diabetes, and cognitive decline. This level of inflammation requires a multi-modal approach — diet, movement, sleep, stress, and targeted supplementation working together.",
      "insights": [
        "High CRP elevation significantly increases cardiovascular risk even in the absence of traditional risk factors — per 2025 ACC guidelines",
        "Abdominal adiposity is both a driver and a consequence of inflammation — it creates a self-reinforcing cycle requiring targeted intervention",
        "The combination of poor sleep and chronic stress creates a cortisol-inflammation loop that dietary changes alone cannot fully resolve",
        "Anti-inflammatory nutrition combined with targeted adaptogenic and herbal support has the strongest evidence base at this inflammatory level"
      ]
    },
    "critical": {
      "label": "Severe Inflammatory Load",
      "title": "Your inflammatory load is severe and requires dedicated attention.",
      "desc": "Your assessment indicates severe chronic systemic inflammation across multiple dimensions — dietary, symptomatic, metabolic, and lifestyle. At this level, inflammation is driving a wide range of symptoms and creating compounding systemic damage. Chronic inflammation of this severity is directly linked to accelerated biological aging, immune dysregulation, and significantly elevated risk of multiple chronic diseases. A structured, professionally guided anti-inflammatory protocol is essential — and the research shows it works.",
      "insights": [
        "Severe systemic inflammation is associated with 4–5x increased risk of cardiovascular events — lifestyle intervention is the most effective first-line treatment",
        "Multiple co-occurring inflammatory drivers create a compounding burden that requires sequential, structured addressing",
        "Naturopathic and Ayurvedic frameworks have the most comprehensive evidence-informed protocols for multi-dimensional inflammation reduction",
        "The most dramatic anti-inflammatory results in clinical trials consistently come from comprehensive lifestyle overhauls, not single interventions"
      ]
    }
  },
};
