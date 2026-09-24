/** A bid's place in its lifecycle (spec 2026-09-24 §5.1). `is_active` is exactly `status === "open"`. */
export const BID_LIFECYCLE_STATUSES = ["open", "closed", "awarded"] as const;

export type BidLifecycleStatus = (typeof BID_LIFECYCLE_STATUSES)[number];

export function bidLifecycleStatusOf(value: unknown): BidLifecycleStatus | null {
  return typeof value === "string" && (BID_LIFECYCLE_STATUSES as readonly string[]).includes(value)
    ? (value as BidLifecycleStatus)
    : null;
}
