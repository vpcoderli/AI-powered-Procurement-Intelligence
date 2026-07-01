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
import { getClientIp } from "@/server/security/request-ip";
import { loginGuard } from "@/server/security/login-guard";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function rateLimitedResponse(retryAfterSeconds: number) {
  const response = errorResponse(
    "TOO_MANY_REQUESTS",
    "Too many login attempts. Please try again later.",
    429,
  );
  response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
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

  const clientIp = getClientIp(request);
  const guardOutcome = loginGuard.checkLoginAllowed(clientIp, body.email);

  if (guardOutcome.blocked) {
    return rateLimitedResponse(guardOutcome.retryAfterSeconds);
  }

  try {
    const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
    const result = mysql
      ? await loginMysqlUser(mysql, body.email, body.password)
      : await loginUser(db, body.email, body.password);
    const anonymousUser = resolveAnonymousUser(request);

    loginGuard.recordLoginSuccess(body.email);

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

    return response;
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      loginGuard.recordLoginFailure(body.email);
      return errorResponse("INVALID_CREDENTIALS", error.message, 401);
    }

    if (error instanceof AccountDisabledError) {
      return errorResponse("ACCOUNT_DISABLED", error.message, 403);
    }

    if (error instanceof InvalidAuthInputError) {
      return errorResponse("INVALID_REQUEST", error.message, 400);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
