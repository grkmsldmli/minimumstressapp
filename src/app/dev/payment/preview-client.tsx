"use client";

import { useState } from "react";

import { PaymentSheet } from "@/components/screens/payment-sheet";
import type { BookingMoneyRecord } from "@/lib/domain";

/**
 * Client half of the preview.
 *
 * The page itself is a Server Component — it has to be, to create the
 * PaymentIntent — and a Server Component cannot hand a function across the
 * boundary. So the callbacks are defined here instead, where they can be.
 */
export function PaymentPreviewClient({
  clientSecret,
  money,
  startsAt,
}: {
  clientSecret: string;
  money: BookingMoneyRecord;
  startsAt: string;
}) {
  const [state, setState] = useState<"paying" | "held" | "left">("paying");

  if (state !== "paying") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-9 text-center bg-white">
        <p className="font-display italic font-semibold text-[20px] text-navy">
          {state === "held" ? "Hold placed" : "Went back"}
        </p>
        <p className="font-body font-light text-[12px] text-ink-soft">
          {state === "held"
            ? "In the real flow this lands on the confirmation screen, with the access code and the breathing exercise."
            : "In the real flow this returns to the space."}
        </p>
        <button
          type="button"
          onClick={() => setState("paying")}
          className="mt-2 px-6 py-3 rounded-full font-body font-medium text-[13px] text-white press"
          style={{ backgroundColor: "#3B9BE8" }}
        >
          Show the sheet again
        </button>
      </div>
    );
  }

  return (
    <PaymentSheet
      clientSecret={clientSecret}
      money={money}
      spaceName="Willow"
      startsAt={new Date(startsAt)}
      onBack={() => setState("left")}
      onPaid={() => setState("held")}
    />
  );
}
