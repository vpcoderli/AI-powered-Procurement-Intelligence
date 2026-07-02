/**
 * Backup/restore drill: backup -> restore -> data-integrity check, run
 * end-to-end against the local SQLite database, producing a JSON evidence
 * file on success.
 *
 * IMPORTANT — scope of what this proves: this drill only exercises the
 * mechanism against local/dev SQLite data. It does NOT constitute a
 * production backup/restore drill. `docs/transferability/known-limitations.md`
 * requires "Backup and restore has been tested on production-like data"
 * before launch — that still requires a human/ops team to run an equivalent
 * drill against production-like infrastructure (RDS/MySQL with
 * production-scale data) and record that evidence separately. See
 * `docs/operations/backup-restore-runbook.md` for that follow-up procedure.
 *
 * What this script does:
 *   1. Runs `backupSqliteDatabase` against the local SQLite database.
 *   2. Restores that backup into a scratch target file (never the live DB).
 *   3. Compares source vs. restored row counts per table, and compares the
 *      backup file's SHA-256 checksum against a checksum of the restored
 *      file (should match a byte-for-byte copy).
 *   4. On success, writes a JSON evidence file recording timestamps,
 *      checksums, and row counts to
 *      `frontend/data/backup-drill-evidence/backup-drill-<timestamp>.json`
 *      (also mirrored to `latest.json` in the same directory for easy
 *      linking). This is the artifact a human should upload/reference from
 *      `PRODUCTION_BACKUP_EVIDENCE_URL` / `PRODUCTION_RESTORE_EVIDENCE_URL`
 *      after a *real* drill against production-like data — see the runbook.
 *
 * Usage:
 *   npm run db:backup-drill
 *   npm run db:backup-drill -- --keep   (do not delete the scratch backup/restore files afterward)
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sha256File } from "../src/server/backup/checksum";
import { backupSqliteDatabase, defaultSqliteBackupFileName } from "../src/server/backup/sqlite-backup";
import { restoreSqliteBackup } from "../src/server/backup/sqlite-restore";

interface DrillTableComparison {
  tableName: string;
  sourceRowCount: number;
  restoredRowCount: number;
  match: boolean;
}

interface DrillEvidence {
  ok: boolean;
  drillType: "local-sqlite-only";
  scope: string;
  generatedAt: string;
  sourceDatabasePath: string;
  backupFilePath: string;
  backupChecksumSha256: string;
  backupByteSize: number;
  restoredFilePath: string;
  restoredChecksumSha256: string;
  checksumMatch: boolean;
  tableCount: number;
  totalSourceRowCount: number;
  totalRestoredRowCount: number;
  rowCountsMatch: boolean;
  tables: DrillTableComparison[];
  productionDrillRequired: string;
}

function argValue(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function defaultSqliteSourcePath() {
  return path.resolve(argValue("source") ?? process.env.DATABASE_PATH?.trim() ?? path.join("data", "apsi.sqlite"));
}

async function main() {
  loadEnvConfig(process.cwd());

  const sourcePath = defaultSqliteSourcePath();
  const scratchDir = path.join(process.cwd(), "data", "backup-drill-scratch");
  const evidenceDir = path.join(process.cwd(), "data", "backup-drill-evidence");
  const startedAt = new Date();
  const keep = hasFlag("keep");

  mkdirSync(scratchDir, { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });

  const backupFilePath = path.join(scratchDir, defaultSqliteBackupFileName(startedAt));
  const restoredFilePath = path.join(scratchDir, `restored-${defaultSqliteBackupFileName(startedAt)}`);

  console.log(`Backup drill starting against: ${sourcePath}`);
  console.log(`Scratch backup file: ${backupFilePath}`);
  console.log(`Scratch restore target: ${restoredFilePath}`);

  // Step 1: backup.
  const backupResult = await backupSqliteDatabase(sourcePath, backupFilePath);
  const backupChecksum = await sha256File(backupFilePath);
  console.log(`Step 1/3 backup: ok (${backupResult.byteSize} bytes, ${backupResult.tables.length} tables, sha256=${backupChecksum})`);

  // Step 2: restore into a scratch target (never the live DB — no --force,
  // no reuse of `sourcePath`/live paths).
  const restoreResult = restoreSqliteBackup(backupFilePath, restoredFilePath, { force: false });
  const restoredChecksum = await sha256File(restoredFilePath);
  console.log(`Step 2/3 restore: ok (${restoreResult.tables.length} tables, sha256=${restoredChecksum})`);

  // Step 3: data-integrity check (row counts + checksum).
  const sourceRowsByTable = new Map(backupResult.tables.map((table) => [table.tableName, table.rowCount]));
  const restoredRowsByTable = new Map(restoreResult.tables.map((table) => [table.tableName, table.rowCount]));
  const allTableNames = new Set([...sourceRowsByTable.keys(), ...restoredRowsByTable.keys()]);

  const tables: DrillTableComparison[] = [...allTableNames].sort().map((tableName) => {
    const sourceRowCount = sourceRowsByTable.get(tableName) ?? 0;
    const restoredRowCount = restoredRowsByTable.get(tableName) ?? 0;
    return {
      tableName,
      sourceRowCount,
      restoredRowCount,
      match: sourceRowCount === restoredRowCount,
    };
  });

  const rowCountsMatch = tables.every((table) => table.match);
  const checksumMatch = backupChecksum === restoredChecksum;
  const ok = rowCountsMatch && checksumMatch;

  console.log(`Step 3/3 integrity check: rowCountsMatch=${rowCountsMatch}, checksumMatch=${checksumMatch}`);
  if (!rowCountsMatch) {
    for (const table of tables.filter((table) => !table.match)) {
      console.error(`  MISMATCH ${table.tableName}: source=${table.sourceRowCount} restored=${table.restoredRowCount}`);
    }
  }

  const evidence: DrillEvidence = {
    ok,
    drillType: "local-sqlite-only",
    scope:
      "This evidence file proves the backup/restore mechanism works against the local/dev SQLite database on this machine. " +
      "It is NOT evidence of a production backup/restore drill. A human/ops team must still run an equivalent drill against " +
      "production-like infrastructure and data before launch, per docs/transferability/known-limitations.md, and record that " +
      "evidence separately (see docs/operations/backup-restore-runbook.md).",
    generatedAt: startedAt.toISOString(),
    sourceDatabasePath: sourcePath,
    backupFilePath,
    backupChecksumSha256: backupChecksum,
    backupByteSize: backupResult.byteSize,
    restoredFilePath,
    restoredChecksumSha256: restoredChecksum,
    checksumMatch,
    tableCount: tables.length,
    totalSourceRowCount: backupResult.totalRowCount,
    totalRestoredRowCount: restoreResult.totalRowCount,
    rowCountsMatch,
    tables,
    productionDrillRequired:
      "UNRESOLVED: an actual drill against production-like infrastructure/data has not been run. " +
      "This local evidence file must not be cited as satisfying that requirement by itself.",
  };

  const evidenceFileName = `backup-drill-${startedAt.toISOString().replace(/[:.]/g, "-")}.json`;
  const evidenceFilePath = path.join(evidenceDir, evidenceFileName);
  const latestEvidencePath = path.join(evidenceDir, "latest.json");

  writeFileSync(evidenceFilePath, JSON.stringify(evidence, null, 2));
  writeFileSync(latestEvidencePath, JSON.stringify(evidence, null, 2));

  console.log(`Evidence written: ${evidenceFilePath}`);
  console.log(`Evidence written: ${latestEvidencePath}`);

  if (!keep) {
    rmSync(scratchDir, { recursive: true, force: true });
    console.log(`Scratch directory removed: ${scratchDir} (pass --keep to retain it)`);
  }

  if (!ok) {
    throw new Error("Backup drill FAILED: row counts or checksums did not match. See evidence file for details.");
  }

  console.log("Backup drill PASSED (local SQLite only — see evidence 'scope' field for what this does and does not prove).");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
