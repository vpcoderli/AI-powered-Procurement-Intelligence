import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { mysqlSqlRunner, sqlCount, sqliteSqlRunner } from "./sql-runner";

describe("admin SQL runner", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("runs parameterised SQL on SQLite", async () => {
    const rows = await sqliteSqlRunner(testDb.db).all<{ total: number; label: string }>(
      "SELECT COUNT(*) AS total, ? AS label FROM data_sources",
      ["x"],
    );
    expect(rows).toEqual([{ total: 0, label: "x" }]);
  });

  it("passes SQL and values to mysql2's query", async () => {
    const query = vi.fn(async () => [[{ total: "3" }]] as [unknown[]]);
    const rows = await mysqlSqlRunner({ query }).all<{ total: string }>("SELECT COUNT(*) AS total FROM t WHERE a = ?", ["b"]);
    expect(rows).toEqual([{ total: "3" }]);
    expect(query).toHaveBeenCalledWith("SELECT COUNT(*) AS total FROM t WHERE a = ?", ["b"]);
  });

  it("reads counts from either driver", () => {
    expect(sqlCount(4)).toBe(4);
    expect(sqlCount("12")).toBe(12);
    expect(sqlCount(null)).toBe(0);
    expect(sqlCount("n/a")).toBe(0);
  });
});
