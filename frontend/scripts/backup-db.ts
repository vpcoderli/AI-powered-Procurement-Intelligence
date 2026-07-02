/**
 * Backs up the active database to a timestamped file.
 *
 * - SQLite (default/local): snapshots `DATABASE_PATH` (or
 *   `frontend/data/apsi.sqlite`) using better-sqlite3's native online backup
 *   API, which is WAL-safe (see `src/server/backup/sqlite-backup.ts`).
 * - MySQL (`DATABASE_URL`/`MYSQL_DATABASE_URL` set to `mysql://`): shells out
 *   to `mysqldump` (see `src/server/backup/mysql-backup.ts`).
 *
 * Output defaults to `frontend/data/backups/` (already gitignored). If
 * `OBJECT_STORAGE_PROVIDER=s3` is configured, the backup file is also
 * uploaded there; any upload failure is reported but does not fail the
 * command, since the local backup file is already the authoritative
 * artifact at that point.
 *
 * Usage:
 *   npm run db:backup
 *   npm run db:backup -- --out=/custom/dir
 *   npm run db:backup -- --source=/path/to/apsi.sqlite   (SQLite only)
 */
import { loadEnvConfig } from "@next/env";
import path from "node:path";
import { sha256File } from "../src/server/backup/checksum";
import { isMysqlDatabaseUrlConfigured } from "../src/server/db/mysql";
import { backupMysqlDatabase, defaultMysqlBackupFileName } from "../src/server/backup/mysql-backup";
import { backupSqliteDatabase, defaultSqliteBackupFileName } from "../src/server/backup/sqlite-backup";
import { uploadBackupIfConfigured } from "../src/server/backup/upload";

function argValue(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function defaultBackupDir() {
  return argValue("out") ?? path.join(process.cwd(), "data", "backups");
}

function defaultSqliteSourcePath() {
  return path.resolve(argValue("source") ?? process.env.DATABASE_PATH?.trim() ?? path.join("data", "apsi.sqlite"));
}

async function main() {
  loadEnvConfig(process.cwd());

  const outDir = defaultBackupDir();
  const startedAt = new Date();

  if (isMysqlDatabaseUrlConfigured()) {
    const destinationPath = path.join(outDir, defaultMysqlBackupFileName(startedAt));
    console.log(`Backup mode: mysql (mysqldump)`);
    console.log(`Destination: ${destinationPath}`);

    const result = await backupMysqlDatabase(destinationPath);
    const checksum = await sha256File(result.destinationPath);

    console.log(`MySQL source: ${result.databaseUrlSummary}`);
    console.log(`Backup written: ${result.destinationPath} (${result.byteSize} bytes)`);
    console.log(`SHA-256: ${checksum}`);

    const upload = await uploadBackupIfConfigured(result.destinationPath, { keyPrefix: "backups/mysql" });
    logUploadResult(upload);
    return;
  }

  const sourcePath = defaultSqliteSourcePath();
  const destinationPath = path.join(outDir, defaultSqliteBackupFileName(startedAt));
  console.log(`Backup mode: sqlite (online backup API, WAL-safe)`);
  console.log(`Source: ${sourcePath}`);
  console.log(`Destination: ${destinationPath}`);

  const result = await backupSqliteDatabase(sourcePath, destinationPath);
  const checksum = await sha256File(result.destinationPath);

  console.log(`Backup written: ${result.destinationPath} (${result.byteSize} bytes)`);
  console.log(`SHA-256: ${checksum}`);
  console.log(`Tables backed up: ${result.tables.length}, total rows: ${result.totalRowCount}`);
  for (const table of result.tables) {
    console.log(`- ${table.tableName}: ${table.rowCount}`);
  }

  const upload = await uploadBackupIfConfigured(result.destinationPath, { keyPrefix: "backups/sqlite" });
  logUploadResult(upload);
}

function logUploadResult(upload: Awaited<ReturnType<typeof uploadBackupIfConfigured>>) {
  if (!upload.attempted) {
    console.log(`Remote upload: skipped (${upload.reason})`);
    return;
  }

  if (upload.uploaded) {
    console.log(`Remote upload: ok -> ${upload.storagePath}`);
  } else {
    console.warn(`Remote upload: failed (${upload.reason})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
