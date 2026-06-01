import { NextResponse } from "next/server";
import { readSessionToken } from "@/server/auth/session";
import {
  AccountDisabledError,
  InvalidCredentialsError,
  WeakPasswordError,
  changeUserPassword,
  getSessionUser,
} from "@/server/auth/service";
import { changeMysqlUserPassword, getMysqlSessionUser } from "@/server/auth/mysql-service";
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

export async function POST(request: Request) {
  const sessionToken = readSessionToken(request);

  if (!sessionToken) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  const body = await readBody(request);

  if (
    typeof body !== "object" ||
    body === null ||
    typeof body.currentPassword !== "string" ||
    typeof body.newPassword !== "string"
  ) {
    return errorResponse("INVALID_REQUEST", "Request body must include currentPassword and newPassword", 400);
  }

  try {
    const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
    const sessionUser = mysql
      ? await getMysqlSessionUser(mysql, sessionToken)
      : await getSessionUser(db, sessionToken);

    if (!sessionUser) {
      return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
    }

    const input = {
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    };

    if (mysql) {
      await changeMysqlUserPassword(mysql, sessionUser.id, input);
    } else {
      await changeUserPassword(db, sessionUser.id, input);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      return errorResponse("INVALID_CREDENTIALS", error.message, 401);
    }

    if (error instanceof WeakPasswordError) {
      return errorResponse("WEAK_PASSWORD", error.message, 400);
    }

    if (error instanceof AccountDisabledError) {
      return errorResponse("ACCOUNT_DISABLED", error.message, 403);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
