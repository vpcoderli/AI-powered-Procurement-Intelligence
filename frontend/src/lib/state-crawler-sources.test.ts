import { describe, expect, it } from "vitest";
import {
  STATE_CRAWLER_SOURCE_IDS_BY_STATE,
  STATE_CRAWLER_SOURCES,
  stateCrawlerSourceIdForAdminSource,
} from "./state-crawler-sources";

describe("state crawler source mapping", () => {
  it("maps seeded admin state sources to crawler source ids", () => {
    expect(stateCrawlerSourceIdForAdminSource({ issuerType: "state", stateCode: "CA" })).toBe("ca_caleprocure");
    expect(stateCrawlerSourceIdForAdminSource({ issuerType: "state", stateCode: "TX" })).toBe("tx_esbd");
    expect(stateCrawlerSourceIdForAdminSource({ issuerType: "state", stateCode: "NY" })).toBe("ny_contract_reporter");
    expect(stateCrawlerSourceIdForAdminSource({ issuerType: "state", stateCode: "FL" })).toBe("fl_mfmp");
    expect(stateCrawlerSourceIdForAdminSource({ issuerType: "state", stateCode: "IL" })).toBe("il_bidbuy");
    expect(stateCrawlerSourceIdForAdminSource({ issuerType: "state", stateCode: "WA" })).toBe("wa_state_procurement");
  });

  it("lists crawler metadata for all 50 states", () => {
    expect(STATE_CRAWLER_SOURCES).toHaveLength(50);
    expect(Object.keys(STATE_CRAWLER_SOURCE_IDS_BY_STATE)).toHaveLength(50);
    expect(new Set(STATE_CRAWLER_SOURCES.map((source) => source.stateCode)).size).toBe(50);
    expect(new Set(STATE_CRAWLER_SOURCES.map((source) => source.id)).size).toBe(50);
  });

  it("does not map federal sources", () => {
    expect(stateCrawlerSourceIdForAdminSource({ issuerType: "federal", stateCode: "US" })).toBeNull();
  });
});
