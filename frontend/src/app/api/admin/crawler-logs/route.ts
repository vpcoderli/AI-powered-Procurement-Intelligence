import { NextResponse } from "next/server";
import { requireAdminAccess, AdminAuthError } from "@/server/admin/auth";
import {
  listAdminCrawlerLogs,
  listAdminCrawlerLogsFromMysql,
  type MysqlAdminCrawlerLogsReader,
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

function limitFromUrl(request: Request) {
  const value = new URL(request.url).searchParams.get("limit");
  if (!value) return undefined;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;

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
      await requireAdminAccess(resolved.authDatabase, request);
      const logs = resolved.logsMysql
        ? await listAdminCrawlerLogsFromMysql(resolved.logsMysql, { limit: limitFromUrl(request) })
        : await listAdminCrawlerLogs(resolved.logsDatabase, { limit: limitFromUrl(request) });

      return NextResponse.json({ logs });
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminCrawlerLogsGet();
