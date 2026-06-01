import { NextResponse } from "next/server";
import { exportAccountData, exportMysqlAccountData } from "@/server/account/lifecycle";
import { readSessionToken } from "@/server/auth/session";
import { getSessionUser } from "@/server/auth/service";
import { getMysqlSessionUser } from "@/server/auth/mysql-service";
import { db } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request) {
  const sessionToken = readSessionToken(request);

  if (!sessionToken) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const user = mysql
    ? await getMysqlSessionUser(mysql, sessionToken)
    : await getSessionUser(db, sessionToken);

  if (!user) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  return NextResponse.json(mysql ? await exportMysqlAccountData(mysql, user.id) : exportAccountData(db, user.id), {
    headers: {
      "Content-Disposition": `attachment; filename="winbids-account-export-${user.id}.json"`,
    },
  });
}
