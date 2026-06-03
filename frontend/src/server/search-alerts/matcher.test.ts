import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryBidsFromMysql } from "@/server/bids/service";
import { alerts } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { matchEnabledSearchAlerts, matchEnabledSearchAlertsFromMysql } from "./matcher";

vi.mock("@/server/bids/service", async () => {
  const actual = await vi.importActual<typeof import("@/server/bids/service")>("@/server/bids/service");
  return {
    ...actual,
    queryBidsFromMysql: vi.fn(),
  };
});

const mockedQueryBidsFromMysql = vi.mocked(queryBidsFromMysql);

describe("search alert matcher", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: true });
    mockedQueryBidsFromMysql.mockReset();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("updates lastMatchedAt for enabled alerts with matching bids", async () => {
    testDb.db
      .insert(alerts)
      .values({
        id: "alert_cloud",
        userId: "anon_seed",
        name: "Cloud alerts",
        query: JSON.stringify({ q: "cloud", issuerType: "federal", sort: "relevance" }),
        frequency: "daily",
        isEnabled: 1,
        createdAt: "2026-05-19T00:00:00.000Z",
        updatedAt: "2026-05-19T00:00:00.000Z",
      })
      .run();

    const result = await matchEnabledSearchAlerts(testDb.db, {
      referenceDate: new Date("2026-05-19T00:00:00.000Z"),
      matchedAt: "2026-05-19T12:00:00.000Z",
    });

    const row = testDb.db.select().from(alerts).where(eq(alerts.id, "alert_cloud")).get();
    expect(result).toMatchObject({
      evaluatedAlerts: 1,
      matchedAlerts: 1,
      updatedAlerts: 1,
      matches: [
        expect.objectContaining({
          alertId: "alert_cloud",
          userId: "anon_seed",
          alertName: "Cloud alerts",
          frequency: "daily",
          notificationChannel: "email",
          bidIds: expect.arrayContaining(["1"]),
          query: expect.objectContaining({ q: "cloud", issuerType: "federal", sort: "relevance" }),
        }),
      ],
    });
    expect(result.matches[0]?.bids[0]).toEqual(
      expect.objectContaining({
        id: "1",
        title: expect.any(String),
        sourceUrl: expect.any(String),
      }),
    );
    expect(row?.lastMatchedAt).toBe("2026-05-19T12:00:00.000Z");
    expect(row?.updatedAt).toBe("2026-05-19T12:00:00.000Z");
  });

  it("leaves disabled and non-matching alerts untouched", async () => {
    testDb.db
      .insert(alerts)
      .values([
        {
          id: "alert_disabled",
          userId: "anon_seed",
          name: "Disabled cloud alerts",
          query: JSON.stringify({ q: "cloud" }),
          frequency: "daily",
          isEnabled: 0,
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        },
        {
          id: "alert_none",
          userId: "anon_seed",
          name: "No matches",
          query: JSON.stringify({ q: "quantum submarine" }),
          frequency: "daily",
          isEnabled: 1,
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        },
      ])
      .run();

    const result = await matchEnabledSearchAlerts(testDb.db, {
      referenceDate: new Date("2026-05-19T00:00:00.000Z"),
      matchedAt: "2026-05-19T12:00:00.000Z",
    });

    const disabled = testDb.db.select().from(alerts).where(eq(alerts.id, "alert_disabled")).get();
    const noMatch = testDb.db.select().from(alerts).where(eq(alerts.id, "alert_none")).get();
    expect(result).toEqual({
      evaluatedAlerts: 1,
      matchedAlerts: 0,
      updatedAlerts: 0,
      matches: [],
    });
    expect(disabled?.lastMatchedAt).toBeNull();
    expect(noMatch?.lastMatchedAt).toBeNull();
  });

  it("matches enabled search alerts and updates lastMatchedAt through MySQL", async () => {
    const mysql = createFakeMysqlMatcherStore();
    mockedQueryBidsFromMysql.mockResolvedValue({
      total: 1,
      filters: {
        q: "cloud",
        states: ["CA"],
        issuerType: "state",
        deadline: "any",
        published: "any",
        sort: "relevance",
      },
      bids: [
        {
          id: "mysql_bid_1",
          title: "Cloud modernization",
          description: "Cloud services",
          fullDescription: null,
          originalCategory: null,
          source: "mysql_state",
          sourceBidId: "MYSQL-1",
          issuerName: "California Agency",
          issuerType: "state",
          stateCode: "CA",
          publishedDate: "2026-05-30",
          deadlineDate: "2026-06-30",
          amount: null,
          currency: "USD",
          contactName: null,
          contactEmail: null,
          contactPhone: null,
          sourceUrl: "https://example.com/mysql-bid-1",
          tags: [],
          isActive: true,
          saved: false,
          sourceConfidence: "high",
          qualityFlags: [],
          adminReviewStatus: "unreviewed",
          displayStatus: "visible",
          detailArchiveStatus: "not_archived",
          attachments: [],
        },
      ],
    });

    const result = await matchEnabledSearchAlertsFromMysql(mysql, {
      referenceDate: new Date("2026-06-01T00:00:00.000Z"),
      matchedAt: "2026-06-01T12:00:00.000Z",
    });

    expect(result).toMatchObject({
      evaluatedAlerts: 1,
      matchedAlerts: 1,
      updatedAlerts: 1,
      matches: [
        expect.objectContaining({
          alertId: "alert_mysql",
          userId: "user_mysql",
          alertName: "MySQL Cloud alerts",
          bidIds: ["mysql_bid_1"],
          query: expect.objectContaining({ q: "cloud", states: ["CA"], issuerType: "state" }),
        }),
      ],
    });
    expect(mockedQueryBidsFromMysql).toHaveBeenCalledWith(
      mysql,
      expect.objectContaining({ q: "cloud", states: ["CA"], issuerType: "state" }),
      { referenceDate: new Date("2026-06-01T00:00:00.000Z") },
    );
    expect(mysql.alerts[0].lastMatchedAt).toBe("2026-06-01T12:00:00.000Z");
    expect(mysql.alerts[0].updatedAt).toBe("2026-06-01T12:00:00.000Z");
  });
});

