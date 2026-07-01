import { NextResponse } from "next/server";
import { requireAdminAccess, AdminAuthError } from "@/server/admin/auth";
import {
  listAdminDataSources,
  listAdminDataSourcesFromMysql,
  type MysqlDataSourcesStore,
} from "@/server/admin/data-sources-repository";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";

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

export function createAdminDataSourcesGet(database?: AppDatabase, mysql?: MysqlDataSourcesStore) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());

  return async function GET(request: Request) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator", "support"] });
      return NextResponse.json(
        shouldUseMysqlRuntime()
          ? await listAdminDataSourcesFromMysql(mysql ?? resolveMysqlPool())
          : await listAdminDataSources(resolvedDb),
      );
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminDataSourcesGet();
