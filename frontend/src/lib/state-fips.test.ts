import { describe, expect, it } from "vitest";
import { STATE_FIPS, fipsForStateCode } from "./state-fips";

describe("state FIPS table", () => {
  it("covers all 50 states", () => {
    expect(Object.keys(STATE_FIPS)).toHaveLength(50);
  });

  it("maps known states to standard two-digit GEOIDs", () => {
    expect(STATE_FIPS.CA).toBe("06");
    expect(STATE_FIPS.TX).toBe("48");
    expect(STATE_FIPS.NY).toBe("36");
    expect(STATE_FIPS.WY).toBe("56");
  });

  it("uses two-digit zero-padded codes everywhere", () => {
    for (const code of Object.values(STATE_FIPS)) {
      expect(code).toMatch(/^\d{2}$/);
    }
  });

  it("never reuses a FIPS code across states", () => {
    expect(new Set(Object.values(STATE_FIPS)).size).toBe(50);
  });

  it("resolves case-insensitively and returns null for unknown codes", () => {
    expect(fipsForStateCode("ca")).toBe("06");
    expect(fipsForStateCode("US")).toBeNull();
    expect(fipsForStateCode("")).toBeNull();
  });
});
