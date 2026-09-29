import { NextResponse } from "next/server";
import { requireAdminAccess, AdminAuthError } from "@/server/admin/auth";
import type { MysqlDataSourcesStore } from "@/server/admin/data-sources-repository";
import {
  PrecheckRequestInputError,
  normalizeRequestPrechecksInput,
  requestPrechecks,
  requestPrechecksFromMysql,
} from "@/server/admin/precheck-queue";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { csrfRejectedResponse, verifyCsrfSafe } from "@/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function routeError(error: unknown) {
  if (error instanceof AdminAuthError) {
    return errorResponse(error.code, error.message, error.status);
  }

  if (error instanceof PrecheckRequestInputError) {
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

/**
 * Queues sources for the crawler worker's precheck loop (spec 2026-09-24 §7.2): sets
 * `data_sources.precheck_requested_at`, nothing else. The precheck itself runs later, inside the
 * worker's platform budget — this route never fetches a portal.
 */
export function createAdminPrecheckRequestsPost(database?: AppDatabase, mysql?: MysqlDataSourcesStore) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());

  return async function POST(request: Request) {
    if (!verifyCsrfSafe(request)) return csrfRejectedResponse();

    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator"] });
      const input = normalizeRequestPrechecksInput(await request.json().catch(() => null));
      const now = new Date();
      const store = shouldUseMysqlRuntime() ? mysql ?? resolveMysqlPool() : null;
      const result = store ? await requestPrechecksFromMysql(store, input, now) : requestPrechecks(resolvedDb, input, now);
      return NextResponse.json(result);
    } catch (error) {
      return routeError(error);
    }
  };
}

export const POST = createAdminPrecheckRequestsPost();
