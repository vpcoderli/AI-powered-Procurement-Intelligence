import { NextResponse } from "next/server";
import { createSessionCookie } from "@/server/auth/session";
import {
  AccountDisabledError,
  InvalidAuthInputError,
  InvalidCredentialsError,
  loginUser,
} from "@/server/auth/service";
import { loginMysqlUser } from "@/server/auth/mysql-service";
import { mergeSavedBidIds, mergeSavedBidIdsFromMysql } from "@/server/bids/repository";
import { clearAnonymousUserCookie, resolveAnonymousUser } from "@/server/bids/user";
import { db } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { logger } from "@/lib/observability/logger";

const routeLogger = logger.child({ service: "api:auth:login" });

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
  const body = await readBody(request);

  if (
    typeof body !== "object" ||
    body === null ||
    typeof body.email !== "string" ||
    typeof body.password !== "string"
  ) {
    return errorResponse("INVALID_REQUEST", "Request body must include email and password", 400);
  }

  try {
    const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
    const result = mysql
      ? await loginMysqlUser(mysql, body.email, body.password)
      : await loginUser(db, body.email, body.password);
    const anonymousUser = resolveAnonymousUser(request);

    if (!anonymousUser.isNewUser) {
      if (mysql) {
        await mergeSavedBidIdsFromMysql(mysql, anonymousUser.userId, result.user.id);
      } else {
        await mergeSavedBidIds(db, anonymousUser.userId, result.user.id);
      }
    }

    const response = NextResponse.json({ user: result.user });
    response.headers.append("Set-Cookie", createSessionCookie(result.sessionToken));

    if (!anonymousUser.isNewUser) {
      response.headers.append("Set-Cookie", clearAnonymousUserCookie());
    }

    routeLogger.info("login_succeeded", { userId: result.user.id });

    return response;
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      routeLogger.warn("login_failed", { reason: "invalid_credentials" });
      return errorResponse("INVALID_CREDENTIALS", error.message, 401);
    }

    if (error instanceof AccountDisabledError) {
      routeLogger.warn("login_failed", { reason: "account_disabled" });
      return errorResponse("ACCOUNT_DISABLED", error.message, 403);
    }

    if (error instanceof InvalidAuthInputError) {
      return errorResponse("INVALID_REQUEST", error.message, 400);
    }

    routeLogger.error("login_unexpected_error", { error });
    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
