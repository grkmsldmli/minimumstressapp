import { SPACE_TYPES, type SpaceType, spaceTypeBySlug } from "./space-types";

/**
 * One page per kind of room, written rather than templated.
 *
 * These are the first pages here that exist to be found rather than to be
 * navigated to, and the temptation with ten of them is obvious: write one and
 * swap the noun. That produces ten pages a search engine reads as one, picks a
 * winner from, and discounts the rest of — which is the standard way this kind
 * of page fails, and the reason "programmatic SEO" has the reputation it does.
 *
 * So each entry below says something only true of that room. Who actually
 * rents one, what makes a particular one bookable, and what a host with that
 * room specifically tends to be worried about. A reader should be able to tell
 * two of these apart with the headings covered.
 *
 * They also carry no inventory. That is the point of doing them first: there
 * are no listings yet, so every page built around "rooms in San Mateo" would
 * be empty and correctly refuse to be indexed — while these can go up today
 * and start the months of ranking they need, and what they bring back is the
 * supply that makes the rest of it possible.
 */

export interface HostPage {
  /** The room this page is about. */
  type: SpaceType;
  /** The <title>, which is also most of what a search result shows. */
  title: string;
  /** The h1. Shorter than the title, and not a repeat of it. */
  heading: string;
  /** The line under the heading. */
  standfirst: string;
  /**
   * Who is looking for a room like this.
   *
   * Two groups, because this used to describe one. Every line was a
   * profession — coaches, instructors, practitioners — which quietly told
   * anybody without a business card that the room was not for them, and told
   * a host their space only earns from professionals. Both are wrong: two
   * friends who want a floor for an hour are ordinary demand.
   *
   * The entries are the uses in booking-use.ts, said the way each side would
   * say them, so what this page advertises and what the booking form offers
   * cannot drift apart. `forThemselves` is optional and deliberately missing
   * on the rooms where it would be an invention — nobody books a treatment
   * room with a table in it for their own practice.
   */
  whoUses: {
    lead: string;
    forWork: readonly string[];
    forThemselves?: readonly string[];
  };
  /** What makes this particular kind of room bookable. Specific, not generic. */
  whatItNeeds: string[];
  /** The thing a host with this room worries about, answered. */
  concern: { question: string; answer: string };
}

