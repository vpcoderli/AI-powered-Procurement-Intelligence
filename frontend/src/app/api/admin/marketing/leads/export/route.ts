import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminAccess } from "@/server/admin/auth";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import {
  getMarketingLeadExportRows,
  getMarketingLeadExportRowsFromMysql,
  renderMarketingLeadCsv,
} from "@/server/marketing/export";

interface MysqlMarketingLeadExportStore {
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

export function createAdminMarketingLeadsExportGet(
  database?: AppDatabase,
  mysql?: MysqlMarketingLeadExportStore,
) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());

  return async function GET(request: Request) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator", "support"] });
      const rows = shouldUseMysqlRuntime()
        ? await getMarketingLeadExportRowsFromMysql(mysql ?? resolveMysqlPool())
        : getMarketingLeadExportRows(resolvedDb);
      const csv = renderMarketingLeadCsv(rows);

      return new Response(csv, {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": 'attachment; filename="winbids-marketing-leads.csv"',
          "Content-Type": "text/csv; charset=utf-8",
        },
      });
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminMarketingLeadsExportGet();
