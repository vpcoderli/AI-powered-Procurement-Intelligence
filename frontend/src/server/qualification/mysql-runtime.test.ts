import { describe, expect, it, vi } from "vitest";
import {
  findIntentQualificationSnapshotFromMysql,
  updateIntentEvidenceCitationsForUsersFromMysql,
  updateIntentQualificationSnapshotForUsersFromMysql,
} from "./mysql-runtime";

describe("qualification MySQL runtime helpers", () => {
  it("reads and updates intent qualification citation and snapshot fields", async () => {
    const row = {
      id: "intent_1",
      bidId: "bid_1",
      evidenceCitationsJson: "[]",
      aiBidBrief: "Old brief",
      keyDatesJson: "[]",
      initialChecklistJson: "[]",
      riskFlagsJson: "[]",
      matchScoreSnapshotJson: "{}",
      updatedAt: "2026-06-01T00:00:00.000Z",
    };
    const mysql = {
      execute: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("SET evidence_citations_json = ?")) {
          row.evidenceCitationsJson = values[0] as string;
          row.updatedAt = values[1] as string;
        }

        if (sql.includes("SET ai_bid_brief = ?")) {
          row.aiBidBrief = values[0] as string;
          row.keyDatesJson = values[1] as string;
          row.initialChecklistJson = values[2] as string;
          row.riskFlagsJson = values[3] as string;
          row.matchScoreSnapshotJson = values[4] as string;
          row.evidenceCitationsJson = values[5] as string;
          row.updatedAt = values[6] as string;
        }

        return [{ affectedRows: 1 }, undefined];
      }),
      query: vi.fn(async () => [[row], undefined]),
    };

    await expect(findIntentQualificationSnapshotFromMysql(mysql, ["user_1"], "intent_1")).resolves.toEqual(row);
    await updateIntentEvidenceCitationsForUsersFromMysql(
      mysql,
      ["user_1"],
      "intent_1",
      JSON.stringify([{ id: "citation_1" }]),
      "2026-06-01T00:01:00.000Z",
    );
    expect(row.evidenceCitationsJson).toBe(JSON.stringify([{ id: "citation_1" }]));

    const updated = await updateIntentQualificationSnapshotForUsersFromMysql(mysql, ["user_1"], "intent_1", {
      generated: {
        aiBidBrief: "New brief",
        keyDates: [{ label: "Due", value: "2026-06-30", confidence: "high" }],
        initialChecklist: ["Review addendum"],
        riskFlags: ["Deadline risk"],
      },
      match: {
        score: 80,
        reasons: ["Keyword fit"],
        riskFlags: [],
        profileGaps: [],
      },
      citationsJson: JSON.stringify([{ id: "citation_2" }]),
      timestamp: "2026-06-01T00:02:00.000Z",
    });

    expect(updated).toMatchObject({
      id: "intent_1",
      aiBidBrief: "New brief",
      evidenceCitationsJson: JSON.stringify([{ id: "citation_2" }]),
    });
  });
});
