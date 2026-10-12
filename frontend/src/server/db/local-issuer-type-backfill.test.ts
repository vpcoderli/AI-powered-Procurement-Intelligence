import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type AppDatabase } from "@/server/db/client";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { bids, dataSources } from "@/server/db/schema";
import { runMigrations } from "@/server/db/migrate";
import { getBidByIdFromRepository, listBids } from "@/server/bids/repository";

const NOW = "2026-10-01T00:00:00Z";
const sources = [
  { id: "bidnet_co_boulder", label: "Boulder County, CO (BidNet)", issuerType: "county", jurisdictionLevel: "county", stateCode: "CO", fipsCode: "08013", createdAt: NOW, updatedAt: NOW },
  { id: "bidnet_co_city_aurora", label: "City of Aurora, CO (BidNet)", issuerType: "city", jurisdictionLevel: "city", stateCode: "CO", fipsCode: "0804000", createdAt: NOW, updatedAt: NOW },
  { id: "bidnet_mi_canton_township", label: "Canton Township, MI (BidNet)", issuerType: "township", jurisdictionLevel: "township", stateCode: "MI", fipsCode: "2616312860", createdAt: NOW, updatedAt: NOW },
  { id: "co_state", label: "Colorado State Procurement", issuerType: "state", jurisdictionLevel: "state", stateCode: "CO", fipsCode: "08", createdAt: NOW, updatedAt: NOW },
  { id: "bidnet_co_city_boulder", label: "City of Boulder, CO (BidNet)", issuerType: "city", jurisdictionLevel: "city", stateCode: "CO", fipsCode: "0807850", createdAt: NOW, updatedAt: NOW },
  // A special district may have no GEOID at all, or an empty one.
  { id: "bidnet_co_metro_water", label: "Metro Water District, CO (BidNet)", issuerType: "special_district", jurisdictionLevel: "special_district", stateCode: "CO", fipsCode: null, createdAt: NOW, updatedAt: NOW },
  { id: "bidnet_co_fire_district", label: "Fire Protection District, CO (BidNet)", issuerType: "special_district", jurisdictionLevel: "special_district", stateCode: "CO", fipsCode: "", createdAt: NOW, updatedAt: NOW },
];

