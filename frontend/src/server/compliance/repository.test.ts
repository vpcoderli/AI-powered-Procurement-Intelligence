import { describe, expect, it, vi } from "vitest";
import {
  createComplianceManifestItemRowsFromMysql,
  listComplianceManifestItemRowsFromMysql,
  updateComplianceManifestItemRowFromMysql,
} from "./repository";

describe("compliance repository MySQL runtime", () => {
  it("creates, lists, and updates compliance manifest items", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const mysql = {
      execute: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("INSERT INTO compliance_manifest_items")) {
          rows.set(values[0] as string, {
            id: values[0],
            intentId: values[1],
            bidId: values[2],
            userId: values[3],
            title: values[4],
            category: values[5],
            status: values[6],
            evidenceStatus: values[7],
            notes: values[8],
            sortOrder: values[9],
            createdAt: values[10],
            updatedAt: values[11],
          });
        }

        if (sql.includes("UPDATE compliance_manifest_items")) {
          const row = rows.get(values[4] as string);
          if (row) {
            row.status = values[0];
            row.evidenceStatus = values[1];
            row.updatedAt = values[2];
          }
        }

        return [{ affectedRows: 1 }, undefined];
      }),
      query: vi.fn(async (_sql: string, values: unknown[] = []) => [
        [...rows.values()]
          .filter((row) => row.intentId === values[0])
          .sort((left, right) => Number(left.sortOrder) - Number(right.sortOrder)),
        undefined,
      ]),
    };

    const created = await createComplianceManifestItemRowsFromMysql(mysql, {
      intentId: "intent_1",
      bidId: "bid_1",
      userId: "user_1",
      timestamp: "2026-06-01T00:00:00.000Z",
      items: [
        {
          id: "item_1",
          title: "Signed forms",
          category: "submission",
          evidenceStatus: "needed",
          sortOrder: 0,
        },
      ],
    });

    expect(created).toEqual([
      expect.objectContaining({
        id: "item_1",
        intentId: "intent_1",
        status: "not_started",
        evidenceStatus: "needed",
      }),
    ]);

    await expect(listComplianceManifestItemRowsFromMysql(mysql, "intent_1")).resolves.toHaveLength(1);
    await expect(updateComplianceManifestItemRowFromMysql(mysql, "intent_1", {
      itemId: "item_1",
      status: "complete",
      evidenceStatus: "attached",
    }, "2026-06-01T00:01:00.000Z")).resolves.toEqual([
      expect.objectContaining({
        id: "item_1",
        status: "complete",
        evidenceStatus: "attached",
      }),
    ]);
  });
});
