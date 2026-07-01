import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminAccess } from "@/server/admin/auth";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { listRecentNotifications, listRecentNotificationsFromMysql } from "@/server/notifications/outbox-repository";
import type { NotificationStatus } from "@/server/notifications/types";

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

function limitFromUrl(request: Request) {
  const value = new URL(request.url).searchParams.get("limit");
  if (!value) return undefined;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function statusFromUrl(request: Request): NotificationStatus | undefined {
  const status = new URL(request.url).searchParams.get("status");
  return status === "pending" || status === "sent" || status === "failed" ? status : undefined;
}

export function createAdminNotificationsGet(database?: AppDatabase) {
  return async function GET(request: Request) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator", "support"] });

      const options = {
          limit: limitFromUrl(request),
          status: statusFromUrl(request),
        };

      return NextResponse.json({
        notifications: isMysqlDatabaseUrlConfigured()
          ? await listRecentNotificationsFromMysql(resolveMysqlPool(), options)
          : listRecentNotifications(resolvedDb, options),
      });
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminNotificationsGet();
