import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminAccess } from "@/server/admin/auth";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import {
  getMarketingFunnelSummary,
  getMarketingFunnelSummaryFromMysql,
} from "@/server/marketing/funnel";

interface MysqlMarketingFunnelStore {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
}

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

export function createAdminMarketingFunnelGet(database?: AppDatabase, mysql?: MysqlMarketingFunnelStore) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());

  return async function GET(request: Request) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator", "support"] });
      const summary = shouldUseMysqlRuntime()
        ? await getMarketingFunnelSummaryFromMysql(mysql ?? resolveMysqlPool())
        : getMarketingFunnelSummary(resolvedDb);

      return NextResponse.json({ summary });
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminMarketingFunnelGet();
