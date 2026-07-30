import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../src/server/db/test-utils";
import { dataSources } from "../src/server/db/schema";
import { buildSourceRegistryRows, upsertSourceRegistry } from "./migrate-source-registry";

const NOW = "2026-07-29T00:00:00.000Z";

describe("buildSourceRegistryRows", () => {
  it("produces one row per state source with a FIPS code", () => {
    const rows = buildSourceRegistryRows();
    expect(rows).toHaveLength(50);
    for (const row of rows) {
      expect(row.jurisdictionLevel).toBe("state");
      expect(row.fipsCode).toMatch(/^\d{2}$/);
      expect(JSON.parse(row.fetchConfig).base_url).toBeTruthy();
    }
  });

  it("maps California to FIPS 06", () => {
    const california = buildSourceRegistryRows().find((row) => row.id === "ca_caleprocure");
    expect(california?.fipsCode).toBe("06");
  });

  it("classifies a BidNet-fallback state by source id, not by base_url", () => {
    // al_state_procurement's base_url is purchasing.alabama.gov (the official portal),
    // never bidnetdirect.com, because the crawler falls back to a BidNet Direct
    // aggregator page for this state while still recording the official URL. A
    // URL-regex classifier would misclassify it as "generic" and route it to the
    // wrong adapter; this pins the id-based classification instead.
    const alabama = buildSourceRegistryRows().find((row) => row.id === "al_state_procurement");
    expect(alabama?.baseUrl).not.toMatch(/bidnetdirect\.com/i);
    expect(alabama?.providerFamily).toBe("bidnet");
  });

  it("assigns provider_family counts matching the canonical dedicated/BidNet/generic split", () => {
    const rows = buildSourceRegistryRows();
    const counts = rows.reduce<Record<string, number>>((acc, row) => {
      const key = row.providerFamily ?? "null";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

    expect(counts.null).toBe(5); // dedicated adapters: ca_caleprocure, tx_esbd, ny_contract_reporter, fl_mfmp, il_bidbuy
    expect(counts.bidnet).toBe(19); // BIDNET_FALLBACK_SOURCE_IDS
    expect(counts.generic).toBe(26); // remaining states (50 - 5 - 19)
  });
});

describe("upsertSourceRegistry", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("inserts rows on first run", () => {
    upsertSourceRegistry(testDb.db, buildSourceRegistryRows(), NOW);
    const rows = testDb.db.select().from(dataSources).all();
    expect(rows).toHaveLength(50);
  });

  it("is idempotent across repeated runs", () => {
    const rows = buildSourceRegistryRows();
    upsertSourceRegistry(testDb.db, rows, NOW);
    upsertSourceRegistry(testDb.db, rows, NOW);
    expect(testDb.db.select().from(dataSources).all()).toHaveLength(50);
  });

  it("never overwrites human governance sign-off", () => {
    const rows = buildSourceRegistryRows();
    upsertSourceRegistry(testDb.db, rows, NOW);

    testDb.db
      .update(dataSources)
      .set({ approvalStatus: "approved", legalReviewStatus: "approved_public", complianceReviewer: "legal@apsi" })
      .where(eq(dataSources.id, "ca_caleprocure"))
      .run();

    upsertSourceRegistry(testDb.db, rows, "2026-08-01T00:00:00.000Z");

    const row = testDb.db.select().from(dataSources).where(eq(dataSources.id, "ca_caleprocure")).get();
    expect(row?.approvalStatus).toBe("approved");
    expect(row?.legalReviewStatus).toBe("approved_public");
    expect(row?.complianceReviewer).toBe("legal@apsi");
  });
});
