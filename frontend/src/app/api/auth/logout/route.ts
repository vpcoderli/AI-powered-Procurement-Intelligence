import { NextResponse } from "next/server";
import { clearSessionCookie, readSessionToken } from "@/server/auth/session";
import { logoutSession } from "@/server/auth/service";
import { logoutMysqlSession } from "@/server/auth/mysql-service";
import { db } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  const sessionToken = readSessionToken(request);

  try {
    if (sessionToken) {
      if (isMysqlDatabaseUrlConfigured()) {
        await logoutMysqlSession(resolveMysqlPool(), sessionToken);
      } else {
        await logoutSession(db, sessionToken);
      }
    }

    const response = NextResponse.json({ ok: true });
    response.headers.set("Set-Cookie", clearSessionCookie());

    return response;
  } catch {
    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
