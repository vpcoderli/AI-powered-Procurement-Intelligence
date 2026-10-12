import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { bids, dataSources } from "@/server/db/schema";
import { runMigrations } from "@/server/db/migrate";
import { getBidByIdFromRepository, listBids } from "@/server/bids/repository";

const NOW = "2026-10-01T00:00:00Z";
const sources = [
  { id: "bidnet_co_boulder", label: "Boulder County, CO (BidNet)", issuerType: "county", jurisdictionLevel: "county", stateCode: "CO", fipsCode: "08013", createdAt: NOW, updatedAt: NOW },
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
      // The stored FIPS disagrees with the source's: re-typing would make the row core-valid, and the
      // importer's identity check would then quarantine every corrected re-crawl. Left alone.
      legacyBid("bidnet_co_boulder:drift", { fipsCode: "08014" }),
      // Missing optional identity fields (the gate does not count them as a conflict) still attribute.
      legacyBid("bidnet_co_boulder:nulllevel", { jurisdictionLevel: null }),
      legacyBid("bidnet_co_boulder:blanklevel", { jurisdictionLevel: "" }),
      legacyBid("bidnet_co_boulder:nullfips", { fipsCode: null }),
      legacyBid("bidnet_co_boulder:blankfips", { fipsCode: "" }),
      // State codes compare case-insensitively.
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
      "bidnet_co_boulder:drift": "state",
      "bidnet_co_boulder:nulllevel": "county", "bidnet_co_boulder:blanklevel": "county",
      "bidnet_co_boulder:nullfips": "county", "bidnet_co_boulder:blankfips": "county", "bidnet_co_boulder:lowercase": "county",
      "bidnet_co_city_boulder:1": "city", "bidnet_co_metro_water:1": "special_district", "bidnet_co_fire_district:1": "special_district",
    });
    expect(testDb.db.select().from(bids).all()).toEqual(afterFirstRun);
  });
});
