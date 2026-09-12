export const LISTING_CLOSURE_REASONS = [
  { value: "no_longer_available", label: "I no longer offer this space" },
  { value: "lease_ended", label: "My lease or right to use it ended" },
  { value: "business_closed", label: "The studio or business closed" },
  { value: "space_changed", label: "The space moved or changed substantially" },
  { value: "other", label: "Something else" },
] as const;

export type ListingClosureReason = (typeof LISTING_CLOSURE_REASONS)[number]["value"];
export type ListingClosureState = "open" | "approved" | "rejected";

export interface ListingClosureRequest {
  id: string;
  reason: ListingClosureReason;
  detail: string | null;
  state: ListingClosureState;
  requestedAt: Date;
}

export function listingClosureReasonLabel(reason: string): string {
  return LISTING_CLOSURE_REASONS.find((item) => item.value === reason)?.label ?? reason;
}
