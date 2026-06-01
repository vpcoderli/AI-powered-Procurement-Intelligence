import { NextResponse } from "next/server";
import {
  getAccountNotificationPreferences,
  getAccountNotificationPreferencesFromMysql,
  updateAccountNotificationPreferences,
  updateAccountNotificationPreferencesFromMysql,
  type UpdateAccountNotificationPreferencesInput,
} from "@/server/account/notification-preferences";
import { readSessionToken } from "@/server/auth/session";
import { getSessionUser } from "@/server/auth/service";
import { getMysqlSessionUser } from "@/server/auth/mysql-service";
import { db } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function currentUser(request: Request) {
  const sessionToken = readSessionToken(request);
  if (!sessionToken) return null;

  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const user = mysql
    ? await getMysqlSessionUser(mysql, sessionToken)
    : await getSessionUser(db, sessionToken);

  return user ? { mysql, user } : null;
}

async function readBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function preferenceInput(body: unknown): UpdateAccountNotificationPreferencesInput | null {
  if (typeof body !== "object" || body === null) return null;

  const record = body as Record<string, unknown>;
  const input: UpdateAccountNotificationPreferencesInput = {};

  if ("savedSearchAlertsEnabled" in record) {
    if (typeof record.savedSearchAlertsEnabled !== "boolean") return null;
    input.savedSearchAlertsEnabled = record.savedSearchAlertsEnabled;
  }

  if ("defaultAlertFrequency" in record) {
    if (record.defaultAlertFrequency !== "daily" && record.defaultAlertFrequency !== "weekly") return null;
    input.defaultAlertFrequency = record.defaultAlertFrequency;
  }

  if ("marketingUpdatesEnabled" in record) {
    if (typeof record.marketingUpdatesEnabled !== "boolean") return null;
    input.marketingUpdatesEnabled = record.marketingUpdatesEnabled;
  }

  return input;
}

export async function GET(request: Request) {
  const current = await currentUser(request);

  if (!current) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  try {
    return NextResponse.json(
      current.mysql
        ? await getAccountNotificationPreferencesFromMysql(current.mysql, current.user.id)
        : getAccountNotificationPreferences(db, current.user.id),
    );
  } catch {
    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}

export async function PATCH(request: Request) {
  const current = await currentUser(request);

  if (!current) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  const input = preferenceInput(await readBody(request));

  if (!input) {
    return errorResponse("INVALID_REQUEST", "Invalid notification preferences", 400);
  }

  try {
    return NextResponse.json(
      current.mysql
        ? await updateAccountNotificationPreferencesFromMysql(current.mysql, current.user.id, input)
        : updateAccountNotificationPreferences(db, current.user.id, input),
    );
  } catch {
    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
