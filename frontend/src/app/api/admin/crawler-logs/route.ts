import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/server/admin/auth";
import { listAdminCrawlerLogs } from "@/server/admin/data-sources-repository";
import type { AppDatabase } from "@/server/db/client";

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

export function createAdminCrawlerLogsGet(database?: AppDatabase) {
  return async function GET(request: Request) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdmin(resolvedDb, request);
      const logs = await listAdminCrawlerLogs(resolvedDb, { limit: limitFromUrl(request) });

      return NextResponse.json({ logs });
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminCrawlerLogsGet();