function createFakeMysqlMatcherStore() {
  const alerts = [
    {
      id: "alert_mysql",
      userId: "user_mysql",
      name: "MySQL Cloud alerts",
      query: JSON.stringify({ q: "cloud", states: ["CA"], issuerType: "state", sort: "relevance" }),
      states: JSON.stringify(["CA"]),
      issuerType: "state",
      deadlinePreset: "any",
      publishedPreset: "any",
      frequency: "daily",
      notificationChannel: "email",
      isEnabled: 1,
      lastMatchedAt: null as string | null,
      lastNotifiedAt: null as string | null,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
    {
      id: "alert_disabled_mysql",
      userId: "user_mysql",
      name: "Disabled",
      query: JSON.stringify({ q: "cloud" }),
      states: "[]",
      issuerType: "all",
      deadlinePreset: "any",
      publishedPreset: "any",
      frequency: "daily",
      notificationChannel: "email",
      isEnabled: 0,
      lastMatchedAt: null,
      lastNotifiedAt: null,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
  ];

  return {
    alerts,
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM alerts") && sql.includes("WHERE is_enabled = 1")) {
        return [alerts.filter((alert) => alert.isEnabled === 1), undefined];
      }

      return [[], undefined];
    }),
    execute: vi.fn(async (_sql: string, values: unknown[] = []) => {
      const alert = alerts.find((row) => row.id === values[2]);
      if (alert) {
        alert.lastMatchedAt = String(values[0]);
        alert.updatedAt = String(values[1]);
      }
      return [{ affectedRows: alert ? 1 : 0 }, undefined];
    }),
  };
}
