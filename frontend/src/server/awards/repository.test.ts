import { describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "@/server/db/test-utils";
import { intentToBid, organizationMemberships, organizations, users } from "@/server/db/schema";
import {
  findAwardOutcomeRow,
  findAwardOutcomeRowFromMysql,
  upsertAwardOutcomeRow,
  upsertAwardOutcomeRowFromMysql,
  type AwardOutcomeRow,
} from "./repository";

const timestamp = "2026-06-10T00:00:00.000Z";

function row(overrides: Partial<AwardOutcomeRow> = {}): AwardOutcomeRow {
  return {
    id: "award_outcome_1",
    organizationId: "org_awards_1",
    intentId: "intent_awards_1",
    bidId: "1",
    userId: "award_user_1",
    status: "awaiting_award",
    awardNoticeUrl: "",
    tabulationArtifactId: null,
    tabulationArtifactUrl: "",
    winnerName: "",
    awardAmountCents: null,
    currency: "USD",
    lossReason: "unknown",
    lossReasonNotes: "",
    nextAction: "capture_tabulation",
    nextActionDueAt: null,
    notes: "",
    decidedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

async function seedIntent() {
  const testDb = await createTestDatabase({ seed: true });

  testDb.db.insert(users).values({
    id: "award_user_1",
    email: "award-user@example.com",
    createdAt: timestamp,
    updatedAt: timestamp,
  }).run();
  testDb.db.insert(organizations).values({
    id: "org_awards_1",
    name: "Awards Org",
    createdAt: timestamp,
    updatedAt: timestamp,
  }).run();
  testDb.db.insert(organizationMemberships).values({
    organizationId: "org_awards_1",
    userId: "award_user_1",
    role: "owner",
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
  }).run();
  testDb.db.insert(intentToBid).values({
    id: "intent_awards_1",
    userId: "award_user_1",
    bidId: "1",
    status: "intent_added",
    createdAt: timestamp,
    updatedAt: timestamp,
  }).run();

  return testDb;
}

describe("award outcome repository", () => {
  it("finds the SQLite award outcome row by organization and intent", async () => {
    const testDb = await seedIntent();

    try {
      upsertAwardOutcomeRow(testDb.db, row());

      expect(findAwardOutcomeRow(testDb.db, "org_awards_1", "intent_awards_1")).toMatchObject({
        id: "award_outcome_1",
        organizationId: "org_awards_1",
        intentId: "intent_awards_1",
        status: "awaiting_award",
      });
      expect(findAwardOutcomeRow(testDb.db, "org_other", "intent_awards_1")).toBeUndefined();
    } finally {
      await testDb.cleanup();
    }
  });

  it("upserts the same SQLite intent without duplicating outcomes", async () => {
    const testDb = await seedIntent();

    try {
      upsertAwardOutcomeRow(testDb.db, row());
      const updated = upsertAwardOutcomeRow(testDb.db, row({
        id: "award_outcome_1",
        status: "awarded_to_us",
        winnerName: "Awards Org",
        awardAmountCents: 1250000,
        updatedAt: "2026-06-10T00:05:00.000Z",
      }));

      expect(updated).toMatchObject({
        intentId: "intent_awards_1",
        status: "awarded_to_us",
        winnerName: "Awards Org",
        awardAmountCents: 1250000,
      });
      expect(findAwardOutcomeRow(testDb.db, "org_awards_1", "intent_awards_1")).toMatchObject({
        status: "awarded_to_us",
        updatedAt: "2026-06-10T00:05:00.000Z",
      });
      expect(testDb.db.$client.prepare("SELECT COUNT(*) AS count FROM award_outcomes").get()).toEqual({ count: 1 });
    } finally {
      await testDb.cleanup();
    }
  });

  it("aliases MySQL award outcome columns into camelCase rows", async () => {
    const mysql = {
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        expect(sql).toContain("award_notice_url AS awardNoticeUrl");
        expect(sql).toContain("tabulation_artifact_id AS tabulationArtifactId");
        expect(values).toEqual(["org_awards_1", "intent_awards_1"]);

        return [[{
          ...row(),
          awardAmountCents: "1250000",
        }], undefined];
      }),
      execute: vi.fn(),
    };

    await expect(findAwardOutcomeRowFromMysql(mysql, "org_awards_1", "intent_awards_1")).resolves.toMatchObject({
      awardAmountCents: 1250000,
      awardNoticeUrl: "",
      tabulationArtifactId: null,
    });
  });

  it("upserts MySQL award outcomes through the unique intent key", async () => {
    let stored: Record<string, unknown> | null = null;
    const mysql = {
      execute: vi.fn(async (sql: string, values: unknown[] = []) => {
        expect(sql).toContain("ON DUPLICATE KEY UPDATE");
        stored = {
          id: values[0],
          organizationId: values[1],
          intentId: values[2],
          bidId: values[3],
          userId: values[4],
          status: values[5],
          awardNoticeUrl: values[6],
          tabulationArtifactId: values[7],
          tabulationArtifactUrl: values[8],
          winnerName: values[9],
          awardAmountCents: values[10],
          currency: values[11],
          lossReason: values[12],
          lossReasonNotes: values[13],
          nextAction: values[14],
          nextActionDueAt: values[15],
          notes: values[16],
          decidedAt: values[17],
          createdAt: values[18],
          updatedAt: values[19],
        };
        return [{ affectedRows: 1 }, undefined];
      }),
      query: vi.fn(async () => [[stored].filter(Boolean), undefined]),
    };

    await expect(upsertAwardOutcomeRowFromMysql(mysql, row({ status: "awarded_to_competitor" }))).resolves.toMatchObject({
      intentId: "intent_awards_1",
      status: "awarded_to_competitor",
    });
  });
});