/** The shape every county/city/township bid was stored in before the data-usability change. */
function legacyBid(id: string, overrides: Partial<typeof bids.$inferInsert> = {}) {
  const sourceBidId = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  return {
    id, source: "Boulder County, CO (BidNet)", sourceBidId, dedupeKey: id,
    title: "Road repairs", description: "Resurface county roads and provide traffic management.",
    issuerName: "Boulder County", issuerType: "state", jurisdictionLevel: "county", stateCode: "CO", fipsCode: "08013",
    sourceUrl: `https://www.bidnetdirect.com/colorado/bouldercounty/bid/${sourceBidId}`,
    firstSeenAt: NOW, lastSeenAt: NOW, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}

describe("legacy local issuer_type backfill on SQLite", () => {
  let testDb: TestDatabase;
  const issuerTypes = () => Object.fromEntries(testDb.db.select({ id: bids.id, issuerType: bids.issuerType }).from(bids).all()
    .map((row) => [row.id, row.issuerType]));

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(dataSources).values(sources).run();
  });
  afterEach(async () => { await testDb.cleanup(); });

  it("makes open, closed and township legacy rows publishable again", async () => {
    testDb.db.insert(bids).values([
      legacyBid("bidnet_co_boulder:open"),
      legacyBid("bidnet_co_boulder:closed", { lifecycleStatus: "closed", isActive: 0 }),
      legacyBid("bidnet_mi_canton_township:7", {
        source: "Canton Township, MI (BidNet)", issuerName: "Canton Township", jurisdictionLevel: "township",
        stateCode: "MI", fipsCode: "2616312860", sourceUrl: "https://www.bidnetdirect.com/michigan/cantontownship/bid/7",
      }),
    ]).run();
    expect(await listBids(testDb.db)).toEqual([]);

    runMigrations(testDb.db);

    expect((await listBids(testDb.db)).map((bid) => bid.id)).toEqual([
      "bidnet_co_boulder:closed", "bidnet_co_boulder:open", "bidnet_mi_canton_township:7",
    ]);
    expect(await getBidByIdFromRepository(testDb.db, "bidnet_co_boulder:closed")).toBeDefined();
    expect(issuerTypes()).toEqual({
      "bidnet_co_boulder:open": "county", "bidnet_co_boulder:closed": "county", "bidnet_mi_canton_township:7": "township",
    });
  });

  it("re-types what it can attribute to a registered local source, changes nothing else, and is idempotent", () => {
    testDb.db.insert(bids).values([
      legacyBid("bidnet_co_boulder:open"),
      legacyBid("co_state:1", { source: "Colorado State Procurement", issuerName: "State of Colorado", jurisdictionLevel: "state", fipsCode: "08" }),
      legacyBid("unknown_portal:1"),
      legacyBid("bidnet_co_boulder:conflict", { jurisdictionLevel: "city" }),
      legacyBid("bidnet_co_boulder:elsewhere", { stateCode: "WY" }),
      legacyBid("legacy-without-namespace"),
      // The stored FIPS disagrees with the source's. The first statement leaves it alone (re-typing alone would make
      // the row core-valid while its FIPS still contradicts the source, and the importer's identity check would then
      // quarantine every corrected re-crawl); the FIPS-drift statement then aligns both together.
      legacyBid("bidnet_co_boulder:drift", { fipsCode: "08014", rawPayload: JSON.stringify({ detail_access: "locked" }) }),
      // Missing optional identity fields (the gate does not count them as a conflict) still attribute.
      legacyBid("bidnet_co_boulder:nulllevel", { jurisdictionLevel: null }),
      legacyBid("bidnet_co_boulder:blanklevel", { jurisdictionLevel: "" }),
      legacyBid("bidnet_co_boulder:nullfips", { fipsCode: null }),
      legacyBid("bidnet_co_boulder:blankfips", { fipsCode: "" }),
      // State codes compare exactly: a differently-cased code is left alone, like drifted FIPS, because the importer's identity check would quarantine every corrected re-crawl.
      legacyBid("bidnet_co_boulder:lowercase", { stateCode: "co" }),
      // Every local level, including sources without a usable GEOID (the bids keep theirs).
      legacyBid("bidnet_co_city_boulder:1", {
        source: "City of Boulder, CO (BidNet)", issuerName: "City of Boulder", jurisdictionLevel: "city", fipsCode: "0807850",
        sourceUrl: "https://www.bidnetdirect.com/colorado/city-of-boulder/bid/1",
      }),
      legacyBid("bidnet_co_metro_water:1", {
        source: "Metro Water District, CO (BidNet)", issuerName: "Metro Water District", jurisdictionLevel: "special_district",
        sourceUrl: "https://www.bidnetdirect.com/colorado/metro-water-district/bid/1",
      }),
      legacyBid("bidnet_co_fire_district:1", {
        source: "Fire Protection District, CO (BidNet)", issuerName: "Fire Protection District", jurisdictionLevel: "special_district",
        sourceUrl: "https://www.bidnetdirect.com/colorado/fire-protection-district/bid/1",
      }),
    ]).run();

    runMigrations(testDb.db);
    const afterFirstRun = testDb.db.select().from(bids).all();
    runMigrations(testDb.db);

    expect(issuerTypes()).toEqual({
      "bidnet_co_boulder:open": "county", "co_state:1": "state", "unknown_portal:1": "state",
      "bidnet_co_boulder:conflict": "state", "bidnet_co_boulder:elsewhere": "state", "legacy-without-namespace": "state",
      "bidnet_co_boulder:drift": "county",
      "bidnet_co_boulder:nulllevel": "county", "bidnet_co_boulder:blanklevel": "county",
      "bidnet_co_boulder:nullfips": "county", "bidnet_co_boulder:blankfips": "county", "bidnet_co_boulder:lowercase": "state",
      "bidnet_co_city_boulder:1": "city", "bidnet_co_metro_water:1": "special_district", "bidnet_co_fire_district:1": "special_district",
    });
    expect(testDb.db.select().from(bids).all()).toEqual(afterFirstRun);
  });
});

