import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { bids, dataSources } from "@/server/db/schema";
import { getBidByIdFromMysql, getBidByIdFromRepository, listBids, listBidsFromMysql, type MysqlBidsReader } from "./repository";
import { queryBidsFromDatabase, queryBidsFromMysql } from "./service";
import { createSourceDataQualityReport, createSourceDataQualityReportFromMysql } from "@/server/source-validity/source-data-quality";

const NOW = "2026-10-01T00:00:00Z";
const citySource = { id: "city_source", label: "City Agency", issuerType: "state", jurisdictionLevel: "city", stateCode: "CO", fipsCode: "0816000", createdAt: NOW, updatedAt: NOW };
const stateSource = { id: "state_source", label: "State Agency", issuerType: "state", jurisdictionLevel: "state", stateCode: "CA", fipsCode: "06", createdAt: NOW, updatedAt: NOW };
const opportunity = (overrides: Partial<typeof bids.$inferInsert> = {}) => ({
  id: "city_source:one", source: citySource.label, sourceBidId: "one", dedupeKey: "city_source:one",
  title: "Road repairs", description: "Resurface public roads and provide traffic management.",
  issuerName: "City Agency", issuerType: "city", jurisdictionLevel: "city", stateCode: "CO", fipsCode: "0816000",
  sourceUrl: "https://agency.example.gov/bids/one", firstSeenAt: NOW, lastSeenAt: NOW, createdAt: NOW, updatedAt: NOW,
  ...overrides,
});

