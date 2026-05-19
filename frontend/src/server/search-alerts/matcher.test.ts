import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { alerts } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { matchEnabledSearchAlerts } from "./matcher";

describe("search alert matcher", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: true });
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
});
