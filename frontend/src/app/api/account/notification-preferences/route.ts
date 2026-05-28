import { NextResponse } from "next/server";
import {
  getAccountNotificationPreferences,
  updateAccountNotificationPreferences,
  type UpdateAccountNotificationPreferencesInput,
} from "@/server/account/notification-preferences";
import { readSessionToken } from "@/server/auth/session";
import { getSessionUser } from "@/server/auth/service";
import { db } from "@/server/db/client";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function currentUser(request: Request) {
  const sessionToken = readSessionToken(request);
  if (!sessionToken) return null;

  return getSessionUser(db, sessionToken);
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
  const user = await currentUser(request);

  if (!user) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  try {
    return NextResponse.json(getAccountNotificationPreferences(db, user.id));
  } catch {
    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}

export async function PATCH(request: Request) {
  const user = await currentUser(request);

  if (!user) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  const input = preferenceInput(await readBody(request));

  if (!input) {
    return errorResponse("INVALID_REQUEST", "Invalid notification preferences", 400);
  }

  try {
    return NextResponse.json(updateAccountNotificationPreferences(db, user.id, input));
  } catch {
    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
