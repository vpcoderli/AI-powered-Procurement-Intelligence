import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../src/server/db/test-utils";
import { dataSources } from "../src/server/db/schema";
import { type SourceCandidate, registerSources, validateCandidate } from "./register-sources";

const NOW = "2026-07-31T00:00:00.000Z";

function candidate(overrides: Partial<SourceCandidate> = {}): SourceCandidate {
  return {
    id: "bidnet_co_denver",
    label: "Denver County (BidNet)",
    issuerType: "county",
    stateCode: "CO",
    baseUrl: "https://www.bidnetdirect.com/denver-county/solicitations/open-bids",
    jurisdictionLevel: "county",
    jurisdictionName: "Denver County",
    fipsCode: "08031",
    providerFamily: "bidnet",
    cadence: "daily",
    fetchConfig: { base_url: "https://www.bidnetdirect.com/denver-county/solicitations/open-bids" },
    ...overrides,
  };
}

describe("validateCandidate", () => {
  it("accepts a valid candidate", () => {
    expect(validateCandidate(candidate())).toEqual([]);
  });

  it("rejects a candidate missing id", () => {
    const errors = validateCandidate(candidate({ id: "" }));
    expect(errors).toContainEqual(expect.stringContaining("id"));
  });

  it("rejects a candidate with invalid jurisdiction_level", () => {
    const errors = validateCandidate(candidate({ jurisdictionLevel: "planet" }));
    expect(errors).toContainEqual(expect.stringContaining("jurisdictionLevel"));
  });
});

describe("registerSources", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("inserts new sources with approval_status = NULL", () => {
    const result = registerSources(testDb.db, [candidate()], NOW);
    expect(result.inserted).toBe(1);

    const rows = testDb.db.select().from(dataSources).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("bidnet_co_denver");
    expect(rows[0].approvalStatus).toBeNull();
    expect(rows[0].jurisdictionLevel).toBe("county");
    expect(rows[0].providerFamily).toBe("bidnet");
    expect(rows[0].cadence).toBe("daily");
  });

  it("updates non-governance fields on conflict", () => {
    registerSources(testDb.db, [candidate()], NOW);
    registerSources(testDb.db, [candidate({ label: "Denver Updated" })], NOW);

    const rows = testDb.db.select().from(dataSources).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Denver Updated");
  });

  it("never overwrites approval_status on upsert", () => {
    registerSources(testDb.db, [candidate()], NOW);

    // Simulate admin manually approving the source
    testDb.db
      .update(dataSources)
      .set({ approvalStatus: "approved" })
      .where(eq(dataSources.id, "bidnet_co_denver"))
      .run();

    registerSources(testDb.db, [candidate({ label: "Denver Updated" })], NOW);

    const rows = testDb.db.select().from(dataSources).all();
    expect(rows[0].approvalStatus).toBe("approved");
  });

  it("handles multiple candidates in one call", () => {
    const candidates = [
      candidate({ id: "bidnet_co_denver" }),
      candidate({ id: "bidnet_ca_la_county", stateCode: "CA", jurisdictionName: "Los Angeles County" }),
    ];
    const result = registerSources(testDb.db, candidates, NOW);
    expect(result.inserted).toBe(2);
  });

  it("skips invalid candidates and reports errors", () => {
    const candidates = [
      candidate({ id: "" }),
      candidate({ id: "bidnet_co_denver" }),
    ];
    const result = registerSources(testDb.db, candidates, NOW);
    expect(result.inserted).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});
