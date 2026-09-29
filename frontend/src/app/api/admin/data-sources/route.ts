import { NextResponse } from "next/server";
import { requireAdminAccess, AdminAuthError } from "@/server/admin/auth";
import {
  DataSourceQueryError,
  listAdminDataSourcesPage,
  listAdminDataSourcesPageFromMysql,
  parseSourceListQuery,
} from "@/server/admin/data-source-query";
import type { MysqlSqlReader } from "@/server/admin/sql-runner";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function routeError(error: unknown) {
  if (error instanceof AdminAuthError) {
    return errorResponse(error.code, error.message, error.status);
  }
  if (error instanceof DataSourceQueryError) {
    return errorResponse("INVALID_REQUEST", error.message, 400);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
}

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;
  if (isMysqlDatabaseUrlConfigured()) return {} as AppDatabase;

  const client = await import("@/server/db/client");
  return client.db;
}

/** Spec §5.1: server-side filtered, sorted, paginated source list with facets. */
export function createAdminDataSourcesGet(database?: AppDatabase, mysql?: MysqlSqlReader) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());

  return async function GET(request: Request) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator", "support"] });
      const query = parseSourceListQuery(new URL(request.url).searchParams);
      return NextResponse.json(
        shouldUseMysqlRuntime()
          ? await listAdminDataSourcesPageFromMysql(mysql ?? resolveMysqlPool(), query)
          : await listAdminDataSourcesPage(resolvedDb, query),
      );
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminDataSourcesGet();
