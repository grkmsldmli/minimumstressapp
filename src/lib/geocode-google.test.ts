import { describe, expect, it } from "vitest";

import { toSuggestionsFromGoogle } from "./geocode-google";

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