/** A row the earlier backfill skipped only because its stored FIPS is stale: everything else matches its source. */
describe("legacy FIPS drift correction on SQLite", () => {
  let testDb: TestDatabase;
  const rowOf = (id: string) => testDb.db.select().from(bids).where(eq(bids.id, id)).get()!;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(dataSources).values(sources).run();
  });
  afterEach(async () => { await testDb.cleanup(); });

  it("gives the row its source's level and FIPS and keeps the old FIPS under raw_payload.legacy_fips_code", () => {
    testDb.db.insert(bids).values(legacyBid("bidnet_co_boulder:drift", {
      fipsCode: "08014", rawPayload: JSON.stringify({ detail_access: "locked", nested: { keep: [1, 2] } }),
    })).run();
    const before = rowOf("bidnet_co_boulder:drift");

    runMigrations(testDb.db);

    const after = rowOf("bidnet_co_boulder:drift");
    expect(after.issuerType).toBe("county");
    expect(after.fipsCode).toBe("08013");
    expect(JSON.parse(after.rawPayload!)).toEqual({ detail_access: "locked", nested: { keep: [1, 2] }, legacy_fips_code: "08014" });
    // Nothing else about the row moves.
    expect(after).toEqual({ ...before, issuerType: "county", fipsCode: "08013", rawPayload: after.rawPayload });
  });

  it("corrects level and FIPS but leaves raw_payload alone when it is not a JSON object", () => {
    const payloads: Record<string, string | null> = {
      "bidnet_co_boulder:text": "not json {", "bidnet_co_boulder:array": "[1,2,3]", "bidnet_co_boulder:scalar": "42",
      "bidnet_co_boulder:string": "\"just text\"", "bidnet_co_boulder:empty": "", "bidnet_co_boulder:null": null,
    };
    testDb.db.insert(bids).values(Object.entries(payloads).map(([id, rawPayload]) => legacyBid(id, { fipsCode: "08014", rawPayload }))).run();

    runMigrations(testDb.db);

    for (const [id, rawPayload] of Object.entries(payloads)) {
      expect(rowOf(id), id).toMatchObject({ issuerType: "county", fipsCode: "08013", rawPayload });
    }
  });

  it("leaves a drifted row as it is when anything else disagrees with its source", () => {
    const ids = ["bidnet_co_boulder:lowercase", "bidnet_co_boulder:conflict", "bidnet_co_boulder:elsewhere", "unknown_portal:1", "co_state:1"];
    // (source, source_bid_id) is unique, and unknown_portal:1 and co_state:1 share source_bid_id "1".
    const overrides: Array<Partial<typeof bids.$inferInsert>> = [
      { stateCode: "co" }, { jurisdictionLevel: "city" }, { stateCode: "WY" }, {},
      { source: "Colorado State Procurement", jurisdictionLevel: "state" },
    ];
    testDb.db.insert(bids).values(ids.map((id, index) => legacyBid(id, {
      fipsCode: "08014", rawPayload: JSON.stringify({ k: id }), ...overrides[index],
    }))).run();
    const before = testDb.db.select().from(bids).all();

    runMigrations(testDb.db);

    expect(testDb.db.select().from(bids).all()).toEqual(before);
  });

  it("never fills in a FIPS the row does not have, and never touches a row that already matches its source", () => {
    testDb.db.insert(bids).values([
      legacyBid("bidnet_co_boulder:nullfips", { fipsCode: null, rawPayload: "{}" }),
      legacyBid("bidnet_co_boulder:blankfips", { fipsCode: "", rawPayload: "{}" }),
      legacyBid("bidnet_co_boulder:match", { fipsCode: "08013", rawPayload: "{}" }),
      // Already local: not the backfill's business, even though its FIPS differs from the source's.
      legacyBid("bidnet_co_boulder:already-county", { issuerType: "county", fipsCode: "08014", rawPayload: "{}" }),
    ]).run();

    runMigrations(testDb.db);

    expect(rowOf("bidnet_co_boulder:nullfips")).toMatchObject({ issuerType: "county", fipsCode: null, rawPayload: "{}" });
    expect(rowOf("bidnet_co_boulder:blankfips")).toMatchObject({ issuerType: "county", fipsCode: "", rawPayload: "{}" });
    expect(rowOf("bidnet_co_boulder:match")).toMatchObject({ issuerType: "county", fipsCode: "08013", rawPayload: "{}" });
    expect(rowOf("bidnet_co_boulder:already-county")).toMatchObject({ issuerType: "county", fipsCode: "08014", rawPayload: "{}" });
  });

  it("brings back closed city rows stored under a stale FIPS (the Aurora case) and is idempotent", async () => {
    const aurora = (id: string) => legacyBid(`bidnet_co_city_aurora:${id}`, {
      source: "City of Aurora, CO (BidNet)", issuerName: "City of Aurora", jurisdictionLevel: "city", fipsCode: "0803455",
      lifecycleStatus: "closed", isActive: 0, rawPayload: JSON.stringify({ lifecycle: { closed_reason: "delisted" } }),
      sourceUrl: `https://www.bidnetdirect.com/colorado/city-of-aurora/bid/${id}`,
    });
    testDb.db.insert(bids).values([aurora("1"), aurora("2"), aurora("3")]).run();
    expect(await listBids(testDb.db)).toEqual([]);

    runMigrations(testDb.db);
    const afterFirstRun = testDb.db.select().from(bids).all();
    runMigrations(testDb.db);

    expect((await listBids(testDb.db)).map((bid) => bid.id).sort()).toEqual([
      "bidnet_co_city_aurora:1", "bidnet_co_city_aurora:2", "bidnet_co_city_aurora:3",
    ]);
    for (const row of afterFirstRun) {
      expect(row).toMatchObject({ issuerType: "city", fipsCode: "0804000", lifecycleStatus: "closed" });
      expect(JSON.parse(row.rawPayload!)).toEqual({ lifecycle: { closed_reason: "delisted" }, legacy_fips_code: "0803455" });
    }
    expect(testDb.db.select().from(bids).all()).toEqual(afterFirstRun);
  });
});

