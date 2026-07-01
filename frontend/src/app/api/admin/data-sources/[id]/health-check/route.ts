import { NextResponse } from "next/server";
import { requireAdminAccess, AdminAuthError } from "@/server/admin/auth";
import {
  AdminDataSourceNotFoundError,
  listAdminDataSources,
  listAdminDataSourcesFromMysql,
  type AdminDataSource,
  type MysqlDataSourcesStore,
} from "@/server/admin/data-sources-repository";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { checkLiveSourceHealth, type LiveSourceHealthOptions } from "@/server/source-validity/live-source-health";
import {
  recordLiveSourceHealthSnapshot,
  recordLiveSourceHealthSnapshotFromMysql,
} from "@/server/source-validity/health-snapshots";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface HealthCheckRouteOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function routeError(error: unknown) {
  if (error instanceof AdminAuthError) {
    return errorResponse(error.code, error.message, error.status);
  }

  if (error instanceof AdminDataSourceNotFoundError) {
    return errorResponse("DATA_SOURCE_NOT_FOUND", "Data source was not found.", 404);
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
  const timeoutMs = body.timeoutMs === undefined ? undefined : Number(body.timeoutMs);
  const inspectBody = body.inspectBody === undefined ? undefined : body.inspectBody;

  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000)) {
    return null;
  }

  if (inspectBody !== undefined && typeof inspectBody !== "boolean") {
    return null;
  }

  return { timeoutMs, inspectBody };
}

function sourceHealthInput(source: AdminDataSource) {
  return {
    id: source.crawlerSourceId ?? source.id,
    stateCode: source.stateCode,
    label: source.label,
    baseUrl: source.crawlerBaseUrl ?? source.baseUrl,
    sourceAuthority: source.sourceAuthority ?? "official",
    trustStatus: source.trustStatus ?? "verified",
  };
}

function findSource(sources: AdminDataSource[], id: string) {
  const source = sources.find((item) => item.id === id);
  if (!source) {
    throw new AdminDataSourceNotFoundError(id);
  }

  return source;
}

export function createAdminDataSourceHealthCheckPost(
  database?: AppDatabase,
  options: HealthCheckRouteOptions = {},
  mysql?: MysqlDataSourcesStore,
) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());

  return async function POST(request: Request, context: RouteContext) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator"] });

      const body = await parsePostBody(request);
      if (!body) {
        return errorResponse("INVALID_REQUEST", "Source health check body is invalid.", 400);
      }

      const { id } = await context.params;
      const useMysql = shouldUseMysqlRuntime();
      const before = useMysql
        ? await listAdminDataSourcesFromMysql(mysql ?? resolveMysqlPool())
        : await listAdminDataSources(resolvedDb);
      const target = findSource(before.sources, id);

      const healthOptions: LiveSourceHealthOptions = {
        fetchImpl: options.fetchImpl,
        now: options.now,
        timeoutMs: body.timeoutMs,
        inspectBody: body.inspectBody,
      };
      const report = await checkLiveSourceHealth([sourceHealthInput(target)], healthOptions);

      if (useMysql) {
        await recordLiveSourceHealthSnapshotFromMysql(mysql ?? resolveMysqlPool(), report);
      } else {
        recordLiveSourceHealthSnapshot(resolvedDb, report);
      }

      const after = useMysql
        ? await listAdminDataSourcesFromMysql(mysql ?? resolveMysqlPool())
        : await listAdminDataSources(resolvedDb);
      const source = findSource(after.sources, id);

      return NextResponse.json({ report, source });
    } catch (error) {
      return routeError(error);
    }
  };
}

export const POST = createAdminDataSourceHealthCheckPost();
