import { NextResponse } from "next/server";
import { AdminAuthError, requireAdmin } from "@/server/admin/auth";
import type { AppDatabase } from "@/server/db/client";
import { deliverPendingNotifications } from "@/server/notifications/delivery";

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
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdmin(resolvedDb, request);
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
