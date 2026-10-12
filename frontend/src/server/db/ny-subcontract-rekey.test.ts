import { eq } from "drizzle-orm";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { bids, savedBids, users } from "@/server/db/schema";
import { runMigrations } from "@/server/db/migrate";
import { BID_CHILD_REFERENCES, type BidChildReference } from "@/server/db/bid-child-references";

const NOW = "2026-10-13T00:00:00Z";
const SOURCE = "New York State Contract Reporter";
const MARKER = "This is a subcontracting opportunity";
type BidInsert = typeof bids.$inferInsert;

/**
 * A subcontracting card as the spider stored it before it learned the "Company:" label: the company text
 * was glued onto the CR# value, so the id, dedupe key and source bid id all carry it, the card has no
 * Agency (the normalizer's placeholder issuer), and the marker sentence trails the title.
 */
function malformedBid(cr: string, company: string, overrides: Partial<BidInsert> = {}): BidInsert {
  const sourceBidId = `${cr} Company: ${company}`;
  const id = `ny_contract_reporter:${sourceBidId}`;
  return {
    id, source: SOURCE, sourceBidId, dedupeKey: id,
    title: `Empire State Plaza Decarb Plan ${MARKER}`, description: `Empire State Plaza Decarb Plan ${MARKER}`,
    issuerName: "Unknown state agency", issuerType: "state", jurisdictionLevel: null, stateCode: "NY",
    sourceUrl: `https://www.nyscr.ny.gov/Ads/Details/${cr}`, deadlineDate: "9/8/2026",
    rawPayload: JSON.stringify({ source_bid_id: sourceBidId, title: `Empire State Plaza Decarb Plan ${MARKER}` }),
    firstSeenAt: NOW, lastSeenAt: NOW, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}

/** What the fixed spider stores: `ny_contract_reporter:<CR#>`. */
function cleanBid(cr: string, overrides: Partial<BidInsert> = {}): BidInsert {
  const id = `ny_contract_reporter:${cr}`;
  return {
    ...malformedBid(cr, "unused"), id, sourceBidId: cr, dedupeKey: id,
    title: "Empire State Plaza Decarb Plan", description: "A clean row", issuerName: "Pike Construction Services, Inc.",
    ...overrides,
  };
}

/** A row in one of the child tables, filled with dummy values for everything but the reference. */
function insertChildRow(sqlite: Database.Database, { table, column }: BidChildReference, bidId: string) {
  const info = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>;
  const values = new Map<string, string | number>();
  for (const columnInfo of info) {
    if (columnInfo.name === column) values.set(columnInfo.name, bidId);
    else if (columnInfo.pk || (columnInfo.notnull && columnInfo.dflt_value === null)) {
      values.set(columnInfo.name, /INT/i.test(columnInfo.type) ? 0 : `${table}:${bidId}`);
    }
  }
  const names = [...values.keys()];
  sqlite.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(...values.values());
}

describe("NY Contract Reporter subcontracting re-key on SQLite", () => {
  let testDb: TestDatabase;
  const allBids = () => testDb.db.select().from(bids).orderBy(bids.id).all();
  const rowOf = (id: string) => testDb.db.select().from(bids).where(eq(bids.id, id)).get()!;
  const idsOf = () => allBids().map((row) => row.id);

  beforeEach(async () => { testDb = await createTestDatabase({ seed: false }); });
  afterEach(async () => { await testDb.cleanup(); });

  it("re-keys a malformed row that has no clean twin and no children, field by field", () => {
    const row = malformedBid("2138281", "Pike Construction Services, Inc.", { title: `PIKE CS - NYS OGS Empire State Plaza Decarb Plan ${MARKER}` });
    testDb.db.insert(bids).values(row).run();
    const before = rowOf(row.id);

    runMigrations(testDb.db);

    expect(allBids()).toEqual([{
      ...before,
      id: "ny_contract_reporter:2138281", dedupeKey: "ny_contract_reporter:2138281", sourceBidId: "2138281",
      issuerName: "Pike Construction Services, Inc.", title: "PIKE CS - NYS OGS Empire State Plaza Decarb Plan",
    }]);
  });

  it("names the contractor as issuer only where the issuer is blank or a placeholder", () => {
    const cases: Array<[string, string, string]> = [
      ["2000001", "Unknown state agency", "Acme Builders, LLC"],
      ["2000002", "Unknown", "Acme Builders, LLC"],
      ["2000003", "", "Acme Builders, LLC"],
      ["2000004", "Office of General Services", "Office of General Services"],
    ];
    testDb.db.insert(bids).values(cases.map(([cr, issuerName]) => malformedBid(cr, "Acme Builders, LLC", { issuerName }))).run();

    runMigrations(testDb.db);

    for (const [cr, , expected] of cases) {
      expect(rowOf(`ny_contract_reporter:${cr}`).issuerName, cr).toBe(expected);
    }
  });

  it("strips a trailing subcontracting sentence from the title, ignoring case, and trims what is left", () => {
    const cases: Array<[string, string, string]> = [
      ["2100001", `Razran Hall Renovation ${MARKER}`, "Razran Hall Renovation"],
      ["2100002", `Razran Hall Renovation ${MARKER.toUpperCase()}`, "Razran Hall Renovation"],
      ["2100003", `Razran Hall Renovation   ${MARKER.toLowerCase()}  `, "Razran Hall Renovation"],
      ["2100004", "Razran Hall Renovation", "Razran Hall Renovation"],
      // Only a trailing sentence goes: the same words elsewhere in the title stay.
      ["2100005", `${MARKER} for Razran Hall Renovation`, `${MARKER} for Razran Hall Renovation`],
      ["2100006", `Razran Hall ${MARKER} Renovation`, `Razran Hall ${MARKER} Renovation`],
    ];
    testDb.db.insert(bids).values(cases.map(([cr, title]) => malformedBid(cr, "Acme Builders, LLC", { title }))).run();

    runMigrations(testDb.db);

    for (const [cr, , expected] of cases) {
      expect(rowOf(`ny_contract_reporter:${cr}`).title, cr).toBe(expected);
    }
  });

  it("deletes a malformed row whose clean twin already exists and leaves the twin as it is", () => {
    testDb.db.insert(bids).values([malformedBid("2138289", "E.W. Howell Co., LLC."), cleanBid("2138289", { title: "Twin title", updatedAt: "2026-10-12T00:00:00Z" })]).run();
    const twin = rowOf("ny_contract_reporter:2138289");

    runMigrations(testDb.db);

    expect(allBids()).toEqual([twin]);
  });

  it("deletes the second of two malformed rows for one CR# once the first has taken the clean key, and never throws", () => {
    testDb.db.insert(bids).values([malformedBid("2138400", "Dup Builders, LLC"), malformedBid("2138400", "Dup Builders LLC")]).run();

    runMigrations(testDb.db);

    expect(allBids()).toHaveLength(1);
    expect(allBids()[0]).toMatchObject({ id: "ny_contract_reporter:2138400", dedupeKey: "ny_contract_reporter:2138400", sourceBidId: "2138400" });
  });

  it("leaves a malformed row alone while a user has saved it, and keeps the saved bid", () => {
    testDb.db.insert(users).values({ id: "user-1", createdAt: NOW, updatedAt: NOW }).run();
    const row = malformedBid("2138300", "Saver Co");
    testDb.db.insert(bids).values(row).run();
    testDb.db.insert(savedBids).values({ userId: "user-1", bidId: row.id, createdAt: NOW }).run();
    const before = allBids();

    runMigrations(testDb.db);

    expect(allBids()).toEqual(before);
    expect(testDb.db.select().from(savedBids).all()).toEqual([{ userId: "user-1", bidId: row.id, createdAt: NOW }]);
    expect(testDb.db.$client.pragma("foreign_key_check")).toEqual([]);
  });

  it("leaves a malformed row alone while any table points at it, with or without a clean twin", () => {
    const sqlite = testDb.db.$client;
    // The dummy child rows name parents that do not exist, so build them with enforcement off.
    sqlite.pragma("foreign_keys = OFF");
    BID_CHILD_REFERENCES.forEach((reference, index) => {
      const lonely = malformedBid(String(3000 + index), "Lonely Co");
      const twinned = malformedBid(String(4000 + index), "Twinned Co");
      testDb.db.insert(bids).values([lonely, twinned, cleanBid(String(4000 + index))]).run();
      insertChildRow(sqlite, reference, lonely.id);
      insertChildRow(sqlite, reference, twinned.id);
    });
    sqlite.pragma("foreign_keys = ON");
    const before = allBids();
    expect(before).toHaveLength(BID_CHILD_REFERENCES.length * 3);

    runMigrations(testDb.db);

    expect(allBids()).toEqual(before);
    for (const { table, column } of BID_CHILD_REFERENCES) {
      expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} LIKE 'ny_contract_reporter:%'`).get() as { n: number }).n, table).toBe(2);
    }
  });

  it("never touches a clean row or anything that only looks like a malformed one", () => {
    testDb.db.insert(bids).values([
      // Clean rows that would qualify for cleanup if they were malformed.
      cleanBid("2138281", { title: `Razran Hall Renovation ${MARKER}`, issuerName: "Unknown state agency" }),
      cleanBid("2138282"),
      // The marker in another source's id.
      { ...malformedBid("77", "Foo"), id: "bidnet_ny_foo:77 Company: Foo", dedupeKey: "bidnet_ny_foo:77 Company: Foo" },
      // "_" is a LIKE wildcard: a different prefix of the same length must not match.
      { ...malformedBid("78", "Foo"), id: "nyXcontractXreporter:78 Company: Foo", dedupeKey: "nyXcontractXreporter:78 Company: Foo" },
      // The marker's case differs.
      malformedBid("79", "Foo", { sourceBidId: "79 company: Foo", id: "ny_contract_reporter:79 company: Foo", dedupeKey: "ny_contract_reporter:79 company: Foo" }),
      // The id carries the marker but the source bid id does not: not the shape this repair knows.
      malformedBid("80", "Foo", { sourceBidId: "80" }),
      // The id and source bid id disagree.
      malformedBid("81", "Foo", { sourceBidId: "82 Company: Foo" }),
      // The id and source bid id differ only in case.
      malformedBid("83", "Foo", { id: "NY_CONTRACT_REPORTER:83 Company: Foo", dedupeKey: "NY_CONTRACT_REPORTER:83 Company: Foo" }),
      // No CR# before the marker.
      malformedBid("", "Foo"),
    ]).run();
    const before = allBids();

    runMigrations(testDb.db);

    expect(allBids()).toEqual(before);
  });

  it("skips, without throwing, a row whose clean dedupe key or (source, source bid id) another row already holds", () => {
    testDb.db.insert(bids).values([
      malformedBid("500", "Dedupe Clash"),
      { ...cleanBid("501"), id: "elsewhere:1", sourceBidId: "1", dedupeKey: "ny_contract_reporter:500" },
      malformedBid("600", "Source Clash"),
      { ...cleanBid("601"), id: "elsewhere:2", sourceBidId: "600", dedupeKey: "elsewhere:2" },
    ]).run();
    const before = allBids();

    expect(() => runMigrations(testDb.db)).not.toThrow();

    expect(allBids()).toEqual(before);
  });

  it("changes nothing the second time", () => {
    testDb.db.insert(users).values({ id: "user-1", createdAt: NOW, updatedAt: NOW }).run();
    const saved = malformedBid("2138300", "Saver Co");
    testDb.db.insert(bids).values([
      malformedBid("2138281", "Pike Construction Services, Inc."), malformedBid("2138289", "E.W. Howell Co., LLC."), cleanBid("2138289"),
      saved, malformedBid("2138400", "Dup A"), malformedBid("2138400", "Dup B"),
    ]).run();
    testDb.db.insert(savedBids).values({ userId: "user-1", bidId: saved.id, createdAt: NOW }).run();

    runMigrations(testDb.db);
    const afterFirstRun = allBids();
    runMigrations(testDb.db);

    expect(idsOf()).toEqual(["ny_contract_reporter:2138281", "ny_contract_reporter:2138289", "ny_contract_reporter:2138300 Company: Saver Co", "ny_contract_reporter:2138400"]);
    expect(allBids()).toEqual(afterFirstRun);
  });

  it("lists exactly the foreign keys that point at bids", () => {
    const sqlite = testDb.db.$client;
    const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map((row) => row.name);
    const declared = tables.flatMap((table) => (sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{ table: string; from: string }>)
      .filter((foreignKey) => foreignKey.table === "bids").map((foreignKey) => `${table}.${foreignKey.from}`)).sort();

    expect(declared).toHaveLength(17);
    expect(BID_CHILD_REFERENCES.map(({ table, column }) => `${table}.${column}`).sort()).toEqual(declared);
  });
});
