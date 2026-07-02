import { randomUUID } from "node:crypto";
import { desc } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectMany } from "@/server/db/mysql-runtime";
import { sourceComplianceSnapshots } from "@/server/db/schema";
import type { SourceComplianceReport, SourceComplianceResult } from "./robots-compliance-scan";

// Data-source compliance ledger (P1-2): persisted robots.txt/ToS pre-check runs.
// This module only records automated triage signals (robots.txt fetch/hash/flag).
// It never records or infers an actual legal determination. See
// docs/operations/data-source-compliance-ledger.md.

export interface SourceComplianceSnapshot {
  id: string;
  ok: boolean;
  checkedAt: string;
  createdAt: string;
  report: SourceComplianceReport;
}

export interface MysqlSourceComplianceSnapshotReader {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
}

export interface MysqlSourceComplianceSnapshotWriter extends MysqlSourceComplianceSnapshotReader {
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

interface MysqlSourceComplianceSnapshotRow {
  id: string;
  ok: number | string;
  checkedAt: string;
  summaryJson: string;
  resultsJson: string;
  createdAt: string;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function hydrateSnapshot(row: typeof sourceComplianceSnapshots.$inferSelect): SourceComplianceSnapshot {
  return {
    id: row.id,
    ok: row.ok === 1,
    checkedAt: row.checkedAt,
    createdAt: row.createdAt,
    report: {
      ok: row.ok === 1,
      checkedAt: row.checkedAt,
      summary: parseJson<SourceComplianceReport["summary"]>(row.summaryJson),
      results: parseJson<SourceComplianceResult[]>(row.resultsJson),
    },
  };
}

function hydrateMysqlSnapshot(row: MysqlSourceComplianceSnapshotRow): SourceComplianceSnapshot {
  const ok = Number(row.ok) === 1;

  return {
    id: row.id,
    ok,
    checkedAt: row.checkedAt,
    createdAt: row.createdAt,
    report: {
      ok,
      checkedAt: row.checkedAt,
      summary: parseJson<SourceComplianceReport["summary"]>(row.summaryJson),
      results: parseJson<SourceComplianceResult[]>(row.resultsJson),
    },
  };
}

export function recordSourceComplianceSnapshot(
  db: AppDatabase,
  report: SourceComplianceReport,
  createdAt = new Date().toISOString(),
) {
  const row = {
    id: `source_compliance_${randomUUID()}`,
    ok: report.ok ? 1 : 0,
    checkedAt: report.checkedAt,
    summaryJson: JSON.stringify(report.summary),
    resultsJson: JSON.stringify(report.results),
    createdAt,
  } satisfies typeof sourceComplianceSnapshots.$inferInsert;

  db.insert(sourceComplianceSnapshots).values(row).run();

  return hydrateSnapshot(row);
}

export async function recordSourceComplianceSnapshotFromMysql(
  mysql: MysqlSourceComplianceSnapshotWriter,
  report: SourceComplianceReport,
  createdAt = new Date().toISOString(),
) {
  const id = `source_compliance_${randomUUID()}`;
  await mysqlExecute(
    mysql,
    `
      INSERT INTO source_compliance_snapshots (
        id,
        ok,
        checked_at,
        summary_json,
        results_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      report.ok ? 1 : 0,
      report.checkedAt,
      JSON.stringify(report.summary),
      JSON.stringify(report.results),
      createdAt,
    ],
  );

  return {
    id,
    ok: report.ok,
    checkedAt: report.checkedAt,
    createdAt,
    report,
  } satisfies SourceComplianceSnapshot;
}

export function listSourceComplianceSnapshots(db: AppDatabase, limit = 5) {
  return db
    .select()
    .from(sourceComplianceSnapshots)
    .orderBy(desc(sourceComplianceSnapshots.checkedAt), desc(sourceComplianceSnapshots.createdAt))
    .limit(limit)
    .all()
    .map(hydrateSnapshot);
}

export async function listSourceComplianceSnapshotsFromMysql(
  mysql: MysqlSourceComplianceSnapshotReader,
  limit = 5,
) {
  const rows = await mysqlSelectMany<MysqlSourceComplianceSnapshotRow>(
    mysql,
    `
      SELECT
        id,
        ok,
        checked_at AS checkedAt,
        summary_json AS summaryJson,
        results_json AS resultsJson,
        created_at AS createdAt
      FROM source_compliance_snapshots
      ORDER BY checked_at DESC, created_at DESC
      LIMIT ?
    `,
    [Math.min(Math.max(limit, 1), 25)],
  );

  return rows.map(hydrateMysqlSnapshot);
}

export function latestSourceComplianceBySource(snapshots: SourceComplianceSnapshot[]) {
  const latest = snapshots[0] ?? null;
  const bySource = new Map<string, SourceComplianceResult>();

  if (!latest) return bySource;

  for (const result of latest.report.results) {
    bySource.set(result.sourceId, result);
    bySource.set(result.stateCode.toLowerCase(), result);
  }

  return bySource;
}
