import { describe, expect, it } from "vitest";
import { STATE_CRAWLER_SOURCE_DEFINITIONS } from "./state-crawler-sources";
import { STATE_FILTERS } from "./mock-data";

describe("state filters", () => {
  it("exposes federal plus all 50 state procurement filters", () => {
    const stateFilters = STATE_FILTERS.filter((filter) => filter.issuerType === "state");

    expect(STATE_FILTERS[0]).toMatchObject({
      id: "sam",
      label: "Federal (SAM.gov)",
      stateCode: "US",
      issuerType: "federal",
    });
    expect(stateFilters).toHaveLength(50);
    expect(stateFilters.map((filter) => filter.stateCode).sort()).toEqual(
      STATE_CRAWLER_SOURCE_DEFINITIONS.map((source) => source.stateCode).sort(),
    );
    expect(stateFilters.every((filter) => filter.id === filter.stateCode.toLowerCase())).toBe(true);
    expect(stateFilters.find((filter) => filter.stateCode === "AL")?.label).toBe("Alabama (AL)");
    expect(stateFilters.find((filter) => filter.stateCode === "WY")?.label).toBe("Wyoming (WY)");
  });
});