const COPY: Record<string, Omit<HostPage, "type">> = {
  "pilates-studio": {
    title: "Rent Out Your Pilates Studio",
    heading: "Your reformers, on the days you are not teaching",
    standfirst:
      "Instructors need a studio for four hours on a Tuesday, not a lease. If yours is dark half the week, those hours have a price.",
    whoUses: {
      lead: "A reformer is expensive to own and idle most of the week, which is exactly why somebody else wants yours.",
      forWork: ["Pilates instructors", "Reformer teachers", "Physiotherapists and rehab coaches", "Small group classes", "Workshops"],
      forThemselves: ["Personal reformer practice", "Mat practice", "Two people training together"],
    },
    whatItNeeds: [
      "At least one reformer, and it is worth saying how many and which make — instructors teach differently on a Balanced Body than on an Allegro, and they will ask.",
      "Room to walk around the equipment with a client on it.",
      "Somewhere to leave a bag and change, even if it is a corner and a hook.",
      "Mirrors help and are not essential. Instructors correcting by hand care more about the floor and the light.",
    ],
    concern: {
      question: "What about my equipment?",
      answer:
        "You say what may be used and what may not, in the listing, and it is on the page before anybody books. Springs, straps and boxes are the usual line — most hosts let the reformers be used and keep the small apparatus out of it. Every booking is a named person with a card on file, not a stranger with a door code.",
    },
  },

  "yoga-studio": {
    title: "Rent Out Your Yoga Studio",
    heading: "A quiet floor is worth more than an empty one",
    standfirst:
      "Teachers want a room for one class a week. A studio with mornings free is a studio with income it is not taking.",
    whoUses: {
      lead: "A warm room with clear floor suits more people than a yoga schedule fills.",
      forWork: ["Yoga instructors", "Breathwork facilitators", "Small group classes", "Workshops", "Private client sessions"],
      forThemselves: ["Personal practice", "Meditation or breathwork", "Dance or movement rehearsal", "A few friends practising together"],
    },
    whatItNeeds: [
      "Floor space and a number: how many mats fit, laid out properly rather than touching.",
      "A floor that is warm underfoot, or the room heated. It is the first thing a class complains about.",
      "Quiet enough that a room of people can hear one voice — say what is above and below.",
      "Somewhere to leave shoes at the door, and props if you have them.",
    ],
    concern: {
      question: "Will there be people coming and going?",
      answer:
        "A booking is an hour, and the buffer you set either side of it is when the room is empty. You choose the hours it can be booked at all — so if the building is quiet before nine, the room simply is not available before nine. Nothing is bookable in hours you have not opened.",
    },
  },

  "movement-studio": {
    title: "Rent Out Your Movement Studio",
    /*
     * "Books more often than a specialised one" was the old heading, and we
     * have no booking data at all — there are no listings yet. A claim about
     * relative demand, made up, on the page whose whole job is to be trusted
     * by somebody deciding whether to hand us their room.
     */
    heading: "An open floor can do a lot",
    standfirst:
      "Dance practice. Pilates. Yoga. Tai chi. Private movement sessions. Small group classes. If you have clear floor space sitting unused, somebody may already be looking for it.",
    whoUses: {
      lead: "If you have clear floor space sitting unused, somebody may already be looking for it.",
      forWork: ["Pilates instructors", "Yoga instructors", "Tai chi and qigong instructors", "Movement professionals", "Small group classes"],
      forThemselves: ["Dance rehearsal", "Personal movement practice", "Yoga practice", "Meditation", "Small groups"],
    },
    whatItNeeds: [
      "Clear floor, and the dimensions. Roughly is fine; people plan a session around it.",
      "Nothing fixed in the middle of the room, which is the thing photographs hide.",
      "Ventilation. A closed room with four people working in it is a different room after twenty minutes.",
      "Somewhere to put shoes, bags and a water bottle.",
      "How many it comfortably holds. This is the number a booking is checked against, so it is worth being honest rather than optimistic about it.",
      "Mirrors, mats or equipment, if there are any, and whether they are included.",
      "Anything about music or noise — a shared wall, a downstairs neighbour, a time after which it has to be quiet.",
      "Whether a group can use it, or only one or two people. You choose this when you list, use by use.",
    ],
    concern: {
      question: "My room is not really a studio.",
      answer:
        "Most of the good ones are not. A cleared church hall, the back half of a physio practice, a converted garage with a decent floor — these get booked, because what is being paid for is an hour of uninterrupted space rather than a fit-out. Photograph it honestly and say what it is; the listings that disappoint are the ones that oversold.",
    },
  },

  "massage-room": {
    title: "Rent Out Your Massage Room",
    heading: "The hours between your own clients",
    standfirst:
      "Massage therapists with a table and a room usually have gaps in the week. Those gaps are what somebody else is looking for.",
    whoUses: {
      lead: "A table and a door that closes. The gaps in your week are what somebody else is looking for.",
      forWork: ["Licensed massage therapists", "Bodyworkers", "Sports and remedial practitioners", "Mobile practitioners without a room"],
    },
    whatItNeeds: [
      "A table, and whether linens are provided or brought. Say which; it changes what they pack.",
      "A door that locks and a room nobody walks into. This is the whole product.",
      "A sink, or a clear route to one.",
      "Somewhere for a client to undress and leave clothes.",
      "Heating that reaches the table. A cold room ends a session early.",
    ],
    concern: {
      question: "Do I have to be there?",
      answer:
        "No. Most hosts use a keypad or a lockbox, and the code goes to the practitioner only once the session is paid for — never before, and never to anybody who has not booked. If you would rather let people in yourself, set the room to that instead and it will only be bookable when you can.",
    },
  },

  "treatment-room": {
    title: "Rent Out Your Treatment Room",
    heading: "A clean private room is the most rentable thing you own",
    standfirst:
      "It suits more kinds of practitioner than anything else on this site, and the ones who need it need it every week.",
    whoUses: {
      lead: "A private room somebody can see one person in, without signing a lease for it.",
      forWork: ["Practitioners seeing private clients", "Consultants and coaches", "Visiting specialists", "Practitioners running a second location"],
    },
    whatItNeeds: [
      "A sink in the room, or immediately outside it. It is the single most asked-about detail.",
      "A treatment couch, and whether it stays or folds away.",
      "Hard flooring or something wipeable, and say which.",
      "A lock on the door and no window anybody can see through.",
      "Somewhere a client can sit for five minutes before or after.",
    ],
    concern: {
      question: "Different people, different practices — is that a problem?",
      answer:
        "It is why the listing has house rules, and why they are on the page before anybody books rather than in an email afterwards. No scented oils, no candles, wipe the couch down, take your rubbish — whatever the room actually needs. Every practitioner who books carries their own liability cover — we verify it before they can — and is responsible for their own clients and their own qualifications.",
    },
  },

  "acupuncture-room": {
    title: "Rent Out Your Room to Acupuncturists",
    heading: "Quiet, private, and booked in blocks",
    standfirst:
      "Acupuncturists work in long, still appointments and often see several people in an afternoon. They book in blocks, which suits a room that is free by the half-day.",
    whoUses: {
      lead: "Quiet, private, and set up for one person at a time.",
      forWork: ["Acupuncturists", "Practitioners of traditional medicine", "Practitioners seeing private clients"],
    },
    whatItNeeds: [
      "A couch that can be reached from both sides.",
      "Genuine quiet during the appointment — this is the room where a client is lying still for twenty minutes.",
      "Warmth, and a blanket or somewhere to keep one.",
      "A sink, and somewhere clinical waste can be dealt with properly.",
      "Dimmable or soft lighting, if you have it.",
    ],
    concern: {
      question: "Are they allowed to do that in my building?",
      answer:
        "That is a question about your lease and your building, not about us, and it is worth asking your landlord before you list rather than after. We check that you have the right to sublet the room before a listing goes live — which is why the lease or ownership document is part of listing it. Practitioners are responsible for their own licence, registration and insurance.",
    },
  },

  "esthetician-room": {
    title: "Rent Out Your Esthetician Room",
    heading: "Salon-quality space, without a salon-length lease",
    standfirst:
      "Estheticians leaving a salon suite need a proper room with water and light. Most cannot sign a year for it on day one.",
    whoUses: {
      lead: "A clean, well-lit room with a basin is hard to find by the session.",
      forWork: ["Estheticians", "Skincare and beauty professionals", "Practitioners building a private client list"],
    },
    whatItNeeds: [
      "Running water in the room, hot as well as cold. This is the make-or-break detail.",
      "Light that can be aimed at a face — a lamp, or a window that is not behind the couch.",
      "A couch that reclines, if you have one, and say if you do not.",
      "Power sockets near the couch, and how many.",
      "Somewhere to put a trolley and a clean surface to work off.",
    ],
    concern: {
      question: "What about products and mess?",
      answer:
        "House rules cover it and they are shown before anybody books: what may be used in the room, what must be taken away, and how it should be left. Most hosts of this kind of room ask that nothing is stored between sessions and the surfaces are wiped down. A practitioner who leaves a room badly is reviewed for it, and a review here is written by the host as well as about them.",
    },
  },

  "consultation-room": {
    title: "Rent Out Your Consultation Room",
    heading: "A private room to see people in, for the time you need",
    standfirst:
      "Coaches and independent practitioners need somewhere quiet to sit with one person. An office you use three days a week has four days in it.",
    whoUses: {
      lead: "A quiet room with two chairs and a door that closes.",
      forWork: ["Coaches and consultants", "Practitioners seeing private clients", "Small group sessions", "Workshops"],
    },
    whatItNeeds: [
      "Two chairs that face each other without a desk between them, if you can.",
      "A door that shuts and a room nobody passes through.",
      "Genuine sound privacy. Say what is on the other side of the wall — it is the question that decides the booking.",
      "Somewhere for a client to wait for five minutes without standing on the street, or a clear note that there is not.",
      "Reliable wifi, and the network name in the entry instructions.",
    ],
    concern: {
      question: "Is my spare office really worth listing?",
      answer:
        "If it is private, quiet and somebody can find it, yes. This is the room type with the widest gap between what exists and what is bookable — the Bay Area is full of half-used offices and short of anywhere to sit with one person for an hour. The rooms that get booked are not the smartest ones; they are the ones whose listing answered the wall question.",
    },
  },

  "meditation-room": {
    title: "Rent Out Your Meditation Room",
    heading: "Stillness is a thing people will pay for",
    standfirst:
      "Teachers running sits, breathwork sessions and small group practice need a room that is quiet at a specific hour of a specific day.",
    whoUses: {
      lead: "A still room earns from more than teaching.",
      forWork: ["Meditation teachers", "Breathwork facilitators", "Small group classes", "Workshops"],
      forThemselves: ["Personal practice", "Meditation or breathwork", "A small sitting group"],
    },
    whatItNeeds: [
      "Quiet at the hour it is bookable, which is not the same as quiet in general. Say which hours are which.",
      "Floor space, and cushions or chairs — say which, and how many.",
      "Soft light, or blinds. A room lit like an office is hard to sit in.",
      "Somewhere to leave shoes and phones at the door.",
    ],
    concern: {
      question: "How do I know it will be left as it was?",
      answer:
        "The buffer you set after each booking is yours, and the house rules are on the listing before anybody books — resetting cushions, opening a window, whatever the room needs. Both sides review each other afterwards, so a practitioner who leaves rooms badly carries that with them. Nobody booking here is anonymous.",
    },
  },

  "reiki-room": {
    title: "Rent Out Your Reiki Room",
    heading: "A warm, private room, for the hours it is empty",
    standfirst:
      "Reiki practitioners need very little and need it uninterrupted. If you have a quiet room with a couch, it is already most of the way there.",
    whoUses: {
      lead: "Quiet and warm, and useful to more people than energy workers.",
      forWork: ["Reiki practitioners", "Energy and bodywork practitioners", "Practitioners seeing private clients"],
      forThemselves: ["Personal practice", "Meditation or breathwork"],
    },
    whatItNeeds: [
      "A couch or treatment table, reachable from both sides.",
      "Warmth. The client is lying still and fully clothed for an hour.",
      "Quiet and no interruption — no one passing through, no deliveries.",
      "Soft lighting, and somewhere to put a blanket.",
    ],
    concern: {
      question: "I already list it for massage. Is this separate?",
      answer:
        "No, and it should not be. A room can be marked for as many uses as it genuinely suits, and each one is a different set of people finding it. Marking a treatment room for massage, reiki and acupuncture costs nothing and puts it in front of three groups instead of one.",
    },
  },
};

export function hostPageFor(slug: string): HostPage | null {
  const type = spaceTypeBySlug(slug);
  const copy = COPY[slug];
  return type && copy ? { type, ...copy } : null;
}

/** Every one that has a page, which is every use the site offers. */
export function hostPages(): HostPage[] {
  return SPACE_TYPES.map((type) => hostPageFor(type.slug)).filter(
    (page): page is HostPage => page !== null,
  );
}
