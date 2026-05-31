import { describe, expect, it } from "vitest";
import { bidDetailPath, bidIdFromRouteParam } from "./bid-routes";

describe("bid route helpers", () => {
  it("round-trips crawler bid ids with encoded route characters", () => {
    const id = "hi_state_procurement:2026-PROF-6 (COM)";

    expect(bidDetailPath(id)).toBe("/bids/hi_state_procurement%3A2026-PROF-6%20(COM)");
    expect(bidIdFromRouteParam("hi_state_procurement%3A2026-PROF-6%20(COM)")).toBe(id);
  });

  it("leaves already decoded route params usable", () => {
    expect(bidIdFromRouteParam("mo_state_procurement:H2502-01")).toBe("mo_state_procurement:H2502-01");
  });

  it("falls back to the original value for malformed escape sequences", () => {
    expect(bidIdFromRouteParam("bad%escape")).toBe("bad%escape");
  });
});
