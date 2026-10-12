import { describe, expect, it } from "vitest";
import { STATE_CRAWLER_SOURCE_DEFINITIONS } from "./state-crawler-sources";
import { STATE_FILTERS } from "./mock-data";

describe("state filters", () => {
  it("offers DC geography for discovered local sources without adding a state crawler", () => {
    expect(STATE_FILTERS.find((filter) => filter.stateCode === "DC"))
      .toMatchObject({ stateCode: "DC", label: "District of Columbia (DC)" });
    expect(STATE_CRAWLER_SOURCE_DEFINITIONS).toHaveLength(50);
  });

  it("exposes federal plus all 50 states and DC geography", () => {
    const stateFilters = STATE_FILTERS.filter((filter) => filter.issuerType === "state");

    expect(STATE_FILTERS[0]).toMatchObject({
      id: "sam",
      label: "Federal (SAM.gov)",
      stateCode: "US",
      issuerType: "federal",
    });
    expect(stateFilters).toHaveLength(51);
    expect(stateFilters.map((filter) => filter.stateCode).sort()).toEqual(
      [...STATE_CRAWLER_SOURCE_DEFINITIONS.map((source) => source.stateCode), "DC"].sort(),
    );
    expect(stateFilters.every((filter) => filter.id === filter.stateCode.toLowerCase())).toBe(true);
    expect(stateFilters.find((filter) => filter.stateCode === "AL")?.label).toBe("Alabama (AL)");
    expect(stateFilters.find((filter) => filter.stateCode === "WY")?.label).toBe("Wyoming (WY)");
  });
});
