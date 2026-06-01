import { NextResponse } from "next/server";
import {
  AccountDeletionRequiresOwnerTransferError,
  AccountLifecycleUserNotFoundError,
  softDeleteAccount,
} from "@/server/account/lifecycle";
import { softDeleteMysqlAccount } from "@/server/account/mysql-lifecycle";
import { clearSessionCookie, readSessionToken } from "@/server/auth/session";
import { getSessionUser } from "@/server/auth/service";
import { getMysqlSessionUser } from "@/server/auth/mysql-service";
import { db } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function DELETE(request: Request) {
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

  try {
    const response = NextResponse.json(
      mysql ? await softDeleteMysqlAccount(mysql, user.id) : softDeleteAccount(db, user.id),
    );
    response.headers.append("Set-Cookie", clearSessionCookie());

    return response;
  } catch (error) {
    if (error instanceof AccountDeletionRequiresOwnerTransferError) {
      return errorResponse("OWNER_TRANSFER_REQUIRED", error.message, 409);
    }

    if (error instanceof AccountLifecycleUserNotFoundError) {
      return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
