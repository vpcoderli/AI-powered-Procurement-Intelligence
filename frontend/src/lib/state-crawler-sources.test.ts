import { describe, expect, it } from "vitest";
import {
  getStateCrawlerSourceMetadata,
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
    expect(STATE_CRAWLER_SOURCES.every((source) => source.adapterKind)).toBe(true);
    expect(STATE_CRAWLER_SOURCES.every((source) => source.maturity)).toBe(true);
    expect(STATE_CRAWLER_SOURCES.every((source) => source.capabilities.length > 0)).toBe(true);
  });

  it("does not map federal sources", () => {
    expect(stateCrawlerSourceIdForAdminSource({ issuerType: "federal", stateCode: "US" })).toBeNull();
  });

  it("marks dedicated adapters separately from generic state crawlers", () => {
    expect(getStateCrawlerSourceMetadata("CA")).toMatchObject({
      id: "ca_caleprocure",
      adapterKind: "dedicated",
      maturity: "verified",
      capabilities: expect.arrayContaining(["query", "pagination"]),
    });
    expect(getStateCrawlerSourceMetadata("IL")).toMatchObject({
      id: "il_bidbuy",
      adapterKind: "dedicated",
      maturity: "verified",
      capabilities: expect.arrayContaining(["query", "attachments", "detail_pages"]),
    });
    expect(getStateCrawlerSourceMetadata("OR")).toMatchObject({
      id: "or_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "attachments"]),
    });
    expect(getStateCrawlerSourceMetadata("PA")).toMatchObject({
      id: "pa_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "attachments"]),
    });
    expect(getStateCrawlerSourceMetadata("SC")).toMatchObject({
      id: "sc_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "attachments"]),
    });
    expect(getStateCrawlerSourceMetadata("WA")).toMatchObject({
      id: "wa_state_procurement",
      adapterKind: "generic",
      maturity: "generic",
      capabilities: ["query"],
    });
    expect(getStateCrawlerSourceMetadata("US")).toBeNull();
  });
});
