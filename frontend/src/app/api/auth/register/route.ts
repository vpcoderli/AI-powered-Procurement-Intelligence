import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import {
  DuplicateEmailError,
  InvalidAuthInputError,
  WeakPasswordError,
  registerUser,
} from "@/server/auth/service";
import { registerMysqlUser } from "@/server/auth/mysql-service";
import { createSessionCookie } from "@/server/auth/session";
import { mergeSavedBidIds, mergeSavedBidIdsFromMysql } from "@/server/bids/repository";
import { clearAnonymousUserCookie, resolveAnonymousUser } from "@/server/bids/user";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { recordMarketingFunnelEvent, recordMarketingFunnelEventFromMysql } from "@/server/marketing/funnel";

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
    typeof body.password !== "string" ||
    ("displayName" in body && typeof body.displayName !== "string") ||
    ("marketingIntent" in body && body.marketingIntent !== undefined && body.marketingIntent !== "demo") ||
    ("leadEventId" in body && body.leadEventId !== undefined && typeof body.leadEventId !== "string")
  ) {
    return errorResponse("INVALID_REQUEST", "Request body must include email and password", 400);
  }

  if (body.password.length < 8) {
    return errorResponse("WEAK_PASSWORD", "Password must be at least 8 characters", 400);
  }

  try {
    const mysqlEnabled = isMysqlDatabaseUrlConfigured();
    const mysql = mysqlEnabled ? resolveMysqlPool() : null;
    const result = mysql
      ? await registerMysqlUser(mysql, {
          email: body.email,
          password: body.password,
          displayName: body.displayName,
        })
      : await registerUser(db, {
          email: body.email,
          password: body.password,
          displayName: body.displayName,
        });
    const anonymousUser = resolveAnonymousUser(request);

    if (!anonymousUser.isNewUser) {
      if (mysql) {
        await mergeSavedBidIdsFromMysql(mysql, anonymousUser.userId, result.user.id);
      } else {
        await mergeSavedBidIds(db, anonymousUser.userId, result.user.id);
      }
    }

    const response = NextResponse.json({ user: result.user }, { status: 201 });
    response.headers.append("Set-Cookie", createSessionCookie(result.sessionToken));

    if (!anonymousUser.isNewUser) {
      response.headers.append("Set-Cookie", clearAnonymousUserCookie());
    }

    if (body.marketingIntent === "demo") {
      const funnelEvent = {
        eventName: "marketing.complete_signup" as const,
        actorId: result.user.id,
        targetId: body.leadEventId ?? result.user.id,
        metadata: {
          email: result.user.email,
          marketingIntent: "demo",
          leadEventId: body.leadEventId ?? null,
        },
      };

      if (mysql) {
        await recordMarketingFunnelEventFromMysql(mysql, funnelEvent);
      } else {
        recordMarketingFunnelEvent(db, funnelEvent);
      }
    }

    return response;
  } catch (error) {
    if (error instanceof DuplicateEmailError) {
      return errorResponse("EMAIL_ALREADY_REGISTERED", error.message, 409);
    }

    if (error instanceof WeakPasswordError) {
      return errorResponse("WEAK_PASSWORD", error.message, 400);
    }

    if (error instanceof InvalidAuthInputError) {
      return errorResponse("INVALID_REQUEST", error.message, 400);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
