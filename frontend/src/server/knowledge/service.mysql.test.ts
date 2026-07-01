import { beforeEach, describe, expect, it, vi } from "vitest";
import * as mysqlRuntime from "@/server/db/mysql";
import { createKnowledgeItem, listKnowledgeItems } from "./service";

vi.mock("@/server/db/mysql", () => ({
  isMysqlDatabaseUrlConfigured: vi.fn(),
  resolveMysqlPool: vi.fn(),
}));

type KnowledgeRow = {
  id: string;
  organizationId: string;
  createdByUserId: string;
  title: string;
  body: string;
  type: string;
  tagsJson: string;
  sourceKind: string;
  sourceIntentId: string | null;
  sourceBidId: string | null;
  sourceUrl: string | null;
  metadataJson: string;
  createdAt: string;
  updatedAt: string;
};

function createMysqlKnowledgeStore() {
  const rows: KnowledgeRow[] = [];
  const mysql = {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("FROM users")) {
        return [[{ id: values[0] }], undefined];
      }
      if (sql.includes("FROM organizations")) {
        return [[{ id: values[0] }], undefined];
      }
      if (sql.includes("FROM organization_memberships")) {
        return [[{ organizationId: values[1], userId: values[0], status: "active" }], undefined];
      }
      if (sql.includes("FROM bids")) {
        return [[{ id: values[0] }], undefined];
      }
      if (sql.includes("FROM knowledge_items")) {
        if (sql.includes("WHERE id = ?")) {
          return [[rows.find((row) => row.id === values[0])].filter(Boolean), undefined];
        }

        const organizationId = values[0];
        const queryValues = values.filter((value): value is string => typeof value === "string");
        const filtered = rows.filter((row) => {
          if (row.organizationId !== organizationId) return false;
          if (queryValues.includes("template_snippet") && row.type !== "template_snippet") return false;
          if (!queryValues.some((value) => value.includes("cloud"))) return true;

          return row.title.includes("cloud") || row.body.includes("cloud") || row.tagsJson.includes("cloud");
        });

        return [filtered, undefined];
      }

      return [[], undefined];
    }),
    execute: vi.fn(async (_sql: string, values: unknown[] = []) => {
      rows.push({
        id: String(values[0]),
        organizationId: String(values[1]),
        createdByUserId: String(values[2]),
        title: String(values[3]),
        body: String(values[4]),
        type: String(values[5]),
        tagsJson: String(values[6]),
        sourceKind: String(values[7]),
        sourceIntentId: values[8] === null ? null : String(values[8]),
        sourceBidId: values[9] === null ? null : String(values[9]),
        sourceUrl: values[10] === null ? null : String(values[10]),
        metadataJson: String(values[11]),
        createdAt: String(values[12]),
        updatedAt: String(values[13]),
      });

      return [{ affectedRows: 1, insertId: 0 }, undefined];
    }),
  };

  return mysql;
}

describe("knowledge service MySQL runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mysqlRuntime.isMysqlDatabaseUrlConfigured).mockReturnValue(true);
  });

  it("creates and lists organization-scoped knowledge without using SQLite", async () => {
    const mysql = createMysqlKnowledgeStore();
    vi.mocked(mysqlRuntime.resolveMysqlPool).mockReturnValue(mysql as never);
    const disabledDb = {
      select: () => {
        throw new Error("SQLite db should not be used in MySQL knowledge runtime");
      },
    };

    const item = await createKnowledgeItem(disabledDb as never, {
      organizationId: "org_1",
      userId: "user_1",
      title: " Cloud snippet ",
      body: " Reusable cloud migration wording. ",
      type: "template_snippet",
      tags: ["cloud", "proposal"],
      sourceKind: "bid",
      sourceBidId: "bid_1",
    });
    const result = await listKnowledgeItems(disabledDb as never, {
      organizationId: "org_1",
      q: "cloud",
      type: "template_snippet",
    });

    expect(item).toMatchObject({
      organizationId: "org_1",
      createdByUserId: "user_1",
      title: "Cloud snippet",
      sourceBidId: "bid_1",
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].tags).toEqual(["cloud", "proposal"]);
    expect(mysql.execute).toHaveBeenCalledTimes(1);
  });
});
