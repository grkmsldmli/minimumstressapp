import { describe, expect, it } from "vitest";

import { renderMarketingEmail } from "./templates";

const TOKEN = "11111111-1111-4111-8111-111111111111";

describe("marketing lifecycle email", () => {
  it("renders every campaign with consent context and one-click unsubscribe", () => {
    const campaigns = [
      "onboarding_incomplete",
      "host_listed_no_bookings",
      "browsed_no_booking",
      "first_booking_follow_up",
      "rebooking",
      "dormant_reactivation",
      "host_inventory_engagement",
    ] as const;

    for (const campaign of campaigns) {
      const email = renderMarketingEmail(campaign, TOKEN, "123 Example St, Oakland, CA 94612");
      expect(email.subject.length).toBeGreaterThan(5);
      expect(email.text).toContain("optional email");
      expect(email.text).toContain("Booking, payment, safety and account messages are separate");
      expect(email.unsubscribeUrl).toBe(
        `https://minimumstress.app/api/marketing/unsubscribe?token=${TOKEN}`,
      );
      expect(email.html).toContain(email.unsubscribeUrl);
      expect(email.html).toContain("123 Example St, Oakland, CA 94612");
    }
  });

  it("requires a valid unsubscribe token and physical postal address", () => {
    expect(() => renderMarketingEmail("rebooking", "bad", "123 Example St")).toThrow(
      /unsubscribe token/i,
    );
    expect(() => renderMarketingEmail("rebooking", TOKEN, "")).toThrow(/postal address/i);
    expect(() => renderMarketingEmail("rebooking", TOKEN, "line one\nline two")).toThrow(
      /postal address/i,
    );
  });

  it("escapes operator-controlled address text", () => {
    const email = renderMarketingEmail("rebooking", TOKEN, "123 <Main> & First, Oakland CA");
    expect(email.html).toContain("123 &lt;Main&gt; &amp; First");
    expect(email.html).not.toContain("123 <Main>");
  });
});
