import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  getBidByIdFromRepository,
  listBids,
  listSavedBidIds,
  removeSavedBidId,
  saveSavedBidId,
} from "./repository";

describe("bid repository", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: true });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("lists seeded bids with per-user saved state", async () => {
    await saveSavedBidId(testDb.db, "anon_a", "1");

    const bids = await listBids(testDb.db, ["1"]);

    expect(bids).toHaveLength(6);
    expect(bids.find((bid) => bid.id === "1")?.saved).toBe(true);
    expect(bids.find((bid) => bid.id === "2")?.saved).toBe(false);
  });

  it("gets a bid with attachments by id", async () => {
    const bid = await getBidByIdFromRepository(testDb.db, "1");

    expect(bid?.title).toBe("Enterprise Cloud Migration Services");
    expect(bid?.attachments.map((attachment) => attachment.name)).toContain(
      "Statement_of_Work_v2.pdf",
    );
  });

  it("persists saved bids per user", async () => {
    await saveSavedBidId(testDb.db, "anon_a", "1");
    await saveSavedBidId(testDb.db, "anon_b", "2");

    expect(await listSavedBidIds(testDb.db, "anon_a")).toEqual(["1"]);
    expect(await listSavedBidIds(testDb.db, "anon_b")).toEqual(["2"]);

    await removeSavedBidId(testDb.db, "anon_a", "1");

    expect(await listSavedBidIds(testDb.db, "anon_a")).toEqual([]);
    expect(await listSavedBidIds(testDb.db, "anon_b")).toEqual(["2"]);
  });
});
