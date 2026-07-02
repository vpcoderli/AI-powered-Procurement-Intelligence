import Database from "better-sqlite3";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";

export interface SqliteTableRowCount {
  tableName: string;
  rowCount: number;
}

export interface SqliteBackupResult {
  sourcePath: string;
  destinationPath: string;
  byteSize: number;
  tables: SqliteTableRowCount[];
  totalRowCount: number;
}

/**
 * Lists user tables (excluding SQLite's internal `sqlite_%` tables) for a
 * given open database handle. Shared by the backup and drill scripts so row
 * counts are computed the same way on both the source and restored copies.
 */
export function listSqliteTables(sqlite: Database.Database): string[] {
  const rows = sqlite
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC`,
    )
    .all() as { name: string }[];

  return rows.map((row) => row.name);
}

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQLite identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

/**
 * Opens `databasePath` read-only and returns a row count per user table,
 * ordered by table name for deterministic comparison/output.
 */
export function countSqliteRows(databasePath: string): SqliteTableRowCount[] {
  const sqlite = new Database(databasePath, { readonly: true, fileMustExist: true });

  try {
    return listSqliteTables(sqlite).map((tableName) => {
      const row = sqlite
        .prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`)
        .get() as { count: number };
      return { tableName, rowCount: row.count };
    });
  } finally {
    sqlite.close();
  }
}

/**
 * Snapshots a SQLite database file to `destinationPath` using better-sqlite3's
 * `.backup()` method, which wraps SQLite's native Online Backup API
 * (`sqlite3_backup_init`/`_step`/`_finish`). This is the mechanism SQLite's
 * own documentation recommends for backing up a *live* database: it copies
 * the database page-by-page under a read lock and is safe to run against a
 * database that is open elsewhere and in WAL mode, unlike a naive
 * `cp apsi.sqlite backup.sqlite` file copy, which can capture a torn or
 * inconsistent snapshot when WAL pages have not yet been checkpointed back
 * into the main database file.
 *
 * The resulting `destinationPath` file is a complete, standalone, consistent
 * SQLite database that can be opened directly with no sidecar `-wal`/`-shm`
 * files required — safe to move, upload, or open read-only elsewhere.
 */
export async function backupSqliteDatabase(sourcePath: string, destinationPath: string): Promise<SqliteBackupResult> {
  mkdirSync(path.dirname(destinationPath), { recursive: true });

  // Open read-write (not readonly) because SQLite's backup API needs to be
  // able to briefly acquire a read lock and, for WAL-mode sources, ensure
  // the connection has read access to committed WAL frames. This matches the
  // access mode the app runtime itself opens the database with
  // (`frontend/src/server/db/client.ts`).
  const sqlite = new Database(sourcePath, { fileMustExist: true });

  try {
    await sqlite.backup(destinationPath);
  } finally {
    sqlite.close();
  }

  const tables = countSqliteRows(destinationPath);
  const byteSize = statSync(destinationPath).size;

  return {
    sourcePath,
    destinationPath,
    byteSize,
    tables,
    totalRowCount: tables.reduce((total, table) => total + table.rowCount, 0),
  };
}

export function defaultSqliteBackupFileName(now: Date = new Date()) {
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  return `apsi-sqlite-${timestamp}.sqlite`;
}
