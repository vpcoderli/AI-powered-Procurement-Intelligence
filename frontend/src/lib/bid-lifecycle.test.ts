import { describe, expect, it } from "vitest";
import { BID_LIFECYCLE_STATUSES, bidLifecycleStatusOf } from "./bid-lifecycle";

describe("bidLifecycleStatusOf", () => {
  it("accepts exactly the three lifecycle statuses", () => {
    expect(BID_LIFECYCLE_STATUSES).toEqual(["open", "closed", "awarded"]);
    for (const status of BID_LIFECYCLE_STATUSES) expect(bidLifecycleStatusOf(status)).toBe(status);
  });

  it("rejects anything else", () => {
    for (const value of ["", "Open", "pending", null, undefined, 1]) expect(bidLifecycleStatusOf(value)).toBeNull();
  });
});
