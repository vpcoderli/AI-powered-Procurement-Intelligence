import { NextResponse } from "next/server";
import { readSessionToken } from "@/server/auth/session";
import {
  AccountDisabledError,
  InvalidAuthInputError,
  getSessionUser,
  updateUserProfile,
} from "@/server/auth/service";
import { getMysqlSessionUser, updateMysqlUserProfile } from "@/server/auth/mysql-service";
import { db } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function readBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function PATCH(request: Request) {
  const sessionToken = readSessionToken(request);

  if (!sessionToken) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  const body = await readBody(request);

  if (
    typeof body !== "object" ||
    body === null ||
    !("displayName" in body) ||
    typeof body.displayName !== "string"
  ) {
    return errorResponse("INVALID_REQUEST", "Request body must include displayName", 400);
  }

  try {
    const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
    const sessionUser = mysql
      ? await getMysqlSessionUser(mysql, sessionToken)
      : await getSessionUser(db, sessionToken);

    if (!sessionUser) {
      return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
    }

    const input = { displayName: body.displayName };
    const user = mysql
      ? await updateMysqlUserProfile(mysql, sessionUser.id, input)
      : await updateUserProfile(db, sessionUser.id, input);

    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof InvalidAuthInputError) {
      return errorResponse("INVALID_REQUEST", error.message, 400);
    }

    if (error instanceof AccountDisabledError) {
      return errorResponse("ACCOUNT_DISABLED", error.message, 403);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