describe("FIPS drift correction on a hand-built legacy bids table", () => {
  let directory: string | undefined;
  let db: AppDatabase | undefined;
  afterEach(async () => {
    db?.$client.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("adds the raw_payload column the correction rewrites, then corrects the row", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "apsi-db-"));
    db = createDatabase(path.join(directory, "apsi.sqlite"));
    // The smallest bids table the migrations are expected to bring forward: no raw_payload, FIPS or jurisdiction columns.
    db.$client.exec(`
      CREATE TABLE bids (
        id TEXT PRIMARY KEY, source TEXT NOT NULL, source_bid_id TEXT, dedupe_key TEXT NOT NULL, title TEXT NOT NULL,
        description TEXT NOT NULL, issuer_name TEXT NOT NULL, issuer_type TEXT NOT NULL, state_code TEXT NOT NULL,
        published_date TEXT, deadline_date TEXT, source_url TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
        first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    db.$client.prepare(
      "INSERT INTO bids (id, source, source_bid_id, dedupe_key, title, description, issuer_name, issuer_type, state_code, source_url, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("bidnet_co_boulder:drift", "Boulder County, CO (BidNet)", "drift", "bidnet_co_boulder:drift", "Road repairs", "Resurface roads.",
      "Boulder County", "state", "CO", "https://www.bidnetdirect.com/colorado/bouldercounty/bid/drift", NOW, NOW, NOW, NOW);

    expect(() => runMigrations(db!)).not.toThrow();
    const columns = (db.$client.prepare("PRAGMA table_info(bids)").all() as Array<{ name: string }>).map((column) => column.name);
    expect(columns).toEqual(expect.arrayContaining(["raw_payload", "fips_code", "jurisdiction_level"]));

    db.$client.exec("UPDATE bids SET fips_code = '08014', jurisdiction_level = 'county'");
    db.insert(dataSources).values(sources[0]).run();
    runMigrations(db);

    expect(db.select({ issuerType: bids.issuerType, fipsCode: bids.fipsCode, rawPayload: bids.rawPayload }).from(bids).all())
      .toEqual([{ issuerType: "county", fipsCode: "08013", rawPayload: null }]);
  });
});
