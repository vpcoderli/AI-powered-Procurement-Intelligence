import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { recordSearchAlertDigestRun } from "./digest-history";
import { createSearchAlert, deleteSearchAlert, listSearchAlerts, updateSearchAlert } from "./service";

describe("search alerts service", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: true });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("creates and lists alerts for one user", async () => {
    const created = await createSearchAlert(testDb.db, "anon_a", {
      name: "Cloud bids",
      query: {
        q: "cloud",
        states: ["federal"],
        issuerType: "all",
        deadline: "any",
        published: "any",
        sort: "relevance",
      },
      frequency: "daily",
      isEnabled: true,
    });

    expect(created.name).toBe("Cloud bids");
    expect(created.query.q).toBe("cloud");
    expect(await listSearchAlerts(testDb.db, "anon_a")).toHaveLength(1);
    expect(await listSearchAlerts(testDb.db, "anon_b")).toEqual([]);
  });

  it("hydrates recent digest history for listed alerts", async () => {
    const created = await createSearchAlert(testDb.db, "anon_a", {
      name: "Cloud bids",
      query: {
        q: "cloud",
        states: [],
        issuerType: "all",
        deadline: "any",
        published: "any",
        sort: "relevance",
      },
      frequency: "daily",
      isEnabled: true,
    });
    recordSearchAlertDigestRun(testDb.db, {
      id: "digest_run_1",
      alertId: created.id,
      userId: "anon_a",
      frequency: "daily",
      status: "sent",
      matchCount: 2,
      matchedBidIds: ["bid_1", "bid_2"],
      createdAt: "2026-05-30T00:00:00.000Z",
    });

    const listed = await listSearchAlerts(testDb.db, "anon_a");

    expect(listed[0].digestHistory).toEqual([
      expect.objectContaining({
        id: "digest_run_1",
        status: "sent",
        matchCount: 2,
        matchedBidIds: ["bid_1", "bid_2"],
      }),
    ]);
  });

  it("updates and deletes only the owning user's alert", async () => {
    const created = await createSearchAlert(testDb.db, "anon_a", {
      name: "Cloud bids",
      query: {
        q: "cloud",
        states: [],
        issuerType: "all",
        deadline: "any",
        published: "any",
        sort: "relevance",
      },
      frequency: "daily",
      isEnabled: true,
    });

    await updateSearchAlert(testDb.db, "anon_a", created.id, { isEnabled: false });
    expect((await listSearchAlerts(testDb.db, "anon_a"))[0].isEnabled).toBe(false);

    await expect(deleteSearchAlert(testDb.db, "anon_b", created.id)).rejects.toThrow(
      "Search alert not found",
    );
    await deleteSearchAlert(testDb.db, "anon_a", created.id);
    expect(await listSearchAlerts(testDb.db, "anon_a")).toEqual([]);
  });

  it("keeps digest history on updated alerts", async () => {
    const created = await createSearchAlert(testDb.db, "anon_a", {
      name: "Cloud bids",
      query: {
        q: "cloud",
        states: [],
        issuerType: "all",
        deadline: "any",
        published: "any",
        sort: "relevance",
      },
      frequency: "daily",
      isEnabled: true,
    });
    recordSearchAlertDigestRun(testDb.db, {
      id: "digest_run_1",
      alertId: created.id,
      userId: "anon_a",
      frequency: "daily",
      status: "sent",
      matchCount: 1,
      matchedBidIds: ["bid_1"],
      createdAt: "2026-05-30T00:00:00.000Z",
    });

    const updated = await updateSearchAlert(testDb.db, "anon_a", created.id, { isEnabled: false });

    expect(updated.isEnabled).toBe(false);
    expect(updated.digestHistory).toEqual([
      expect.objectContaining({
        id: "digest_run_1",
        status: "sent",
      }),
    ]);
  });
});
