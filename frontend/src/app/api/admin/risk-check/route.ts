import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminAccess } from "@/server/admin/auth";
import type { AppDatabase } from "@/server/db/client";
import { createRiskChecklistReport, type RiskChecklistReport } from "@/server/risk/checklist";
import { listRiskChecklistSnapshots, recordRiskChecklistSnapshot, summarizeRiskChecklistTrend } from "@/server/risk/snapshots";

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

  const client = await import("@/server/db/client");
  return client.db;
}

export function createAdminRiskCheckGet(
  database?: AppDatabase,
  createReport: (db: AppDatabase) => Promise<RiskChecklistReport> = createRiskChecklistReport,
) {
  return async function GET(request: Request) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator", "support"] });
      const report = await createReport(resolvedDb);
      recordRiskChecklistSnapshot(resolvedDb, report);
      const history = listRiskChecklistSnapshots(resolvedDb, 5);
      const trend = summarizeRiskChecklistTrend(history);

      return NextResponse.json({ report, history, trend });
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminRiskCheckGet();
