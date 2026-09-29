import { NextResponse } from "next/server";
import { requireAdminAccess, AdminAuthError } from "@/server/admin/auth";
import { getAdminOverview, getAdminOverviewFromMysql, type AdminOverviewMysqlStore } from "@/server/admin/overview";
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

/** Spec §4.1: the admin overview; a failed section comes back null with errors[section]. */
export function createAdminOverviewGet(database?: AppDatabase, mysql?: AdminOverviewMysqlStore) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());

  return async function GET(request: Request) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator", "support"] });
      return NextResponse.json(
        shouldUseMysqlRuntime() ? await getAdminOverviewFromMysql(mysql ?? resolveMysqlPool()) : await getAdminOverview(resolvedDb),
      );
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminOverviewGet();
