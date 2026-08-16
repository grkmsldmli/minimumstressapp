/**
 * Sleep Score, carried over from the page it replaces.
 *
 * The question pool, the five dimensions and every line of the band wording
 * were extracted from the original script rather than retyped.
 *
 * Each option carries points across five dimensions at once rather than
 * belonging to one — a question about screens before bed scores Disruptors,
 * a question about bedtimes scores Circadian — which is why the answers are
 * objects rather than numbers.
 *
 * The "Explore ..." buttons into /collections/all-session are gone: that
 * catalogue closes with the store and they would land on a 410. The words
 * stay.
 */

/** A: onset · C: circadian · Q: quality · R: recovery · D: disruptors. */
export type SleepDimension = "A" | "C" | "Q" | "R" | "D";

export const SLEEP_DIMENSIONS: Record<SleepDimension, string> = {
  A: "Getting to sleep",
  C: "Circadian rhythm",
  Q: "Sleep quality",
  R: "Recovery",
  D: "Disruptors",
};

export interface SleepQuestion {
  q: string;
  opts: string[];
  /** Points per option, across all five dimensions. */
  scores: Record<SleepDimension, number>[];
}

/** Twelve are drawn from these, which is how the original worked. */
export const SLEEP_POOL: SleepQuestion[] = [
    {
      "q": "What does falling asleep feel like for you?",
      "opts": [
        "I drift off naturally within 15–20 minutes",
        "Takes about 30 minutes — manageable",
        "Often takes over an hour",
        "I lie there for hours — it's a battle"
      ],
      "scores": [
        {
          "A": 3,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 2,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 1,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "What time do you naturally want to go to sleep — if there were no obligations?",
      "opts": [
        "10pm–midnight — I have a consistent window",
        "It varies by an hour or two",
        "It shifts significantly depending on the week",
        "I have no consistent pattern at all"
      ],
      "scores": [
        {
          "A": 0,
          "C": 3,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 2,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 1,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "When you wake up in the morning, what's the quality of that first moment?",
      "opts": [
        "Alert and relatively clear",
        "Groggy but functional within 20 minutes",
        "Heavily groggy — takes an hour or more",
        "Exhausted before the day has begun"
      ],
      "scores": [
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 3,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 2,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 1,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Do you wake during the night?",
      "opts": [
        "Rarely — I sleep through",
        "Once or twice but fall back easily",
        "Multiple times and it takes effort to resettle",
        "Frequently — broken sleep is my norm"
      ],
      "scores": [
        {
          "A": 0,
          "C": 0,
          "Q": 3,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 2,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 1,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Does your mind race when you're trying to sleep?",
      "opts": [
        "Rarely — my mind winds down naturally",
        "Sometimes — especially after busy days",
        "Often — my thoughts won't stop",
        "Almost always — bedtime is when my mind goes into overdrive"
      ],
      "scores": [
        {
          "A": 3,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 2,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 1,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "What does your energy look like by 3–4pm?",
      "opts": [
        "Still functional — natural dip but manageable",
        "Noticeably tired — I push through",
        "Significant slump — I really struggle",
        "Running on stimulants or willpower by this point"
      ],
      "scores": [
        {
          "A": 0,
          "C": 3,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 2,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 1,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "How consistent is your bedtime across the week?",
      "opts": [
        "Within 30 minutes of the same time",
        "Varies by about an hour",
        "Varies significantly — 2+ hours difference",
        "Completely inconsistent — weekends shift everything"
      ],
      "scores": [
        {
          "A": 0,
          "C": 3,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 2,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 1,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Do you feel physically restored after a full night's sleep?",
      "opts": [
        "Yes — I feel like my body has repaired itself",
        "Mostly — better than the night before",
        "Somewhat — okay but not truly restored",
        "Rarely — I wake feeling like I didn't sleep"
      ],
      "scores": [
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 3,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 2,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 1,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Do you use screens in the hour before sleep?",
      "opts": [
        "Rarely — I have a wind-down routine",
        "Sometimes — I try to stop but don't always",
        "Most nights",
        "Every night — it's part of how I fall asleep"
      ],
      "scores": [
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 3
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 2
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 1
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Do you consume caffeine after 2pm?",
      "opts": [
        "Never — I'm strict about this",
        "Occasionally",
        "Often",
        "Daily — it's how I function in the afternoon"
      ],
      "scores": [
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 3
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 2
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 1
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Do you dream — and do you remember your dreams?",
      "opts": [
        "Yes — I dream vividly and regularly",
        "Sometimes — fragments here and there",
        "Rarely",
        "Never — I have no sense of dreaming at all"
      ],
      "scores": [
        {
          "A": 0,
          "C": 0,
          "Q": 3,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 2,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 1,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "How do you feel emotionally after a poor night's sleep?",
      "opts": [
        "Mild irritability — manageable",
        "Noticeably more reactive or flat",
        "Significantly affected — my whole mood shifts",
        "Completely destabilised — poor sleep ruins my day"
      ],
      "scores": [
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 3,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 2,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 1,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Do you wake up at a consistent time — even without an alarm?",
      "opts": [
        "Yes — my body has a reliable clock",
        "Roughly — within 30–45 minutes",
        "No — it varies a lot",
        "I need an alarm and still struggle to wake"
      ],
      "scores": [
        {
          "A": 0,
          "C": 3,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 2,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 1,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Do you feel mentally sharp in the first few hours of the day?",
      "opts": [
        "Yes — mornings are when I'm clearest",
        "Reasonably — takes about an hour",
        "Takes most of the morning",
        "I'm never really sharp — the fog doesn't clear"
      ],
      "scores": [
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 3,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 2,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 1,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "What does your sleeping environment feel like?",
      "opts": [
        "Cool, dark, quiet — optimised for sleep",
        "Mostly good — minor issues",
        "Several issues — light, noise, temperature",
        "Poor — my environment actively disrupts my sleep"
      ],
      "scores": [
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 3
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 2
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 1
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Do you eat a heavy meal within 2–3 hours of bedtime?",
      "opts": [
        "Rarely — I finish eating early",
        "Sometimes",
        "Often",
        "Almost always — dinner is usually late"
      ],
      "scores": [
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 3
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 2
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 1
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Do you have a wind-down routine before sleep?",
      "opts": [
        "Yes — a consistent, calming practice",
        "A loose one — sometimes I wind down",
        "Not really — I go from activity to bed",
        "No — I often fall asleep mid-task or on the sofa"
      ],
      "scores": [
        {
          "A": 3,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 2,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 1,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Do you feel like your body temperature regulates properly for sleep?",
      "opts": [
        "Yes — I generally feel comfortable in bed",
        "Mostly — occasional overheating",
        "I often sleep too hot or wake sweating",
        "Temperature regulation is a consistent problem"
      ],
      "scores": [
        {
          "A": 0,
          "C": 0,
          "Q": 3,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 2,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 1,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Do you nap during the day?",
      "opts": [
        "Rarely — I don't need to",
        "Occasionally — short naps when tired",
        "Often — I rely on naps to function",
        "Daily — I couldn't get through the day without them"
      ],
      "scores": [
        {
          "A": 0,
          "C": 3,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 2,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 1,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Do you use alcohol to help you relax or fall asleep?",
      "opts": [
        "Never",
        "Occasionally — a glass of wine sometimes",
        "Regularly",
        "It's part of my sleep routine"
      ],
      "scores": [
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 3
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 2
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 1
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "When you sleep well, how many hours does that typically look like?",
      "opts": [
        "7–9 hours — I protect my sleep window",
        "6–7 hours — not ideal but functional",
        "Under 6 hours — there's never enough time",
        "It varies so much I can't give a consistent answer"
      ],
      "scores": [
        {
          "A": 0,
          "C": 0,
          "Q": 3,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 2,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 1,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Do work thoughts or unresolved tasks intrude at bedtime?",
      "opts": [
        "Rarely — I have mental closure by evening",
        "Sometimes — I mentally review the day",
        "Often — I can't stop processing",
        "Almost always — bed is where I prep for tomorrow"
      ],
      "scores": [
        {
          "A": 3,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 2,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 1,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Do you feel light-sensitive or sound-sensitive before sleep?",
      "opts": [
        "Not particularly",
        "Somewhat — I prefer dim and quiet",
        "Quite sensitive — I need near-darkness and silence",
        "Extremely — any stimulation keeps me awake"
      ],
      "scores": [
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 3
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 2
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 1
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Do you feel physical tension in your body when you get into bed?",
      "opts": [
        "Rarely — my body releases fairly quickly",
        "Sometimes — I do a few stretches",
        "Often — my body is tight and tense",
        "Almost always — I carry the day's tension into sleep"
      ],
      "scores": [
        {
          "A": 3,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 2,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 1,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "How do you feel about sleep — is it something you look forward to?",
      "opts": [
        "Yes — I genuinely enjoy sleep",
        "It's fine — neutral",
        "I'm slightly anxious about it",
        "I dread bedtime — it's associated with frustration"
      ],
      "scores": [
        {
          "A": 3,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 2,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 1,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Does exercise improve your sleep quality?",
      "opts": [
        "Yes — movement clearly improves my sleep",
        "Somewhat — I think it helps",
        "I'm not sure — I don't notice a difference",
        "I'm too tired to exercise consistently"
      ],
      "scores": [
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 3,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 2,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 1,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Does stress from earlier in the day feel present in your body at bedtime?",
      "opts": [
        "Rarely — I release it during the day",
        "Sometimes",
        "Often — I carry it into the evening",
        "Almost always — I go to bed still activated"
      ],
      "scores": [
        {
          "A": 3,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 2,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 1,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Is your bedroom associated exclusively with sleep?",
      "opts": [
        "Sleep only — I'm strict about this",
        "Mostly sleep — occasional reading",
        "Some work or screen use in bed",
        "I do most things in bed — it's my everything space"
      ],
      "scores": [
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 3
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 2
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 1
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Do you get natural light exposure in the morning — within an hour of waking?",
      "opts": [
        "Yes — I go outside or sit near a bright window",
        "Sometimes",
        "Rarely — I go from bed to indoor environments",
        "Almost never — I barely see daylight in the morning"
      ],
      "scores": [
        {
          "A": 0,
          "C": 3,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 2,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 1,
          "Q": 0,
          "R": 0,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Does your sleep change significantly with life stress?",
      "opts": [
        "Minimally — I can sleep through most things",
        "Somewhat — high-stress periods affect me",
        "Significantly — stress immediately disrupts my sleep",
        "Completely — my sleep is a direct mirror of my stress level"
      ],
      "scores": [
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 3,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 2,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 1,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    },
    {
      "q": "Do you feel cognitively sharper the day after a good night's sleep?",
      "opts": [
        "Yes — the difference is significant and clear",
        "Somewhat — I notice a difference",
        "Slightly — it helps but not dramatically",
        "Not really — I feel similarly regardless of sleep quality"
      ],
      "scores": [
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 3,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 2,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 1,
          "D": 0
        },
        {
          "A": 0,
          "C": 0,
          "Q": 0,
          "R": 0,
          "D": 0
        }
      ]
    }
  ];

export type SleepType = "deep" | "light" | "cyclist" | "dysregulated";

export const SLEEP_BANDS: Record<SleepType, {
  label: string;
  title: string;
  desc: string;
  insights: string[];
}> = {
    "deep": {
      "label": "Deep Restorer",
      "title": "Your sleep is genuinely restoring you.",
      "desc": "You're achieving the kind of sleep that actually repairs the body and consolidates memory. Your circadian rhythm is reasonably aligned, your sleep architecture allows for deep slow-wave and REM cycles, and your nervous system is finding genuine recovery overnight. This is the foundation of everything else — emotional resilience, cognitive clarity, physical health. The goal now is to protect and deepen it.",
      "insights": [
        "Your slow-wave sleep cycles are likely intact — this is where physical repair happens",
        "Your cortisol awakening response is probably well-timed, supporting morning alertness",
        "Your nervous system is downregulating effectively at night",
        "Consistent sleep timing is one of the most powerful longevity interventions known"
      ]
    },
    "light": {
      "label": "Light Sleeper",
      "title": "You're sleeping, but not deeply enough.",
      "desc": "You're getting hours but not quality. Light sleep doesn't provide the slow-wave and REM cycles the body and brain need for genuine restoration. You may feel like you've slept but wake without true refreshment. This is one of the most common — and most underaddressed — sleep patterns. The good news: it responds well to targeted interventions in sleep architecture, circadian timing, and nervous system preparation.",
      "insights": [
        "Light sleep doesn't trigger the growth hormone release that repairs tissue and muscle",
        "Your brain may not be completing full memory consolidation cycles overnight",
        "Subclinical nervous system activation is likely keeping you out of deep sleep",
        "Evening light exposure, late eating, and screen use are the most common culprits"
      ]
    },
    "cyclist": {
      "label": "Exhausted Cyclist",
      "title": "You're running a sleep debt you can't repay on weekends.",
      "desc": "Your sleep patterns are inconsistent — good nights followed by poor ones, catching up on weekends, irregular bedtimes. This cycling prevents your circadian rhythm from stabilising, which disrupts the hormonal cascades that sleep depends on. Weekend catch-up sleep doesn't restore what chronic inconsistency takes. Your system needs a rhythm it can predict and prepare for.",
      "insights": [
        "Irregular sleep timing disrupts cortisol, melatonin, and insulin rhythms simultaneously",
        "Social jetlag — different sleep times on weekdays vs weekends — has measurable health consequences",
        "Your body can't fully pre-prepare for sleep if it can't predict when sleep is coming",
        "Consistency of sleep timing matters more than total hours for metabolic health"
      ]
    },
    "dysregulated": {
      "label": "Sleep Dysregulated",
      "title": "Your sleep system needs a full reset.",
      "desc": "Your sleep is significantly disrupted across multiple dimensions — difficulty falling asleep, staying asleep, or feeling restored regardless of hours. This level of disruption creates a compounding cycle: poor sleep increases stress hormones, which further disrupt sleep. Your system isn't failing — it's responding to inputs. But those inputs need to change. A multi-modal approach is the most effective path.",
      "insights": [
        "Chronic sleep disruption elevates cortisol, impairs immune function, and accelerates biological aging",
        "Your body is likely in a hyperaroused state at bedtime — the opposite of what sleep requires",
        "Sleep restriction therapy and circadian reset protocols have strong clinical evidence",
        "This pattern responds best to professional support — not just better sleep hygiene"
      ]
    }
  };
