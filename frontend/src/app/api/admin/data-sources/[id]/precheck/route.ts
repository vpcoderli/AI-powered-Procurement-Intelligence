import { NextResponse } from "next/server";
import { requireAdminAccess, AdminAuthError } from "@/server/admin/auth";
import { AdminDataSourceNotFoundError, type MysqlDataSourcesStore } from "@/server/admin/data-sources-repository";
import {
  DEFAULT_PRECHECK_LIMIT,
  runSourcePrecheck,
  SourcePrecheckFailedError,
  type RunSourcePrecheckOptions,
} from "@/server/admin/source-precheck";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { csrfRejectedResponse, verifyCsrfSafe } from "@/server/security/csrf";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface PrecheckRouteOptions {
  now?: Date;
  runSourcePrecheck?: typeof runSourcePrecheck;
  precheckOverrides?: Pick<RunSourcePrecheckOptions, "runCrawlTask" | "discoverTenant" | "scanCompliance">;
}

const MAX_PRECHECK_LIMIT = 25;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function routeError(error: unknown) {
  if (error instanceof AdminAuthError) {
    return errorResponse(error.code, error.message, error.status);
  }

  if (error instanceof AdminDataSourceNotFoundError) {
    return errorResponse("SOURCE_NOT_FOUND", "Data source was not found.", 404);
  }

  if (error instanceof SourcePrecheckFailedError) {
    // The crawler subprocess could not be run at all — an environment problem on our side,
    // not the portal's answer, so it is reported as an upstream failure rather than a verdict.
    return errorResponse("PRECHECK_FAILED", error.message, 502);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
}

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;
  if (isMysqlDatabaseUrlConfigured()) return {} as AppDatabase;

  const client = await import("@/server/db/client");
  return client.db;
}

async function parsePostBody(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (body === null || typeof body !== "object") return null;

  if (body.limit === undefined) return { limit: DEFAULT_PRECHECK_LIMIT };

  const limit = body.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_PRECHECK_LIMIT) return null;

  return { limit };
}

export function createAdminDataSourcePrecheckPost(
  database?: AppDatabase,
  options: PrecheckRouteOptions = {},
  mysql?: MysqlDataSourcesStore,
) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());
  const precheck = options.runSourcePrecheck ?? runSourcePrecheck;

  return async function POST(request: Request, context: RouteContext) {
    if (!verifyCsrfSafe(request)) {
      return csrfRejectedResponse();
    }

    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator"] });

      const body = await parsePostBody(request);
      if (!body) {
        return errorResponse("INVALID_REQUEST", `limit must be an integer between 1 and ${MAX_PRECHECK_LIMIT}.`, 400);
      }

      const { id } = await context.params;
      const result = await precheck({
        database: resolvedDb,
        mysql: shouldUseMysqlRuntime() ? mysql ?? resolveMysqlPool() : undefined,
        sourceId: id,
        limit: body.limit,
        ...(options.now ? { now: options.now } : {}),
        ...options.precheckOverrides,
      });

      return NextResponse.json(result);
    } catch (error) {
      return routeError(error);
    }
  };
}

export const POST = createAdminDataSourcePrecheckPost();
