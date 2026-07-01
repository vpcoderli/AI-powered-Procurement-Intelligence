import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminAccess } from "@/server/admin/auth";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import {
  createRiskChecklistReport,
  createRiskChecklistReportFromMysql,
  type RiskChecklistReport,
} from "@/server/risk/checklist";
import {
  createStateDataQualityReport,
  createStateDataQualityReportFromMysql,
  type StateDataQualityReport,
  type MysqlStateDataQualityReader,
} from "@/server/source-validity/state-data-quality";
import {
  listRiskChecklistSnapshots,
  listRiskChecklistSnapshotsFromMysql,
  recordRiskChecklistSnapshot,
  recordRiskChecklistSnapshotFromMysql,
  summarizeRiskChecklistTrend,
} from "@/server/risk/snapshots";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function routeError(error: unknown) {
  if (error instanceof AdminAuthError) {
    return errorResponse(error.code, error.message, error.status);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
}

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;
  if (isMysqlDatabaseUrlConfigured()) return {} as AppDatabase;

  const client = await import("@/server/db/client");
  return client.db;
}

async function resolveStateDataQuality(
  db: AppDatabase,
  now: Date,
  createStateQualityReport: (db: AppDatabase, now: Date) => Promise<StateDataQualityReport>,
) {
  try {
    return await createStateQualityReport(db, now);
  } catch {
    return null;
  }
}

async function resolveMysqlStateDataQuality(mysql: MysqlStateDataQualityReader, now: Date) {
  try {
    return await createStateDataQualityReportFromMysql(mysql, now);
  } catch {
    return null;
  }
}

export function createAdminRiskCheckGet(
  database?: AppDatabase,
  createReport: (db: AppDatabase) => Promise<RiskChecklistReport> = createRiskChecklistReport,
  createStateQualityReport: (
    db: AppDatabase,
    now: Date,
  ) => Promise<StateDataQualityReport> = createStateDataQualityReport,
) {
  return async function GET(request: Request) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator", "support"] });
      const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
      const checkedAt = new Date();
      const report = mysql ? await createRiskChecklistReportFromMysql(mysql) : await createReport(resolvedDb);
      if (mysql) {
        await recordRiskChecklistSnapshotFromMysql(mysql, report);
      } else {
        recordRiskChecklistSnapshot(resolvedDb, report);
      }
      const history = mysql
        ? await listRiskChecklistSnapshotsFromMysql(mysql, 5)
        : listRiskChecklistSnapshots(resolvedDb, 5);
      const trend = summarizeRiskChecklistTrend(history);
      const stateDataQuality = mysql
        ? await resolveMysqlStateDataQuality(mysql, checkedAt)
        : await resolveStateDataQuality(resolvedDb, checkedAt, createStateQualityReport);

      return NextResponse.json({ report, history, trend, stateDataQuality });
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminRiskCheckGet();
