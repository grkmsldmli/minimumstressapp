/**
 * The Burnout Test, carried over from the page it replaces.
 *
 * The hundred questions, the four categories, the three result profiles and
 * their wording are exactly as they were written — extracted from the original
 * script rather than retyped, so not a word of it drifted in the move.
 *
 * What changed is the shape around them. The scoring, the draw and the copy
 * live here where they can be read and tested; the page only draws.
 *
 * One thing did have to go. Each category ended in an "Explore ..." button
 * pointing at /collections/all-session, and that catalogue is closing with the
 * store — the buttons would land on a 410. The categories themselves stay,
 * because what they say about where the stress is landing is the useful part.
 */

/** Where the pressure is showing up. Their four, unchanged. */
export type BurnoutCategory = "physical" | "traditional" | "social" | "spiritual";

export interface BurnoutQuestion {
  q: string;
  opts: string[];
  /** 0 is the healthiest answer, 3 the most strained. Their scale. */
  w: number[];
  tags: BurnoutCategory[];
}

/** Ten are drawn from these at random, which is how the original worked. */
export const QUESTION_POOL: BurnoutQuestion[] = [
    {
      "q": "How do you feel on Sunday evenings?",
      "opts": [
        "Relaxed and ready",
        "A little uneasy",
        "Dreading Monday",
        "Anxious, can't switch off"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "When did you last feel genuinely excited about your work?",
      "opts": [
        "This week",
        "A few weeks ago",
        "Can't really remember",
        "I've lost track entirely"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social"
      ]
    },
    {
      "q": "Be honest — are you actually okay right now?",
      "opts": [
        "Yes, genuinely",
        "Mostly, but tired",
        "Not really",
        "No, and I haven't been for a while"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "What happens to your energy by mid-afternoon?",
      "opts": [
        "Still going strong",
        "A bit slow but fine",
        "Running on empty",
        "Completely gone"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical",
        "traditional"
      ]
    },
    {
      "q": "Something small goes wrong at work. What's your reaction?",
      "opts": [
        "I handle it calmly",
        "Minor irritation",
        "It really gets to me",
        "I feel like I'm at breaking point"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "When did you last take a full day off — no emails, no work?",
      "opts": [
        "Recently",
        "A few months ago",
        "Over a year ago",
        "I genuinely can't remember"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "Describe your sleep lately in one phrase.",
      "opts": [
        "Deep and restful",
        "Okay but inconsistent",
        "Restless most nights",
        "I wake up more tired than I went to bed"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical",
        "traditional",
        "spiritual"
      ]
    },
    {
      "q": "Do the people around you recognise your efforts?",
      "opts": [
        "Yes, regularly",
        "Sometimes",
        "Rarely",
        "Never — I feel completely invisible"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social"
      ]
    },
    {
      "q": "Where does your body carry stress first?",
      "opts": [
        "I don't notice it physically",
        "Slight tension here and there",
        "Shoulders, jaw, or head regularly",
        "My whole body feels tight almost constantly"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical",
        "traditional"
      ]
    },
    {
      "q": "If a close friend asked how you're really doing, what would you say?",
      "opts": [
        "Honestly, pretty good",
        "Tired but managing",
        "Struggling more than I let on",
        "I don't even know anymore"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "Does your daily work feel meaningful to you?",
      "opts": [
        "Yes, clearly",
        "Sometimes",
        "Not really",
        "It feels completely pointless"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "After finishing work, what does switching off look like?",
      "opts": [
        "Pretty quick — I let it go",
        "Takes 30–60 minutes",
        "Several hours",
        "I never fully switch off"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "When did you last eat lunch away from a screen?",
      "opts": [
        "Today",
        "A few days ago",
        "I can't remember the last time",
        "I barely stop to eat at all"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical",
        "social"
      ]
    },
    {
      "q": "Are you truly present when you're with people you love?",
      "opts": [
        "Yes, fully",
        "Mostly",
        "I'm often distracted",
        "I'm there physically but somewhere else mentally"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "Be honest — are you just going through the motions?",
      "opts": [
        "No, I feel engaged",
        "Occasionally",
        "More often than I'd like",
        "Almost every single day"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "Outside of work, what do you genuinely look forward to?",
      "opts": [
        "Several things",
        "One or two things",
        "Not much honestly",
        "Nothing — everything feels flat"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "Do you cancel plans because you're too exhausted?",
      "opts": [
        "Rarely",
        "Once in a while",
        "Fairly often",
        "It's become my default"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical",
        "social"
      ]
    },
    {
      "q": "Can you sit and focus deeply for 30 minutes without your mind wandering?",
      "opts": [
        "Yes, no problem",
        "Usually",
        "I'm really struggling with this",
        "I can barely focus at all right now"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical",
        "spiritual"
      ]
    },
    {
      "q": "What does calm feel like for you right now?",
      "opts": [
        "I feel it regularly",
        "I have calm moments",
        "It's rare",
        "I can't remember the last time I felt calm"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "traditional"
      ]
    },
    {
      "q": "Do your moods drop suddenly for no obvious reason?",
      "opts": [
        "Rarely",
        "Occasionally",
        "Often",
        "It happens almost every day"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "traditional",
        "spiritual"
      ]
    },
    {
      "q": "After a full day off, how do you feel?",
      "opts": [
        "Genuinely refreshed",
        "Somewhat better",
        "About the same",
        "Still just as exhausted"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical",
        "traditional"
      ]
    },
    {
      "q": "Is there any time in your week that truly belongs to you?",
      "opts": [
        "Yes, regularly",
        "A little",
        "Barely",
        "No — there's nothing left for me"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "When was the last time you laughed — really laughed?",
      "opts": [
        "Today or yesterday",
        "This week",
        "A while ago",
        "I honestly can't remember"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "Does work follow you into your sleep or dreams?",
      "opts": [
        "Never",
        "Occasionally",
        "Often",
        "Almost every night"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "traditional"
      ]
    },
    {
      "q": "What's your relationship with food been like lately?",
      "opts": [
        "Normal and healthy",
        "Slightly off",
        "Noticeably changed",
        "I barely notice hunger or I eat to cope"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical",
        "traditional"
      ]
    },
    {
      "q": "Do you feel resentment creeping into how you feel about your responsibilities?",
      "opts": [
        "Rarely",
        "Sometimes",
        "More than I'd like to admit",
        "Almost every day"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social"
      ]
    },
    {
      "q": "Are you still growing — learning, evolving, feeling challenged in a good way?",
      "opts": [
        "Yes, consistently",
        "Here and there",
        "Not really",
        "No — I feel completely stuck"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "Look at your to-do list right now. What do you feel?",
      "opts": [
        "Fine — it's manageable",
        "A little overwhelmed",
        "Genuinely overwhelmed",
        "Like it will never end no matter what I do"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social"
      ]
    },
    {
      "q": "Can you say no to extra requests without guilt or fear?",
      "opts": [
        "Yes, easily",
        "Sometimes",
        "Very rarely",
        "No — I'm afraid of what happens if I do"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social"
      ]
    },
    {
      "q": "Do you ever feel nothing — emotionally numb, cut off, flat?",
      "opts": [
        "Rarely",
        "Occasionally",
        "Often",
        "Most of the time — I feel like I'm on autopilot"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "traditional"
      ]
    },
    {
      "q": "What's your patience like with the people around you lately?",
      "opts": [
        "Good — I'm pretty patient",
        "Okay",
        "I snap more than I should",
        "I have almost no patience left"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "Picture the next six months. What's the first feeling that comes up?",
      "opts": [
        "Optimism",
        "Cautious hope",
        "Anxiety",
        "Dread — or nothing at all"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "Do you feel genuinely respected where you work or spend most of your time?",
      "opts": [
        "Yes, regularly",
        "Sometimes",
        "Rarely",
        "Never"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social"
      ]
    },
    {
      "q": "What does rest look like for you right now?",
      "opts": [
        "I rest well and without guilt",
        "I rest but feel guilty about it",
        "I want to rest but can't seem to",
        "My mind won't let me stop even when I try"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "Does your body feel heavy — like you're carrying something you can't put down?",
      "opts": [
        "Rarely",
        "Sometimes",
        "Often",
        "Almost always"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical",
        "traditional"
      ]
    },
    {
      "q": "Do you feel like you have real support around you right now?",
      "opts": [
        "Yes, I feel genuinely supported",
        "Somewhat",
        "Not really",
        "I feel completely alone in this"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social"
      ]
    },
    {
      "q": "Do you ever fantasise about quitting everything and starting over?",
      "opts": [
        "Rarely",
        "Sometimes",
        "Often",
        "It's basically a daily thought"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "Where does stress show up in your body?",
      "opts": [
        "It rarely shows up physically",
        "Occasionally — tight shoulders or jaw",
        "Often — headaches, tension, stomach",
        "My whole body feels like it's under pressure"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical",
        "traditional"
      ]
    },
    {
      "q": "Has your creative spark gone quiet lately?",
      "opts": [
        "No — I still feel it",
        "A little muted",
        "Pretty blocked",
        "I've lost it completely"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual"
      ]
    },
    {
      "q": "Are you living — or just surviving?",
      "opts": [
        "Living, genuinely",
        "Somewhere in between",
        "Mostly surviving",
        "Just going through the motions every day"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "Do you wear a mask — showing up one way while feeling completely different inside?",
      "opts": [
        "Rarely",
        "Sometimes",
        "Often",
        "Every single day — it's exhausting"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "Do the people you love get the best of you — or what's left?",
      "opts": [
        "The best of me",
        "Mostly the best",
        "Usually what's left",
        "I have nothing left to give by the time I get to them"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "physical"
      ]
    },
    {
      "q": "Small decisions — choosing lunch, replying to a message — how do they feel?",
      "opts": [
        "Fine, no problem",
        "Slightly taxing",
        "Surprisingly hard",
        "Even tiny choices drain me"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "traditional"
      ]
    },
    {
      "q": "Does your nervous system ever feel like it's stuck in high alert?",
      "opts": [
        "Rarely",
        "Sometimes",
        "Often",
        "I genuinely can't remember feeling settled"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "traditional",
        "physical"
      ]
    },
    {
      "q": "What does the voice in your head sound like lately?",
      "opts": [
        "Supportive and calm",
        "Neutral",
        "Quite critical",
        "Relentless and harsh"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "Does spending time with people leave you more drained than it used to?",
      "opts": [
        "No — I still enjoy it",
        "A little more than before",
        "Yes, significantly",
        "Even brief interactions leave me depleted"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "physical"
      ]
    },
    {
      "q": "Do you ever feel like you're watching your own life from behind glass?",
      "opts": [
        "Rarely",
        "Sometimes",
        "Often",
        "Most of the time — I feel strangely detached"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "traditional"
      ]
    },
    {
      "q": "Do you need permission — from yourself or others — to slow down?",
      "opts": [
        "No — I slow down when I need to",
        "Sometimes",
        "Usually yes",
        "I'm waiting for someone to tell me it's okay"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "Is there a gap between how you appear to others and how you actually feel?",
      "opts": [
        "Rarely",
        "Sometimes",
        "Often",
        "Every day — maintaining it takes so much energy"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "What does your brain feel like by the end of the day?",
      "opts": [
        "Clear and functional",
        "A bit foggy",
        "Pretty slow and unclear",
        "Completely foggy — I can barely think straight"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical",
        "traditional"
      ]
    },
    {
      "q": "Can you remember the last time you felt truly, deeply relaxed?",
      "opts": [
        "Yes — recently",
        "A while ago",
        "It's been a long time",
        "I'm not sure I can remember what that feels like"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "traditional"
      ]
    },
    {
      "q": "Are you one bad day away from breaking?",
      "opts": [
        "No — I have reserves",
        "I have some buffer",
        "Not much buffer left",
        "I feel like I'm already at that edge"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social",
        "traditional"
      ]
    },
    {
      "q": "Does anyone around you actually know how close you are to your limit?",
      "opts": [
        "Yes — I'm open about it",
        "A few people do",
        "Not really",
        "Nobody knows — I hide it well"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "What's the first feeling when you open your eyes in the morning?",
      "opts": [
        "Ready",
        "Okay",
        "Already behind",
        "Dread — before the day has even started"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "Do you feel guilty when you take time off?",
      "opts": [
        "Rarely",
        "Sometimes",
        "Often",
        "Every single time — I can't fully rest"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "When did you last drink enough water and eat a proper meal without rushing?",
      "opts": [
        "Today",
        "A few days ago",
        "I can't remember",
        "I run on fumes most days"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical",
        "traditional"
      ]
    },
    {
      "q": "Does the weekend actually feel like recovery — or does it disappear?",
      "opts": [
        "Real recovery",
        "Partial recovery",
        "It goes by in a blur",
        "Two days is nowhere near enough"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "Do noise, screens, or people overwhelm you more than they used to?",
      "opts": [
        "No — I'm fine",
        "A little more sensitive",
        "Significantly more sensitive",
        "Everything feels too loud and too much"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "traditional",
        "physical"
      ]
    },
    {
      "q": "Are you sleeping enough — and does it actually help?",
      "opts": [
        "Yes — I feel rested",
        "Somewhat",
        "I sleep but don't feel restored",
        "I never feel like I've caught up"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical",
        "traditional"
      ]
    },
    {
      "q": "Do you still know what makes you genuinely happy?",
      "opts": [
        "Yes, clearly",
        "I think so",
        "Not really",
        "I honestly don't know anymore"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "Do you absorb other people's stress on top of your own?",
      "opts": [
        "Rarely",
        "Sometimes",
        "Often",
        "Always — I carry everyone's weight"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "traditional"
      ]
    },
    {
      "q": "Do you feel like you need a complete life reset — but have no idea where to start?",
      "opts": [
        "No — I feel on track",
        "Kind of",
        "Often",
        "It's all I think about and I feel paralysed"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "Has your own self-care been the first casualty of being busy?",
      "opts": [
        "No — I protect it",
        "Sometimes it slips",
        "Often",
        "It's been gone for a long time"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical",
        "social",
        "traditional"
      ]
    },
    {
      "q": "Does rest feel like something you have to earn?",
      "opts": [
        "No — I take it when I need it",
        "Sometimes",
        "Usually",
        "I can't rest until I've done enough — which is never"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "Has your identity become tangled up entirely with your productivity?",
      "opts": [
        "No — I know who I am beyond work",
        "A little",
        "Quite a lot",
        "Completely — I don't know who I am when I'm not being useful"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "Does time alone restore you — or leave you feeling just as empty?",
      "opts": [
        "It restores me",
        "Somewhat",
        "Not much",
        "Even alone time leaves me drained"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "traditional"
      ]
    },
    {
      "q": "Do you ever wish you could just pause life — not escape, just pause?",
      "opts": [
        "Rarely",
        "Sometimes",
        "Often",
        "Every single day"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "What does your breathing feel like right now — in this moment?",
      "opts": [
        "Full and easy",
        "Fine",
        "A bit shallow",
        "Tight — I notice I'm holding my breath"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical",
        "spiritual",
        "traditional"
      ]
    },
    {
      "q": "Do you feel at home in your own body?",
      "opts": [
        "Yes",
        "Mostly",
        "Not really",
        "I feel like I'm living entirely in my head"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical",
        "spiritual"
      ]
    },
    {
      "q": "Does joy feel like something that happens to other people?",
      "opts": [
        "No — I feel it too",
        "Sometimes I feel cut off from it",
        "Often",
        "Almost always — it feels out of reach for me"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "Is there tension between who you are and who you think you're supposed to be?",
      "opts": [
        "Rarely",
        "Sometimes",
        "Often",
        "It's a constant internal conflict I can't switch off"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "Does your body ever feel like it's asking you to be gentler with it?",
      "opts": [
        "Rarely",
        "Sometimes",
        "Often",
        "It's practically begging me to stop"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical",
        "traditional"
      ]
    },
    {
      "q": "Is money stress adding to everything else you're carrying?",
      "opts": [
        "No — I feel okay financially",
        "A little",
        "Yes, significantly",
        "It's a constant background hum I can't escape"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social"
      ]
    },
    {
      "q": "Does your life have a rhythm — or does it feel chaotic and unstructured?",
      "opts": [
        "Good rhythm",
        "Mostly structured",
        "Inconsistent",
        "Completely adrift — no structure at all"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual",
        "physical"
      ]
    },
    {
      "q": "Do you ever miss a version of yourself that felt lighter?",
      "opts": [
        "Rarely",
        "Sometimes",
        "Often",
        "Almost every day — I barely recognise that person"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "Does social media leave you feeling better or worse?",
      "opts": [
        "Better or neutral",
        "Neutral mostly",
        "Usually worse",
        "I feel noticeably worse every time I scroll"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "Are you being honest with yourself about how you're actually feeling?",
      "opts": [
        "Yes, fully",
        "Mostly",
        "Partially",
        "No — I've been avoiding it for a while now"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "Is your immune system or body struggling more than usual?",
      "opts": [
        "No — I feel physically well",
        "A little rundown",
        "Often sick or depleted",
        "My body feels like it's constantly fighting something"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "traditional",
        "physical"
      ]
    },
    {
      "q": "Do you crave nature, fresh air, or open space but rarely get it?",
      "opts": [
        "No — I get enough",
        "A little",
        "Often",
        "I feel completely starved of it"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical",
        "traditional"
      ]
    },
    {
      "q": "Have you tried things to help yourself recover — and found nothing sticks?",
      "opts": [
        "Things work for me",
        "Some things help",
        "Not much helps",
        "I've tried everything and nothing seems to work"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "traditional",
        "social"
      ]
    },
    {
      "q": "Does your daily life actually reflect what you value most?",
      "opts": [
        "Yes, mostly",
        "Somewhat",
        "Not really",
        "Almost never — the gap weighs on me constantly"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "Are your closest relationships feeling the strain of your stress?",
      "opts": [
        "No — they feel solid",
        "A little",
        "Yes, noticeably",
        "Significantly — and it worries me"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social"
      ]
    },
    {
      "q": "Does physical movement help you decompress and feel more like yourself?",
      "opts": [
        "Yes — it really helps",
        "Sometimes",
        "Rarely",
        "I'm too exhausted to even try"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical"
      ]
    },
    {
      "q": "What happens when your head hits the pillow at night?",
      "opts": [
        "I relax and drift off",
        "I unwind after a while",
        "My mind starts racing",
        "I lie there with thoughts I can't switch off"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "traditional"
      ]
    },
    {
      "q": "Do achievements and wins still feel good — or do they feel hollow?",
      "opts": [
        "They feel genuinely good",
        "Somewhat satisfying",
        "A bit hollow",
        "Nothing feels satisfying anymore"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "Do you find yourself pulling away from people — even ones you care about?",
      "opts": [
        "Rarely",
        "Sometimes",
        "Often",
        "Almost always — I just want to disappear"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "Does stress show up in your gut — digestion, nausea, tension in your stomach?",
      "opts": [
        "Rarely",
        "Sometimes",
        "Often",
        "My body reacts physically to stress regularly"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "traditional",
        "physical"
      ]
    },
    {
      "q": "Do you feel disconnected from any real sense of meaning or purpose?",
      "opts": [
        "No — I feel a sense of purpose",
        "Sometimes I lose touch with it",
        "Often",
        "I feel like I'm just existing"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "Do you need to talk to someone — but hold it in instead?",
      "opts": [
        "No — I reach out when I need to",
        "Sometimes I hold back",
        "Often",
        "Almost always — I carry it alone"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "Is there a version of your life that feels possible — or does everything feel out of reach?",
      "opts": [
        "Yes — I can see a path forward",
        "Somewhat",
        "Hard to imagine right now",
        "Everything feels stuck or impossible"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "Does your work feel like it's expanding to fill every hour — including the ones that should be yours?",
      "opts": [
        "No — I have clear boundaries",
        "Somewhat",
        "Often",
        "Always — work has taken over everything"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social"
      ]
    },
    {
      "q": "Do you ever feel like you're performing wellness — telling people you're fine when you're not?",
      "opts": [
        "Rarely",
        "Sometimes",
        "Often",
        "Almost constantly — the performance is exhausting"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "Has the idea of asking for help started to feel impossible or pointless?",
      "opts": [
        "No — I'd reach out if I needed to",
        "Sometimes it feels hard",
        "Often",
        "I've stopped believing it would help"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social",
        "spiritual"
      ]
    },
    {
      "q": "What does your body feel like at the end of a typical week?",
      "opts": [
        "Good — pleasantly tired",
        "Tired but okay",
        "Really depleted",
        "Like it's been through something it hasn't recovered from"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical",
        "traditional"
      ]
    },
    {
      "q": "Do you feel like the person you want to be — or a diminished version of them?",
      "opts": [
        "Mostly like myself",
        "Somewhere in between",
        "Quite diminished",
        "A shadow of who I used to be"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "Is there anything in your life right now that genuinely nourishes you?",
      "opts": [
        "Yes — several things",
        "One or two things",
        "Not much",
        "I can't think of anything right now"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "Does the thought of change — even positive change — feel overwhelming?",
      "opts": [
        "No — I'm open to it",
        "A little",
        "Often",
        "Even good change feels like too much right now"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "traditional"
      ]
    },
    {
      "q": "Do you feel like you have a choice in how you spend your time and energy?",
      "opts": [
        "Yes, mostly",
        "Some choice",
        "Very little",
        "None — I'm just reacting to demands all day"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "social"
      ]
    },
    {
      "q": "When was the last time you felt proud of yourself — genuinely, quietly proud?",
      "opts": [
        "Recently",
        "A while ago",
        "A long time ago",
        "I can't remember — I dismiss everything I do"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "spiritual",
        "social"
      ]
    },
    {
      "q": "Right now, in this moment — what does your body most need?",
      "opts": [
        "I feel okay",
        "Rest",
        "To slow down significantly",
        "To stop completely — it's been asking for too long"
      ],
      "w": [
        0,
        1,
        2,
        3
      ],
      "tags": [
        "physical",
        "traditional",
        "spiritual"
      ]
    }
  ];

export const CATEGORIES: Record<BurnoutCategory, { label: string; desc: string; tags: string[] }> = {
    "physical": {
      "label": "Physical Activity",
      "desc": "Your answers suggest your body may be carrying stress as tension, low energy, poor recovery, or heaviness. Gentle movement can help discharge activation, improve circulation, and rebuild trust with your body without forcing performance.",
      "tags": [
        "Yoga Instructor",
        "Pilates Instructor",
        "Tai Chi / Qigong Instructor"
      ]
    },
    "traditional": {
      "label": "Traditional Medicine",
      "desc": "Your pattern points toward whole-body depletion: sleep, digestion, immune rhythm, or nervous-system sensitivity. Supportive natural wellness can help you create calmer routines around nourishment, rest, herbs, aromatherapy, and recovery rituals.",
      "tags": [
        "Ayurveda Consultant",
        "Naturopath",
        "Herbalist",
        "Aromatherapy Expert"
      ]
    },
    "social": {
      "label": "Social & Life Coaching",
      "desc": "Your answers show that boundaries, workload, money pressure, relationships, or feeling unseen may be part of the stress load. Coaching can help you sort what is yours to carry, what needs structure, and what needs to be communicated.",
      "tags": [
        "Mindfulness & Stress Coach",
        "Career & Life Coach",
        "Financial Wellness Coach",
        "Relationship Coach"
      ]
    },
    "spiritual": {
      "label": "Spirituality & Meditation",
      "desc": "Your answers suggest your inner system may be asking for stillness, meaning, emotional honesty, or reconnection. Meditation, breathwork, and reflective guidance can help quiet the mental noise and restore a sense of inner ground.",
      "tags": [
        "Meditation Instructor",
        "Breathwork",
        "Guided Visualization",
        "Spiritual Coach"
      ]
    }
  };

export const CATEGORY_INSIGHTS: Record<BurnoutCategory, { label: string; text: string }> = {
    "physical": {
      "label": "Body load",
      "text": "Tension, low stamina, heaviness, or poor physical recovery may be part of your stress pattern."
    },
    "traditional": {
      "label": "System rhythm",
      "text": "Sleep, digestion, immune resilience, and daily nourishment may need steadier support."
    },
    "social": {
      "label": "Life pressure",
      "text": "Boundaries, responsibilities, relationships, money, or work meaning may be adding weight."
    },
    "spiritual": {
      "label": "Inner disconnection",
      "text": "Calm, purpose, joy, emotional honesty, or presence may feel harder to access right now."
    }
  };

export type BurnoutLevel = "low" | "mid" | "high";

export const PROFILES: Record<BurnoutLevel, {
  scoreNote: string;
  storyTitle: string;
  story: string;
  patternTitle: string;
  pattern: string;
  scienceTitle: string;
  science: string;
  planTitle: string;
  planText: string;
  actions: string[];
  chips: string[];
}> = {
    "low": {
      "scoreNote": "Low burnout risk. Your system still has recovery capacity.",
      "storyTitle": "You are not running on empty — and that is worth protecting.",
      "story": "Your answers suggest that stress may be present, but it has not taken over your whole rhythm. You still seem to have access to recovery, perspective, and some emotional flexibility. This is the ideal stage to build small protective habits, because prevention is usually easier than repair.",
      "patternTitle": "The main theme is maintenance, not emergency recovery.",
      "pattern": "You may occasionally feel tired, distracted, or stretched, but your responses do not show a strong pattern of collapse. The goal is to keep your baseline steady before pressure accumulates.",
      "scienceTitle": "Recovery capacity is your advantage.",
      "science": "When stress is balanced with enough recovery, the nervous system can move between activation and rest more easily. In practical terms, this means sleep, movement, relationships, and meaning still have room to do their job.",
      "planTitle": "Keep your buffer strong.",
      "planText": "Use this week to protect the habits that are already working, instead of waiting until stress becomes louder.",
      "actions": [
        "Choose one non-negotiable recovery block this week, even if it is only 30 minutes.",
        "Add one body-based reset daily: walking, stretching, breathwork, or gentle mobility.",
        "Notice what currently gives you energy and schedule more of it before your calendar fills."
      ],
      "chips": [
        "protect energy",
        "maintain rhythm",
        "prevent overload"
      ]
    },
    "mid": {
      "scoreNote": "Moderate burnout risk. Your stress signals deserve attention now.",
      "storyTitle": "You are still functioning, but it may be costing more than it should.",
      "story": "Your answers suggest the classic middle zone of burnout: you can keep going, but the effort required to keep going is increasing. This is where people often say, ‘I am fine,’ while their body, patience, sleep, or motivation quietly tells a different story.",
      "patternTitle": "Your system is asking for a course correction.",
      "pattern": "The pattern is not just being busy. It looks more like reduced recovery, emotional load, and difficulty switching off. Acting now can help prevent a deeper crash later.",
      "scienceTitle": "Chronic stress becomes expensive when recovery is too short.",
      "science": "The body can handle intense periods when they are followed by repair. But when pressure stays high and recovery windows shrink, the nervous system may stay more alert, sleep may feel less restorative, and small problems can feel unusually heavy.",
      "planTitle": "Reduce the load before adding more solutions.",
      "planText": "This week should be about lowering friction, creating boundaries, and giving your system repeatable signals of safety.",
      "actions": [
        "Remove or delay one non-essential task instead of trying to optimize everything.",
        "Create a 15-minute transition ritual after work: walk, shower, stretch, breathe, or sit without screens.",
        "Tell one trusted person what has actually been hard lately, without minimizing it."
      ],
      "chips": [
        "reduced recovery",
        "boundary pressure",
        "early overload"
      ]
    },
    "high": {
      "scoreNote": "High burnout risk. Your answers show significant depletion.",
      "storyTitle": "This looks less like ordinary stress and more like accumulated depletion.",
      "story": "Your answers suggest that your body and mind may have been compensating for too long. When stress reaches this level, people often feel numb, foggy, irritable, detached, or trapped in survival mode. This is not a character flaw. It is a signal that your current rhythm may no longer be sustainable.",
      "patternTitle": "The priority is recovery and support, not pushing harder.",
      "pattern": "Your pattern points to a deeper need for restoration: less pressure, more support, clearer boundaries, and practices that help your nervous system come down from high alert.",
      "scienceTitle": "Burnout is often a mind-body pattern, not just a mindset problem.",
      "science": "Prolonged stress can affect attention, sleep quality, emotional regulation, muscle tension, digestion, motivation, and connection. That is why recovery usually needs more than motivation; it needs structure, support, and repeated restoration cues.",
      "planTitle": "Start gently and make support visible.",
      "planText": "For the next 7 days, the goal is not a dramatic life overhaul. The goal is to stop the drain, create safety, and take one supported step at a time.",
      "actions": [
        "Choose one place to reduce demand immediately: workload, commitments, screens, social pressure, or over-giving.",
        "Speak with your doctor, or another qualified professional, if distress feels persistent or intense.",
        "Use a twice-daily nervous-system reset: 3 slow breaths, unclench jaw/shoulders, feet on floor, longer exhale."
      ],
      "chips": [
        "deep depletion",
        "high alert",
        "support needed"
      ]
    }
  };