describe("registered source identity at public bid reads", () => {
  let testDb: TestDatabase;
  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(dataSources).values([citySource, stateSource]).run();
  });
  afterEach(async () => { await testDb.cleanup(); });

  function mysqlReader() {
    const calls: string[] = [];
    const mysql: MysqlBidsReader = {
      async query(sql: string, values: unknown[] = []): ReturnType<MysqlBidsReader["query"]> {
        calls.push(sql);
        if (sql.includes("FROM data_sources")) return [testDb.db.select().from(dataSources).all()];
        if (sql.includes("FROM bid_attachments")) return [[]];
        const rows = testDb.db.select().from(bids).all();
        return [sql.includes("WHERE id = ?") ? rows.filter((row) => row.id === values[0]) : rows];
      },
    };
    return { mysql, calls };
  }

  it.each(["sqlite", "mysql"])("withholds another source's internally valid geography/type even when its label matches in %s", async (database) => {
    const row = opportunity({ source: stateSource.label, issuerType: "state", jurisdictionLevel: "state", stateCode: "CA", fipsCode: "06" });
    testDb.db.insert(bids).values(row).run();
    const { mysql } = mysqlReader();
    const visible = database === "sqlite" ? await listBids(testDb.db, [row.id]) : await listBidsFromMysql(mysql, [row.id]);
    const detail = database === "sqlite" ? await getBidByIdFromRepository(testDb.db, row.id) : await getBidByIdFromMysql(mysql, row.id);
    const search = database === "sqlite" ? await queryBidsFromDatabase(testDb.db, {}) : await queryBidsFromMysql(mysql, {});
    expect(visible).toEqual([]);
    expect(detail).toBeUndefined();
    expect(search.total).toBe(0);
  });

  it.each(["sqlite", "mysql"])("withholds a valid FIPS belonging to another registered city in %s", async (database) => {
    const row = opportunity({ fipsCode: "0820000" });
    testDb.db.insert(bids).values(row).run();
    const { mysql } = mysqlReader();
    expect(database === "sqlite" ? await listBids(testDb.db) : await listBidsFromMysql(mysql)).toEqual([]);
    expect(database === "sqlite" ? await getBidByIdFromRepository(testDb.db, row.id) : await getBidByIdFromMysql(mysql, row.id)).toBeUndefined();
  });

  it.each(["sqlite", "mysql"])("keeps unique-label legacy records using the explicit city jurisdiction over the broad registered state type in %s", async (database) => {
    const row = opportunity({ id: "legacy_one" });
    testDb.db.insert(bids).values(row).run();
    const { mysql } = mysqlReader();
    const visible = database === "sqlite" ? await listBids(testDb.db) : await listBidsFromMysql(mysql);
    expect(visible.map((bid) => bid.id)).toEqual([row.id]);
    expect(database === "sqlite" ? await getBidByIdFromRepository(testDb.db, row.id) : await getBidByIdFromMysql(mysql, row.id)).toBeDefined();
  });

  it.each(["sqlite", "mysql"])("uses canonical source IDs despite shared labels and withholds ambiguous legacy attribution in %s", async (database) => {
    testDb.db.insert(dataSources).values({ ...stateSource, id: "other_city", label: citySource.label }).run();
    testDb.db.insert(bids).values([opportunity(), opportunity({ id: "legacy_ambiguous", sourceBidId: "ambiguous", dedupeKey: "legacy_ambiguous" })]).run();
    const { mysql } = mysqlReader();
    const visible = database === "sqlite" ? await listBids(testDb.db) : await listBidsFromMysql(mysql);
    expect(visible.map((bid) => bid.id)).toEqual(["city_source:one"]);
  });

  it.each(["sqlite", "mysql"])("agrees with reports on canonical, exact source-ID, ambiguous and unknown attribution in %s", async (database) => {
    testDb.db.insert(dataSources).values({ ...stateSource, id: "other_city", label: citySource.label }).run();
    testDb.db.insert(bids).values([
      opportunity({ source: stateSource.id }),
      opportunity({ id: "legacy_source_id", source: citySource.id, sourceBidId: "source_id", dedupeKey: "legacy_source_id" }),
      opportunity({ id: "legacy_ambiguous", sourceBidId: "ambiguous", dedupeKey: "legacy_ambiguous" }),
      opportunity({ id: "legacy_unknown", source: "Unregistered Agency", sourceBidId: "unknown_one", dedupeKey: "legacy_unknown" }),
    ]).run();
    const { mysql } = mysqlReader();
    const visible = database === "sqlite" ? await listBids(testDb.db) : await listBidsFromMysql(mysql);
    expect(visible.map((bid) => bid.id).sort()).toEqual(["city_source:one", "legacy_source_id", "legacy_unknown"]);
    const report = database === "sqlite" ? await createSourceDataQualityReport(testDb.db, new Date(NOW))
      : await createSourceDataQualityReportFromMysql(mysql, new Date(NOW));
    expect(report.rows.find((row) => row.sourceId === citySource.id)?.stored).toMatchObject({ bidCount: 2, coreInvalidCount: 0, analysisReadyCount: 2 });
    expect(report.rows.find((row) => row.sourceId === stateSource.id)?.stored.bidCount).toBe(0);
    expect(report.unattributedBidCount).toBe(2);
  });

  it.each(["sqlite", "mysql"])("uses trimmed unique labels and folded registration fields without requiring optional FIPS in %s", async (database) => {
    testDb.db.update(dataSources).set({ jurisdictionLevel: "CITY", stateCode: "co" }).where(eq(dataSources.id, citySource.id)).run();
    testDb.db.insert(bids).values(opportunity({ id: "legacy_unique", source: " City Agency ", sourceBidId: "unique", dedupeKey: "legacy_unique",
      jurisdictionLevel: null, fipsCode: null })).run();
    const { mysql } = mysqlReader();
    const visible = database === "sqlite" ? await listBids(testDb.db) : await listBidsFromMysql(mysql);
    expect(visible.map((bid) => bid.id)).toEqual(["legacy_unique"]);
    const report = database === "sqlite" ? await createSourceDataQualityReport(testDb.db, new Date(NOW))
      : await createSourceDataQualityReportFromMysql(mysql, new Date(NOW));
    expect(report.rows.find((row) => row.sourceId === citySource.id)?.stored).toMatchObject({ bidCount: 1, coreInvalidCount: 0, analysisReadyCount: 1 });
    expect(report.unattributedBidCount).toBe(0);
  });

  it("loads MySQL registered identities once for a multi-record read", async () => {
    testDb.db.insert(bids).values(Array.from({ length: 12 }, (_, index) => opportunity({ id: `city_source:${index}`, sourceBidId: String(index), dedupeKey: `city_source:${index}` }))).run();
    const { mysql, calls } = mysqlReader();
    expect(await listBidsFromMysql(mysql)).toHaveLength(12);
    expect(calls.filter((sql) => sql.includes("FROM data_sources"))).toHaveLength(1);
  });

  it("loads SQLite registered identities once for a multi-record read", async () => {
    testDb.db.insert(bids).values(Array.from({ length: 12 }, (_, index) => opportunity({ id: `city_source:${index}`, sourceBidId: String(index), dedupeKey: `city_source:${index}` }))).run();
    const prepare = vi.spyOn(testDb.db.$client, "prepare");
    try {
      expect(await listBids(testDb.db)).toHaveLength(12);
      expect(prepare.mock.calls.filter(([sql]) => sql.includes('"data_sources"'))).toHaveLength(1);
    } finally {
      prepare.mockRestore();
    }
  });
});
