import { NextResponse } from "next/server";
import { requireAdminAccess, AdminAuthError } from "@/server/admin/auth";
import { listAdminDataSources } from "@/server/admin/data-sources-repository";
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

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;

  const client = await import("@/server/db/client");
  return client.db;
}

export function createAdminDataSourcesGet(database?: AppDatabase) {
  return async function GET(request: Request) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request);
      return NextResponse.json(await listAdminDataSources(resolvedDb));
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminDataSourcesGet();
