/**
 * Who the contract is with, and how to reach them.
 *
 * Two gaps this closes, both real.
 *
 * The terms said "Minimum Stress", which is the brand. The party to the
 * agreement is Minimum Stress LLC, and terms that never name the contracting
 * entity are weaker than terms that do.
 *
 * And the app told a suspended host to get in touch without saying where. A
 * rule with nobody to ask is one somebody's livelihood ends on with no
 * recourse — that was the reasoning for offering the appeal in the first
 * place, and it was undone by leaving the address out.
 *
 * One constant, so the two can never drift and neither can be quietly dropped.
 */

/**
 * The party to the terms, as registered.
 *
 * Only ever appears where it has to: naming who the agreement is with. Using
 * it as the product name would be wrong in the other direction — nobody books
 * a room from a consulting company.
 */
export const LEGAL_ENTITY = "Minimum Stress Consulting Services LLC";

/** The trading name. Everywhere else in the app. */
export const BRAND = "Minimum Stress";

/** Where a person writes when something is wrong. */
export const SUPPORT_EMAIL = "info@minimumstress.com";

/**
 * The one social account, named here rather than typed into a page.
 *
 * A handle in the markup is a handle nobody updates when it changes, and this
 * is the sort of link that is only ever noticed once it is dead.
 */
export const INSTAGRAM_URL = "https://www.instagram.com/minimumstressofficial/";

/** The marketing site. Not the source of the in-app terms — those are here. */
export const WEBSITE = "https://minimumstress.com";

/**
 * Where the app itself lives.
 *
 * Separate from the marketing site on purpose: they are two different places
 * and conflating them is how a booking confirmation links somebody to a
 * brochure. Absolute rather than relative because the places that need it —
 * link previews, the manifest, an email — are all read outside the browser
 * that would have resolved a relative path.
 */
export const APP_URL = "https://minimumstress.app";
