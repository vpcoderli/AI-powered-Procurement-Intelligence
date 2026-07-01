import { NextResponse } from "next/server";
import { readSessionToken } from "@/server/auth/session";
import { getSessionUser } from "@/server/auth/service";
import { getMysqlSessionUser } from "@/server/auth/mysql-service";
import { db } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { logger } from "@/lib/observability/logger";

const routeLogger = logger.child({ service: "api:auth:session" });

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request) {
  const sessionToken = readSessionToken(request);

  try {
    if (!sessionToken) {
      return NextResponse.json({ user: null });
    }

    const user = isMysqlDatabaseUrlConfigured()
      ? await getMysqlSessionUser(resolveMysqlPool(), sessionToken)
      : await getSessionUser(db, sessionToken);

    return NextResponse.json({ user });
  } catch (error) {
    routeLogger.error("session_lookup_unexpected_error", { error });
    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
