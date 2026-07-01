import { copyFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { countSqliteRows, type SqliteTableRowCount } from "./sqlite-backup";

export class SqliteRestoreTargetExistsError extends Error {
  constructor(targetPath: string) {
    super(
      `Restore target "${targetPath}" already exists. Restoring would overwrite it. ` +
        `Pass --force to overwrite intentionally, or choose a different --target scratch path. ` +
        `This guard exists specifically so a restore drill or accidental re-run cannot silently ` +
        `clobber an active dev database.`,
    );
    this.name = "SqliteRestoreTargetExistsError";
  }
}

export interface SqliteRestoreResult {
  backupPath: string;
  targetPath: string;
  tables: SqliteTableRowCount[];
  totalRowCount: number;
}

/**
 * Restores a SQLite backup file (produced by `backupSqliteDatabase`) to
 * `targetPath`. This is a plain file copy — the backup produced by
 * `.backup()` is already a complete, consistent, standalone database file,
 * so "restoring" it is just placing a validated copy at the target path and
 * confirming it opens and is readable.
 *
 * Refuses to overwrite an existing file at `targetPath` unless `force` is
 * explicitly set, so this cannot be pointed at the live
 * `frontend/data/apsi.sqlite` dev database by accident.
 */
export function restoreSqliteBackup(
  backupPath: string,
  targetPath: string,
  options: { force?: boolean } = {},
): SqliteRestoreResult {
  if (!existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }

  if (existsSync(targetPath)) {
    if (!options.force) {
      throw new SqliteRestoreTargetExistsError(targetPath);
    }
    unlinkSync(targetPath);
    // Remove WAL/SHM sidecars for the target if present, so a --force
    // restore cannot leave a stale WAL file that shadows the freshly
    // restored data.
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${targetPath}${suffix}`;
      if (existsSync(sidecar)) unlinkSync(sidecar);
    }
  }

  mkdirSync(path.dirname(targetPath), { recursive: true });
  copyFileSync(backupPath, targetPath);

  // Open the restored file to confirm it is a valid, readable SQLite
  // database and run SQLite's own structural integrity check
  // (`PRAGMA quick_check`) before trusting row counts computed against it.
  // `quick_check` is used instead of the full `integrity_check` because it
  // skips the (much slower) UNIQUE/foreign-key constraint scan while still
  // catching page-level corruption, which is the failure mode a bad
  // copy/restore would actually produce.
  const sqlite = new Database(targetPath, { readonly: true, fileMustExist: true });
  const checkRows = sqlite.pragma("quick_check") as { quick_check: string }[];
  sqlite.close();

  const firstResult = checkRows[0]?.quick_check;
  if (firstResult !== "ok") {
    throw new Error(
      `Restored SQLite database at "${targetPath}" failed PRAGMA quick_check: ${checkRows.map((row) => row.quick_check).join("; ") || "unknown error"}`,
    );
  }

  const tables = countSqliteRows(targetPath);

  return {
    backupPath,
    targetPath,
    tables,
    totalRowCount: tables.reduce((total, table) => total + table.rowCount, 0),
  };
}
