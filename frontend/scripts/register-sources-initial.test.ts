import { readFileSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import { type SourceCandidate, registerSources, validateCandidate } from "./register-sources";
import { listCrawlableSources } from "@/server/crawler/source-registry";

describe("initial BidNet county/city source registration", () => {
  let testDb: TestDatabase;
  let candidates: SourceCandidate[];

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    const jsonPath = path.join(__dirname, "../data/seed-sources/bidnet-counties-initial.json");
    candidates = JSON.parse(readFileSync(jsonPath, "utf-8"));
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("validates all 10 candidates without errors", () => {
    for (const c of candidates) {
      expect(validateCandidate(c)).toEqual([]);
    }
  });

  it("registers all 10 sources with correct metadata", () => {
    const result = registerSources(testDb.db, candidates, "2026-07-31T00:00:00.000Z");
    expect(result.inserted).toBe(10);
    expect(result.errors).toHaveLength(0);

    const rows = testDb.db.select().from(dataSources).all();
    expect(rows).toHaveLength(10);

    const counties = rows.filter((r) => r.jurisdictionLevel === "county");
    const cities = rows.filter((r) => r.jurisdictionLevel === "city");
    expect(counties).toHaveLength(8);
    expect(cities).toHaveLength(2);
  });

  it("newly registered county/city sources are NOT crawlable until approved (governance gate)", () => {
    registerSources(testDb.db, candidates, "2026-07-31T00:00:00.000Z");
    const crawlable = listCrawlableSources(testDb.db);
    expect(crawlable).toHaveLength(0);
  });

  it("becomes crawlable after admin approval", () => {
    registerSources(testDb.db, candidates, "2026-07-31T00:00:00.000Z");

    // Approve one source
    testDb.db.update(dataSources)
      .set({ approvalStatus: "approved", approvedForIngestion: 1 })
      .where(eq(dataSources.id, "bidnet_co_denver"))
      .run();

    const crawlable = listCrawlableSources(testDb.db);
    expect(crawlable).toHaveLength(1);
    expect(crawlable[0].id).toBe("bidnet_co_denver");
    expect(crawlable[0].providerFamily).toBe("bidnet");
    expect(crawlable[0].jurisdictionLevel).toBe("county");
    expect(crawlable[0].fetchConfig).toEqual({
      base_url: "https://www.bidnetdirect.com/denver-county/solicitations/open-bids",
    });
  });
});
