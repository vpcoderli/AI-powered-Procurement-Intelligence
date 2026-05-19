import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bidAttachments, bids, dataSources } from "./schema";
import { seedDatabase } from "./seed";
import { createTestDatabase, type TestDatabase } from "./test-utils";

describe("database seed", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: true });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("is count-idempotent and converges changed seed fields", async () => {
    testDb.db
      .update(bids)
      .set({
        title: "Stale title",
        amount: "$1",
        issuerName: "STALE ISSUER",
        sourceUrl: "https://stale.example.test",
      })
      .where(eq(bids.id, "1"))
      .run();
    testDb.db
      .update(dataSources)
      .set({ label: "Stale source", baseUrl: "https://stale.example.test" })
      .where(eq(dataSources.id, "sam_gov"))
      .run();

    await seedDatabase(testDb.db);

    const bidRows = testDb.db.select().from(bids).all();
    const [bid] = testDb.db.select().from(bids).where(eq(bids.id, "1")).all();
    const [source] = testDb.db.select().from(dataSources).where(eq(dataSources.id, "sam_gov")).all();

    expect(bidRows).toHaveLength(6);
    expect(bid.title).toBe("Enterprise Cloud Migration Services");
    expect(bid.amount).toBe("$5M - $10M");
    expect(bid.issuerName).toBe("Department of Defense");
    expect(bid.sourceUrl).toBe("https://sam.gov/opp/12345");
    expect(source.label).toBe("SAM.gov");
    expect(source.baseUrl).toBe("https://sam.gov/opp/12345");
  });

  it("converges seeded attachment ids across repeated runs", async () => {
    await seedDatabase(testDb.db);

    const firstRunAttachments = testDb.db
      .select()
      .from(bidAttachments)
      .orderBy(bidAttachments.bidId, bidAttachments.sortOrder)
      .all();

    await seedDatabase(testDb.db);

    const secondRunAttachments = testDb.db
      .select()
      .from(bidAttachments)
      .orderBy(bidAttachments.bidId, bidAttachments.sortOrder)
      .all();

    expect(firstRunAttachments).toHaveLength(8);
    expect(secondRunAttachments.map((attachment) => attachment.id)).toEqual(
      firstRunAttachments.map((attachment) => attachment.id),
    );
  });
});
