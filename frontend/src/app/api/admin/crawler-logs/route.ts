import { NextResponse } from "next/server";
import { requireAdminAccess, AdminAuthError } from "@/server/admin/auth";
import {
  listAdminCrawlerLogs,
  listAdminCrawlerLogsFromMysql,
  normalizeCrawlerLogLimit,
  type AdminCrawlerLogsOptions,
  type MysqlAdminCrawlerLogsReader,
} from "@/server/admin/data-sources-repository";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";

class CrawlerLogsQueryError extends Error {}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function routeError(error: unknown) {
  if (error instanceof AdminAuthError) {
    return errorResponse(error.code, error.message, error.status);
  }
  if (error instanceof CrawlerLogsQueryError) {
    return errorResponse("INVALID_REQUEST", error.message, 400);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
}

const MAX_LOG_SOURCES = 10;

function logOptionsFromUrl(request: Request): AdminCrawlerLogsOptions {
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit");
  const parsedLimit = rawLimit ? Number(rawLimit) : Number.NaN;
  const sources = Array.from(new Set(params.getAll("source").map((value) => value.trim()).filter(Boolean)));
  if (sources.length > MAX_LOG_SOURCES) throw new CrawlerLogsQueryError(`at most ${MAX_LOG_SOURCES} source values`);
  const before = params.get("before")?.trim() || null;
  const beforeId = params.get("beforeId")?.trim() || null;
  if (beforeId && !before) throw new CrawlerLogsQueryError("beforeId requires before");
  if ((before?.length ?? 0) > 64 || (beforeId?.length ?? 0) > 191) throw new CrawlerLogsQueryError("cursor is too long");

  return { limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined, sources, before, beforeId };
}

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;
  if (isMysqlDatabaseUrlConfigured()) return {} as AppDatabase;

  const client = await import("@/server/db/client");
  return client.db;
}

interface AdminCrawlerLogsDependencies {
  database?: AppDatabase;
  mysql?: MysqlAdminCrawlerLogsReader;
}

function isDatabaseDependency(value: AdminCrawlerLogsDependencies | AppDatabase | undefined): value is AppDatabase {
  return Boolean(value && "select" in value);
}

async function resolveDependencies(dependencies?: AdminCrawlerLogsDependencies | AppDatabase) {
  if (isDatabaseDependency(dependencies)) {
    return {
      authDatabase: dependencies,
      logsDatabase: dependencies,
    };
  }

  const authDatabase = await resolveDatabase(dependencies?.database);
  if (dependencies?.mysql) {
    return {
      authDatabase,
      logsMysql: dependencies.mysql,
    };
  }

  if (isMysqlDatabaseUrlConfigured()) {
    return {
      authDatabase,
      logsMysql: resolveMysqlPool(),
    };
  }

  return {
    authDatabase,
    logsDatabase: authDatabase,
  };
}

export function createAdminCrawlerLogsGet(dependencies?: AdminCrawlerLogsDependencies | AppDatabase) {
  return async function GET(request: Request) {
    try {
      const resolved = await resolveDependencies(dependencies);
      await requireAdminAccess(resolved.authDatabase, request, { roles: ["admin", "operator", "support"] });
      const options = logOptionsFromUrl(request);
      const logs = resolved.logsMysql
        ? await listAdminCrawlerLogsFromMysql(resolved.logsMysql, options)
        : await listAdminCrawlerLogs(resolved.logsDatabase, options);
      const last = logs.at(-1);
      const nextCursor = last && logs.length === normalizeCrawlerLogLimit(options.limit) ? { before: last.startedAt, beforeId: last.id } : null;

      return NextResponse.json({ logs, nextCursor });
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminCrawlerLogsGet();
