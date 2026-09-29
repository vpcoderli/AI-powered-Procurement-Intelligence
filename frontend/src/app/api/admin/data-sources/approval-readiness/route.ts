import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminAccess } from "@/server/admin/auth";
import {
  listAdminDataSources,
  listAdminDataSourcesFromMysql,
  type MysqlDataSourcesStore,
} from "@/server/admin/data-sources-repository";
import { summarizeApprovalReadiness } from "@/server/admin/ledgered-approval";
import {
  listPlatformReviews,
  listPlatformReviewsFromMysql,
  type MysqlPlatformReviewsStore,
} from "@/server/admin/platform-reviews-repository";
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

/**
 * Where the local sources stand against the ledgered batch approval (spec 2026-09-24 §7.3): one
 * bucket per source (approvable / awaiting precheck / needs fix / missing platform review /
 * approved / blocked), the counts per bucket, and — when a platform is named — its effective
 * platform review. Served here rather than computed in the browser so the console, the script and
 * the runbook share one definition. Read-only; every admin-console role may call it.
 */
export function createAdminApprovalReadinessGet(database?: AppDatabase, mysql?: MysqlDataSourcesStore & MysqlPlatformReviewsStore) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());

  return async function GET(request: Request) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator", "support"] });
      const providerFamily = new URL(request.url).searchParams.get("providerFamily")?.trim().toLowerCase() || null;
      const store = shouldUseMysqlRuntime() ? mysql ?? resolveMysqlPool() : null;
      const { sources } = store ? await listAdminDataSourcesFromMysql(store) : await listAdminDataSources(resolvedDb);
      const reviews = store ? await listPlatformReviewsFromMysql(store) : listPlatformReviews(resolvedDb);
      return NextResponse.json(summarizeApprovalReadiness(sources, reviews, new Date(), providerFamily));
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminApprovalReadinessGet();
