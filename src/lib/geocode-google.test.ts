import { describe, expect, it } from "vitest";

import { placeFromComponents, toSuggestionsFromGoogle } from "./geocode-google";

/**
 * Parsing only. The network calls are exercised against the live provider by
 * scripts/check-geocoder.mjs, because a mocked HTTP response proves nothing
 * about a provider's actual shape — which is the thing that breaks.
 */

const prediction = (over: Record<string, unknown> = {}) => ({
  placePrediction: {
    placeId: "place-1",
    text: { text: "1301 W Hillsdale Blvd, San Mateo, CA, USA" },
    structuredFormat: {
      mainText: { text: "1301 W Hillsdale Blvd" },
      secondaryText: { text: "San Mateo, CA, USA" },
    },
    ...over,
  },
});

describe("toSuggestionsFromGoogle", () => {
  it("splits a prediction into the two lines the dropdown draws", () => {
    const [suggestion] = toSuggestionsFromGoogle({ suggestions: [prediction()] });

    expect(suggestion.primary).toBe("1301 W Hillsdale Blvd");
    expect(suggestion.secondary).toBe("San Mateo, CA, USA");
    expect(suggestion.addressLine).toBe("1301 W Hillsdale Blvd, San Mateo, CA, USA");
    expect(suggestion.placeId).toBe("place-1");
  });

  /**
   * The whole reason coordinates are nullable. A prediction has not been
   * geocoded yet, and defaulting to 0 would put the pin in the Gulf of Guinea
   * — a real place, which is what makes it dangerous.
   */
  it("reports coordinates as absent rather than zero", () => {
    const [suggestion] = toSuggestionsFromGoogle({ suggestions: [prediction()] });

    expect(suggestion.lat).toBeNull();
    expect(suggestion.lng).toBeNull();
  });

  it("falls back to the joined text when there is no structured split", () => {
    const [suggestion] = toSuggestionsFromGoogle({
      suggestions: [prediction({ structuredFormat: undefined })],
    });

    expect(suggestion.primary).toBe("1301 W Hillsdale Blvd, San Mateo, CA, USA");
    expect(suggestion.secondary).toBe("");
  });

  /** Without a place id there is nothing to exchange for coordinates later. */
  it("drops a prediction that cannot be resolved", () => {
    expect(toSuggestionsFromGoogle({ suggestions: [prediction({ placeId: undefined })] })).toEqual(
      [],
    );
  });

  it.each([{}, { suggestions: null }, { suggestions: "nope" }, null, undefined])(
    "returns nothing for %s",
    (payload) => {
      expect(toSuggestionsFromGoogle(payload)).toEqual([]);
    },
  );

  /** Places also predicts businesses, which is half of why it was chosen. */
  it("keeps a business prediction", () => {
    const [suggestion] = toSuggestionsFromGoogle({
      suggestions: [
        prediction({
          placeId: "place-2",
          structuredFormat: {
            mainText: { text: "Blue Bottle Coffee" },
            secondaryText: { text: "Mint Plaza, San Francisco, CA, USA" },
          },
        }),
      ],
    });

    expect(suggestion.primary).toBe("Blue Bottle Coffee");
    expect(suggestion.secondary).toBe("Mint Plaza, San Francisco, CA, USA");
  });
});

/**
 * The town, taken from Google's labels rather than from its commas.
 *
 * The tempting version of this reads "1840 Gateway Dr, San Mateo, CA 94404,
 * USA" and takes the second field. That works on this address and on most
 * others, and then one arrives whose formatted line opens with a business
 * name, or carries a suite number, or names a county — and the second field is
 * something else entirely. The listing is filed under a town it is not in, on
 * a page that says so, and nobody finds out.
 */

const component = (types: string[], longText: string, shortText = longText) => ({
  types,
  longText,
  shortText,
});

const sanMateo = [
  component(["street_number"], "1840"),
  component(["route"], "Gateway Drive", "Gateway Dr"),
  component(["locality", "political"], "San Mateo"),
  component(["administrative_area_level_2"], "San Mateo County"),
  component(["administrative_area_level_1"], "California", "CA"),
  component(["country"], "United States", "US"),
  component(["postal_code"], "94404"),
];

describe("placeFromComponents", () => {
  it("takes the town, the state and the postcode", () => {
    expect(placeFromComponents(sanMateo)).toEqual({
      city: "San Mateo",
      state: "CA",
      postalCode: "94404",
    });
  });

  /*
   * The county is the trap. "San Mateo County" is a different place from "San
   * Mateo", it reads almost the same, and a page headed "Rooms in San Mateo
   * County" is one nobody searches for.
   */
  it("never mistakes the county for the town", () => {
    const county = sanMateo.filter((c) => !c.types.includes("locality"));
    expect(placeFromComponents(county).city).toBeNull();
  });

  /** Short, because "CA" is what the URLs and the headings use. */
  it("takes the two-letter state rather than the long name", () => {
    expect(placeFromComponents(sanMateo).state).toBe("CA");
  });

  /*
   * Unincorporated addresses have no locality. Google labels them differently
   * rather than omitting them, and those are the fallbacks — in order, so an
   * address carrying both still answers with the more specific one.
   */
  it("falls back where there is no locality", () => {
    expect(
      placeFromComponents([
        component(["postal_town"], "Menlo Park"),
        component(["administrative_area_level_1"], "California", "CA"),
      ]).city,
    ).toBe("Menlo Park");

    expect(
      placeFromComponents([
        component(["sublocality_level_1"], "North Fair Oaks"),
        component(["administrative_area_level_1"], "California", "CA"),
      ]).city,
    ).toBe("North Fair Oaks");
  });

  it("prefers the locality when both are there", () => {
    expect(
      placeFromComponents([
        component(["sublocality_level_1"], "SoMa"),
        component(["locality"], "San Francisco"),
      ]).city,
    ).toBe("San Francisco");
  });

  /*
   * Null, not "". An empty string is a town whose page has no name, and every
   * listing the geocoder could not place would group together on it.
   */
  it("answers null rather than empty when there is nothing to say", () => {
    expect(placeFromComponents([])).toEqual({ city: null, state: null, postalCode: null });
    expect(placeFromComponents(undefined)).toEqual({
      city: null,
      state: null,
      postalCode: null,
    });
    expect(placeFromComponents([component(["locality"], "   ")]).city).toBeNull();
  });

  it("survives a component with no types at all", () => {
    expect(placeFromComponents([{ longText: "Somewhere" }]).city).toBeNull();
  });
});
