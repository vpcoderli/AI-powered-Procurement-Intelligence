import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import { listCrawlableSources, listCrawlableSourcesFromMysql } from "./source-registry";

const NOW = "2026-07-29T00:00:00.000Z";

function sourceRow(overrides: Partial<typeof dataSources.$inferInsert> = {}) {
  return {
    id: "ca_caleprocure",
    label: "California Cal eProcure",
    issuerType: "state",
    stateCode: "CA",
    baseUrl: "https://caleprocure.ca.gov",
    isEnabled: 1,
    cadence: "daily",
    approvedForIngestion: 1,
    approvalStatus: "approved",
    legalReviewStatus: "approved_public",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("listCrawlableSources", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("returns approved and enabled sources", () => {
    testDb.db.insert(dataSources).values(sourceRow()).run();
    const sources = listCrawlableSources(testDb.db);
    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe("ca_caleprocure");
    expect(sources[0].cadence).toBe("daily");
    expect(sources[0].consecutiveFailures).toBe(0);
  });

  it("excludes disabled sources", () => {
    testDb.db.insert(dataSources).values(sourceRow({ id: "off", isEnabled: 0 })).run();
    expect(listCrawlableSources(testDb.db)).toHaveLength(0);
  });

  it("excludes sources explicitly denied ingestion", () => {
    testDb.db.insert(dataSources).values(sourceRow({ id: "unapproved", approvedForIngestion: 0 })).run();
    expect(listCrawlableSources(testDb.db)).toHaveLength(0);
  });

  it("includes sources whose governance fields are unset, matching orchestrator semantics", () => {
    // orchestrator.ts blocks only on an EXPLICIT denial: approvedForIngestion === false,
    // a non-approved approvalStatus, or a restricted legalReviewStatus. NULL means
    // "never reviewed", not "denied" — SAM.gov and the seeded sources sit in this state,
    // and excluding them here would silently stop crawling them.
    testDb.db
      .insert(dataSources)
      .values(sourceRow({
        id: "sam_gov",
        issuerType: "federal",
        approvedForIngestion: null,
        approvalStatus: null,
        legalReviewStatus: null,
      }))
      .run();

    const sources = listCrawlableSources(testDb.db);
    expect(sources.map((source) => source.id)).toEqual(["sam_gov"]);
  });

  it("excludes sources whose approval status is not approved", () => {
    testDb.db.insert(dataSources).values(sourceRow({ id: "pending", approvalStatus: "needs_review" })).run();
    expect(listCrawlableSources(testDb.db)).toHaveLength(0);
  });

  it("excludes sources whose legal review has not approved ingestion", () => {
    testDb.db.insert(dataSources).values(sourceRow({ id: "restricted", legalReviewStatus: "restricted" })).run();
    expect(listCrawlableSources(testDb.db)).toHaveLength(0);
  });

  it("parses fetch_config JSON and defaults to an empty object", () => {
    testDb.db
      .insert(dataSources)
      .values(sourceRow({ id: "with_config", fetchConfig: '{"tenant":"acme"}' }))
      .run();
    testDb.db.insert(dataSources).values(sourceRow({ id: "no_config" })).run();

    const byId = new Map(listCrawlableSources(testDb.db).map((source) => [source.id, source]));
    expect(byId.get("with_config")?.fetchConfig).toEqual({ tenant: "acme" });
    expect(byId.get("no_config")?.fetchConfig).toEqual({});
  });

  it("treats malformed fetch_config as an empty object rather than throwing", () => {
    testDb.db.insert(dataSources).values(sourceRow({ id: "broken", fetchConfig: "{not json" })).run();
    expect(listCrawlableSources(testDb.db)[0].fetchConfig).toEqual({});
  });
});

describe("listCrawlableSourcesFromMysql", () => {
  it("maps MySQL rows onto CrawlableSource", async () => {
    const pool = {
      query: async () => [
        [
          {
            id: "tx_esbd",
            label: "Texas ESBD",
            issuerType: "state",
            stateCode: "TX",
            baseUrl: "https://www.txsmartbuy.com",
            cadence: "weekly",
            providerFamily: null,
            jurisdictionLevel: "state",
            jurisdictionName: "Texas",
            fipsCode: "48",
            fetchConfig: '{"tenant":"tx"}',
            lastSuccessAt: "2026-07-01T00:00:00.000Z",
            consecutiveFailures: 2,
          },
        ],
      ] as [unknown[], unknown?],
    };

    const sources = await listCrawlableSourcesFromMysql(pool);
    expect(sources).toHaveLength(1);
    expect(sources[0].fipsCode).toBe("48");
    expect(sources[0].fetchConfig).toEqual({ tenant: "tx" });
    expect(sources[0].consecutiveFailures).toBe(2);
  });
});
