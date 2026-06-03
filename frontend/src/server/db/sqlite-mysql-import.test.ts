import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type AppDatabase } from "./client";
import { runMigrations } from "./migrate";
import { importSqliteDatabaseIntoMysql } from "./sqlite-mysql-import";

describe("SQLite to MySQL data import", () => {
  let directory: string | undefined;
  let database: AppDatabase | undefined;

  afterEach(() => {
    try {
      database?.$client.close();
    } catch {
      // Ignore duplicate close attempts in failing tests.
    }
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
    directory = undefined;
    database = undefined;
  });

  it("copies selected SQLite tables with MySQL upsert semantics", async () => {
    directory = mkdtempSync(path.join(os.tmpdir(), "sqlite-mysql-import-test-"));
    const databasePath = path.join(directory, "apsi.sqlite");
    database = createDatabase(databasePath);
    runMigrations(database);
    database.$client.prepare(`
      INSERT INTO users (
        id,
        email,
        display_name,
        role,
        account_tier,
        is_disabled,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "user_import_1",
      "import@example.com",
      "Import User",
      "user",
      "free",
      0,
      "2026-06-01T00:00:00.000Z",
      "2026-06-01T00:00:00.000Z",
    );
    database.$client.prepare(`
      INSERT INTO data_sources (
        id,
        label,
        issuer_type,
        state_code,
        base_url,
        is_enabled,
        cadence,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "source_import_1",
      "Import Source",
      "state",
      "CA",
      "https://example.com/source",
      1,
      "daily",
      "2026-06-01T00:00:00.000Z",
      "2026-06-01T00:00:00.000Z",
    );
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const mysql = {
      execute: vi.fn(async (sql: string, values?: never[]) => {
        statements.push({ sql, values: values as unknown[] });
        return [{ affectedRows: 1 }, undefined];
      }),
    };

    const result = await importSqliteDatabaseIntoMysql(mysql, databasePath, {
      tables: ["users", "data_sources"],
    });

    expect(result).toEqual({
      tables: [
        { tableName: "users", rowsCopied: 1 },
        { tableName: "data_sources", rowsCopied: 1 },
      ],
      totalRowsCopied: 2,
    });
    expect(statements).toHaveLength(2);
    expect(statements[0].sql).toContain("INSERT INTO `users`");
    expect(statements[0].sql).toContain("ON DUPLICATE KEY UPDATE");
    expect(statements[0].values).toContain("user_import_1");
    expect(statements[1].sql).toContain("INSERT INTO `data_sources`");
    expect(statements[1].values).toContain("source_import_1");
  });
});
