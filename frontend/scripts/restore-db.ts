/**
 * Restores a database backup produced by `backup-db.ts`.
 *
 * Safety model: this script never overwrites the active dev database
 * (`frontend/data/apsi.sqlite`, or the database the current MySQL URL
 * points at) unless the caller explicitly opts in with `--force`. The
 * default and recommended usage is to restore into a separate
 * scratch/target path (SQLite) or scratch/target database name (MySQL), so
 * the restore can be verified without any risk to real data.
 *
 * Usage (SQLite):
 *   npm run db:restore -- --backup=data/backups/apsi-sqlite-2026-07-01T00-00-00-000Z.sqlite --target=data/restore-drill.sqlite
 *   npm run db:restore -- --backup=<path> --target=data/apsi.sqlite --force   (overwrite the active dev DB; use with care)
 *
 * Usage (MySQL):
 *   npm run db:restore -- --backup=data/backups/apsi-mysql-2026-07-01T00-00-00-000Z.sql --target-database=winbids_restore_drill
 *   npm run db:restore -- --backup=<path> --force   (restore into the DATABASE_URL database directly; use with care)
 */
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { isMysqlDatabaseUrlConfigured } from "../src/server/db/mysql";
import { restoreMysqlBackup } from "../src/server/backup/mysql-restore";
import { restoreSqliteBackup } from "../src/server/backup/sqlite-restore";

function argValue(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  loadEnvConfig(process.cwd());

  const backupPath = argValue("backup");
  if (!backupPath) {
    throw new Error("Missing required --backup=<path-to-backup-file> argument.");
  }

  const force = hasFlag("force");

  if (isMysqlDatabaseUrlConfigured()) {
    const targetDatabase = argValue("target-database");
    console.log(`Restore mode: mysql`);
    console.log(`Backup file: ${backupPath}`);
    console.log(`Target database: ${targetDatabase ?? "(DATABASE_URL database — requires --force)"}`);

    const result = await restoreMysqlBackup(path.resolve(backupPath), {
      targetDatabase,
      force,
    });

    console.log(`Restored into ${result.host}:${result.port}/${result.targetDatabase}`);
    return;
  }

  const targetPath = argValue("target");
  if (!targetPath) {
    throw new Error("Missing required --target=<path> argument (a scratch SQLite file path to restore into).");
  }

  console.log(`Restore mode: sqlite`);
  console.log(`Backup file: ${backupPath}`);
  console.log(`Target path: ${targetPath}`);
  console.log(`Force overwrite: ${force}`);

  const result = restoreSqliteBackup(path.resolve(backupPath), path.resolve(targetPath), { force });

  console.log(`Restored: ${result.targetPath}`);
  console.log(`Tables restored: ${result.tables.length}, total rows: ${result.totalRowCount}`);
  for (const table of result.tables) {
    console.log(`- ${table.tableName}: ${table.rowCount}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
