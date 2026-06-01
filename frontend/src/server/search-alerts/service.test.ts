import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { recordSearchAlertDigestRun } from "./digest-history";
import {
  createSearchAlert,
  createSearchAlertFromMysql,
  deleteSearchAlert,
  deleteSearchAlertFromMysql,
  listSearchAlerts,
  listSearchAlertsFromMysql,
  updateSearchAlert,
  updateSearchAlertFromMysql,
} from "./service";

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

  it("runs the MySQL alert create/list/update/delete lifecycle", async () => {
    const rowsByAlertId = new Map<string, Record<string, unknown>>();
    const mysql = {
      execute: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("INSERT INTO users")) return [{ affectedRows: 1 }, []];
        if (sql.includes("INSERT INTO alerts")) {
          rowsByAlertId.set(values[0] as string, {
            id: values[0],
            userId: values[1],
            name: values[2],
            query: values[3],
            states: values[4],
            issuerType: values[5],
            deadlinePreset: values[6],
            publishedPreset: values[7],
            frequency: values[8],
            isEnabled: values[9],
            lastMatchedAt: null,
            lastNotifiedAt: null,
            createdAt: values[10],
            updatedAt: values[11],
          });
        }
        if (sql.includes("UPDATE alerts")) {
          const existing = rowsByAlertId.get(values.at(-1) as string);
          if (existing) {
            existing.name = values[0];
            existing.isEnabled = values[6];
            existing.updatedAt = values[7];
          }
        }
        if (sql.includes("DELETE FROM alerts")) {
          rowsByAlertId.delete(values[1] as string);
        }
        return [{ affectedRows: 1 }, []];
      }),
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("FROM alerts") && sql.includes("WHERE user_id = ? AND id = ?")) {
          const row = rowsByAlertId.get(values[1] as string);
          return [[row && row.userId === values[0] ? row : undefined].filter(Boolean), []];
        }
        if (sql.includes("FROM alerts") && sql.includes("WHERE user_id = ?")) {
          return [[...rowsByAlertId.values()].filter((row) => row.userId === values[0]), []];
        }
        return [[], []];
      }),
    };

    const created = await createSearchAlertFromMysql(mysql, "user_mysql", {
      name: "Cloud bids",
      query: { q: "cloud", states: ["CA"], issuerType: "state", deadline: "next7" },
      frequency: "daily",
      isEnabled: true,
    });
    const updated = await updateSearchAlertFromMysql(mysql, "user_mysql", created.id, {
      name: "Cloud bids updated",
      isEnabled: false,
    });

    expect((await listSearchAlertsFromMysql(mysql, "user_mysql")).map((alert) => alert.id)).toEqual([created.id]);
    expect(updated).toMatchObject({
      id: created.id,
      name: "Cloud bids updated",
      isEnabled: false,
    });

    await expect(deleteSearchAlertFromMysql(mysql, "user_other", created.id)).rejects.toThrow(
      "Search alert not found",
    );
    await deleteSearchAlertFromMysql(mysql, "user_mysql", created.id);
    await expect(listSearchAlertsFromMysql(mysql, "user_mysql")).resolves.toEqual([]);
  });
});
