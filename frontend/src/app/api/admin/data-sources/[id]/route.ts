import { NextResponse } from "next/server";
import { requireAdminAccess, AdminAuthError } from "@/server/admin/auth";
import {
  AdminDataSourceNotFoundError,
  updateAdminDataSource,
} from "@/server/admin/data-sources-repository";
import type { AppDatabase } from "@/server/db/client";

interface RouteContext {
  params: Promise<{ id: string }>;
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

async function parsePatchBody(request: Request) {
  const body = (await request.json().catch(() => null)) as { isEnabled?: unknown } | null;
  if (!body || typeof body.isEnabled !== "boolean") {
    return null;
  }

  return { isEnabled: body.isEnabled };
}

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;

  const client = await import("@/server/db/client");
  return client.db;
}

export function createAdminDataSourcePatch(database?: AppDatabase) {
  return async function PATCH(request: Request, context: RouteContext) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator"] });

      const input = await parsePatchBody(request);
      if (!input) {
        return errorResponse("INVALID_REQUEST", "Request body must include isEnabled.", 400);
      }

      const { id } = await context.params;
      const source = await updateAdminDataSource(resolvedDb, id, input);

      return NextResponse.json({ source });
    } catch (error) {
      return routeError(error);
    }
  };
}

export const PATCH = createAdminDataSourcePatch();
