import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminAccess } from "@/server/admin/auth";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured } from "@/server/db/mysql";
import { deliverPendingNotifications } from "@/server/notifications/delivery";
import { csrfRejectedResponse, verifyCsrfSafe } from "@/server/security/csrf";

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

async function readBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function positiveInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

export function createAdminNotificationsDeliverPost(database?: AppDatabase) {
  return async function POST(request: Request) {
    if (!verifyCsrfSafe(request)) {
      return csrfRejectedResponse();
    }

    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator"] });
      const body = await readBody(request);

      return NextResponse.json(await deliverPendingNotifications(resolvedDb, undefined, {
        limit: positiveInteger((body as { limit?: unknown }).limit),
        maxAttempts: positiveInteger((body as { maxAttempts?: unknown }).maxAttempts),
      }));
    } catch (error) {
      return routeError(error);
    }
  };
}

export const POST = createAdminNotificationsDeliverPost();
