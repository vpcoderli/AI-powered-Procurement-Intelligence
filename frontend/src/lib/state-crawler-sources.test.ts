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
    expect(STATE_CRAWLER_SOURCES.every((source) => source.approvalStatus)).toBe(true);
    expect(STATE_CRAWLER_SOURCES.every((source) => source.accessPattern)).toBe(true);
    expect(STATE_CRAWLER_SOURCES.every((source) => source.legalReviewStatus)).toBe(true);
    expect(STATE_CRAWLER_SOURCES.every((source) => source.sourceOwner)).toBe(true);
  });

  it("defaults verified sources to approved and beta sources to needs review", () => {
    const verifiedSources = STATE_CRAWLER_SOURCES.filter((source) => source.maturity === "verified");
    const betaSources = STATE_CRAWLER_SOURCES.filter((source) => source.maturity === "beta");

    expect(verifiedSources).toHaveLength(5);
    expect(verifiedSources.every((source) => source.approvedForIngestion)).toBe(true);
    expect(verifiedSources.every((source) => source.approvalStatus === "approved")).toBe(true);
    expect(verifiedSources.every((source) => source.legalReviewStatus === "approved_public")).toBe(true);
    expect(betaSources).toHaveLength(45);
    expect(betaSources.every((source) => !source.approvedForIngestion)).toBe(true);
    expect(betaSources.every((source) => source.approvalStatus === "needs_review")).toBe(true);
    expect(betaSources.every((source) => source.legalReviewStatus === "not_reviewed")).toBe(true);
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
      capabilities: expect.arrayContaining(["query", "detail_pages", "pagination"]),
    });
    expect(getStateCrawlerSourceMetadata("MA")).toMatchObject({
      id: "ma_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "attachments"]),
    });
    expect(getStateCrawlerSourceMetadata("NJ")).toMatchObject({
      id: "nj_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "attachments"]),
    });
    expect(getStateCrawlerSourceMetadata("OH")).toMatchObject({
      id: "oh_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "detail_pages", "pagination"]),
    });
    expect(getStateCrawlerSourceMetadata("VA")).toMatchObject({
      id: "va_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "attachments"]),
    });
    expect(getStateCrawlerSourceMetadata("WA")).toMatchObject({
      id: "wa_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "attachments"]),
    });
    expect(getStateCrawlerSourceMetadata("IA")).toMatchObject({
      id: "ia_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "detail_pages"]),
    });
    expect(getStateCrawlerSourceMetadata("GA")).toMatchObject({
      id: "ga_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "detail_pages"]),
    });
    expect(getStateCrawlerSourceMetadata("ME")).toMatchObject({
      id: "me_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "attachments"]),
    });
    expect(getStateCrawlerSourceMetadata("MO")).toMatchObject({
      id: "mo_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "attachments"]),
    });
    expect(getStateCrawlerSourceMetadata("NV")).toMatchObject({
      id: "nv_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "detail_pages"]),
    });
    expect(getStateCrawlerSourceMetadata("UT")).toMatchObject({
      id: "ut_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "detail_pages"]),
    });
    expect(getStateCrawlerSourceMetadata("KS")).toMatchObject({
      id: "ks_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query"]),
    });
    expect(getStateCrawlerSourceMetadata("MT")).toMatchObject({
      id: "mt_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "detail_pages"]),
    });
    expect(getStateCrawlerSourceMetadata("NM")).toMatchObject({
      id: "nm_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query"]),
    });
    expect(getStateCrawlerSourceMetadata("CO")).toMatchObject({
      id: "co_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "detail_pages", "pagination"]),
    });
    expect(getStateCrawlerSourceMetadata("IN")).toMatchObject({
      id: "in_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "attachments"]),
    });
    expect(getStateCrawlerSourceMetadata("MS")).toMatchObject({
      id: "ms_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "attachments", "detail_pages"]),
    });
    expect(getStateCrawlerSourceMetadata("CT")).toMatchObject({
      id: "ct_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "detail_pages", "pagination"]),
    });
    expect(getStateCrawlerSourceMetadata("OK")).toMatchObject({
      id: "ok_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query"]),
    });
    expect(getStateCrawlerSourceMetadata("AR")).toMatchObject({
      id: "ar_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "detail_pages"]),
    });
    expect(getStateCrawlerSourceMetadata("SD")).toMatchObject({
      id: "sd_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "detail_pages", "pagination"]),
    });
    expect(getStateCrawlerSourceMetadata("WV")).toMatchObject({
      id: "wv_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "detail_pages", "pagination"]),
    });
    expect(getStateCrawlerSourceMetadata("WY")).toMatchObject({
      id: "wy_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query"]),
    });
    for (const stateCode of ["AL", "AK", "HI", "KY", "MN", "WI", "NH"]) {
      expect(getStateCrawlerSourceMetadata(stateCode)).toMatchObject({
        adapterKind: "dedicated",
        maturity: "beta",
        capabilities: expect.arrayContaining(["query", "detail_pages", "pagination"]),
      });
    }
    for (const stateCode of ["DE", "RI"]) {
      expect(getStateCrawlerSourceMetadata(stateCode)).toMatchObject({
        adapterKind: "dedicated",
        maturity: "beta",
        capabilities: expect.arrayContaining(["query", "detail_pages", "pagination"]),
      });
    }
    expect(getStateCrawlerSourceMetadata("TN")).toMatchObject({
      id: "tn_state_procurement",
      adapterKind: "dedicated",
      maturity: "beta",
      capabilities: expect.arrayContaining(["query", "detail_pages"]),
    });
    for (const stateCode of ["AZ", "ID", "LA", "MD", "NE", "NC", "ND", "VT", "MI"]) {
      expect(getStateCrawlerSourceMetadata(stateCode)).toMatchObject({
        adapterKind: "dedicated",
        maturity: "beta",
        capabilities: expect.arrayContaining(["query", "detail_pages", "pagination"]),
      });
    }
    expect(getStateCrawlerSourceMetadata("US")).toBeNull();
  });
});
