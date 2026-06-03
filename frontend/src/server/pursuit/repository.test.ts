import { describe, expect, it, vi } from "vitest";
import {
  createPursuitDecisionRowFromMysql,
  listPursuitDecisionRowsFromMysql,
} from "./repository";

describe("pursuit repository MySQL runtime", () => {
  it("creates and lists pursuit decision history", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const mysql = {
      execute: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("INSERT INTO pursuit_decisions")) {
          rows.set(values[0] as string, {
            id: values[0],
            intentId: values[1],
            bidId: values[2],
            userId: values[3],
            decision: values[4],
            reasonsJson: values[5],
            notes: values[6],
            createdAt: values[7],
            updatedAt: values[8],
          });
        }

        return [{ affectedRows: 1 }, undefined];
      }),
      query: vi.fn(async (_sql: string, values: unknown[] = []) => [
        [...rows.values()]
          .filter((row) => row.intentId === values[0])
          .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt))),
        undefined,
      ]),
    };

    const created = await createPursuitDecisionRowFromMysql(mysql, {
      id: "pursuit_decision_1",
      intentId: "intent_1",
      bidId: "bid_1",
      userId: "user_1",
      decision: "pursue",
      reasons: ["Good fit"],
      notes: "Proceed",
      timestamp: "2026-06-01T00:00:00.000Z",
    });

    expect(created).toEqual([
      expect.objectContaining({
        id: "pursuit_decision_1",
        intentId: "intent_1",
        decision: "pursue",
        reasonsJson: JSON.stringify(["Good fit"]),
      }),
    ]);
    await expect(listPursuitDecisionRowsFromMysql(mysql, "intent_1")).resolves.toHaveLength(1);
  });
});
