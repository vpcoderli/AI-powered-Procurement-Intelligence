import { randomUUID } from "node:crypto";
import { desc } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute } from "@/server/db/mysql-runtime";
import { mysqlSelectMany } from "@/server/db/mysql-runtime";
import { sourceHealthSnapshots } from "@/server/db/schema";
import type { LiveSourceHealthReport, LiveSourceHealthResult } from "./live-source-health";

export interface LiveSourceHealthSnapshot {
  id: string;
  ok: boolean;
  checkedAt: string;
  createdAt: string;
  report: LiveSourceHealthReport;
}

export interface LatestLiveSourceHealth {
  checkedAt: string;
  result: LiveSourceHealthResult;
}

export interface SourceHealthTrend {
  sampleSize: number;
  healthyChecks: number;
  unhealthyChecks: number;
  skippedChecks: number;
  healthyPercent: number;
  currentStatus: LiveSourceHealthResult["status"];
  currentStreak: number;
  lastUnhealthyAt: string | null;
}

export interface MysqlSourceHealthSnapshotReader {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
}

export interface MysqlSourceHealthSnapshotWriter extends MysqlSourceHealthSnapshotReader {
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

interface MysqlSourceHealthSnapshotRow {
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

function hydrateSnapshot(row: typeof sourceHealthSnapshots.$inferSelect): LiveSourceHealthSnapshot {
  return {
    id: row.id,
    ok: row.ok === 1,
    checkedAt: row.checkedAt,
    createdAt: row.createdAt,
    report: {
      ok: row.ok === 1,
      checkedAt: row.checkedAt,
      summary: parseJson<LiveSourceHealthReport["summary"]>(row.summaryJson),
      results: parseJson<LiveSourceHealthResult[]>(row.resultsJson),
    },
  };
}

function hydrateMysqlSnapshot(row: MysqlSourceHealthSnapshotRow): LiveSourceHealthSnapshot {
  const ok = Number(row.ok) === 1;

  return {
    id: row.id,
    ok,
    checkedAt: row.checkedAt,
    createdAt: row.createdAt,
    report: {
      ok,
      checkedAt: row.checkedAt,
      summary: parseJson<LiveSourceHealthReport["summary"]>(row.summaryJson),
      results: parseJson<LiveSourceHealthResult[]>(row.resultsJson),
    },
  };
}

export function recordLiveSourceHealthSnapshot(
  db: AppDatabase,
  report: LiveSourceHealthReport,
  createdAt = new Date().toISOString(),
) {
  const row = {
    id: `source_health_${randomUUID()}`,
    ok: report.ok ? 1 : 0,
    checkedAt: report.checkedAt,
    summaryJson: JSON.stringify(report.summary),
    resultsJson: JSON.stringify(report.results),
    createdAt,
  } satisfies typeof sourceHealthSnapshots.$inferInsert;

  db.insert(sourceHealthSnapshots).values(row).run();

  return hydrateSnapshot(row);
}

export async function recordLiveSourceHealthSnapshotFromMysql(
  mysql: MysqlSourceHealthSnapshotWriter,
  report: LiveSourceHealthReport,
  createdAt = new Date().toISOString(),
) {
  const id = `source_health_${randomUUID()}`;
  await mysqlExecute(
    mysql,
    `
      INSERT INTO source_health_snapshots (
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
  } satisfies LiveSourceHealthSnapshot;
}

export function listLiveSourceHealthSnapshots(db: AppDatabase, limit = 5) {
  return db.select()
    .from(sourceHealthSnapshots)
    .orderBy(desc(sourceHealthSnapshots.checkedAt), desc(sourceHealthSnapshots.createdAt))
    .limit(limit)
    .all()
    .map(hydrateSnapshot);
}

export async function listLiveSourceHealthSnapshotsFromMysql(
  mysql: MysqlSourceHealthSnapshotReader,
  limit = 5,
) {
  const rows = await mysqlSelectMany<MysqlSourceHealthSnapshotRow>(
    mysql,
    `
      SELECT
        id,
        ok,
        checked_at AS checkedAt,
        summary_json AS summaryJson,
        results_json AS resultsJson,
        created_at AS createdAt
      FROM source_health_snapshots
      ORDER BY checked_at DESC, created_at DESC
      LIMIT ?
    `,
    [Math.min(Math.max(limit, 1), 25)],
  );

  return rows.map(hydrateMysqlSnapshot);
}

export function latestLiveSourceHealthBySource(snapshots: LiveSourceHealthSnapshot[]) {
  const latest = snapshots[0] ?? null;
  const bySource = new Map<string, LatestLiveSourceHealth>();

  if (!latest) return bySource;

  for (const result of latest.report.results) {
    bySource.set(result.sourceId, {
      checkedAt: latest.checkedAt,
      result,
    });
    bySource.set(result.stateCode.toLowerCase(), {
      checkedAt: latest.checkedAt,
      result,
    });
  }

  return bySource;
}

type TrendSample = {
  checkedAt: string;
  status: LiveSourceHealthResult["status"];
};

function trendForSamples(samples: TrendSample[]): SourceHealthTrend | null {
  if (samples.length === 0) return null;

  const healthyChecks = samples.filter((sample) => sample.status === "healthy").length;
  const unhealthyChecks = samples.filter((sample) => sample.status === "unhealthy").length;
  const skippedChecks = samples.filter((sample) => sample.status === "skipped").length;
  const currentStatus = samples[0].status;
  let currentStreak = 0;

  for (const sample of samples) {
    if (sample.status !== currentStatus) break;
    currentStreak += 1;
  }

  return {
    sampleSize: samples.length,
    healthyChecks,
    unhealthyChecks,
    skippedChecks,
    healthyPercent: Math.round((healthyChecks / samples.length) * 100),
    currentStatus,
    currentStreak,
    lastUnhealthyAt: samples.find((sample) => sample.status === "unhealthy")?.checkedAt ?? null,
  };
}

export function sourceHealthTrendBySource(snapshots: LiveSourceHealthSnapshot[]) {
  const samplesBySource = new Map<string, TrendSample[]>();

  for (const snapshot of snapshots) {
    for (const result of snapshot.report.results) {
      const sample = {
        checkedAt: snapshot.checkedAt,
        status: result.status,
      } satisfies TrendSample;
      const keys = [result.sourceId, result.stateCode.toLowerCase()];

      for (const key of keys) {
        const samples = samplesBySource.get(key) ?? [];
        samples.push(sample);
        samplesBySource.set(key, samples);
      }
    }
  }

  const trends = new Map<string, SourceHealthTrend>();
  for (const [key, samples] of samplesBySource) {
    const trend = trendForSamples(samples);
    if (trend) {
      trends.set(key, trend);
    }
  }

  return trends;
}
