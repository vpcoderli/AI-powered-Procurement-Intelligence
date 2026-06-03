import { NextResponse } from "next/server";
import { transferWorkspaceOwnership } from "@/server/account/lifecycle";
import { transferMysqlWorkspaceOwnership } from "@/server/account/mysql-workspace";
import { WorkspaceMemberNotFoundError, WorkspacePermissionError } from "@/server/account/workspace";
import { readSessionToken } from "@/server/auth/session";
import { getSessionUser } from "@/server/auth/service";
import { getMysqlSessionUser } from "@/server/auth/mysql-service";
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

  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const user = mysql
    ? await getMysqlSessionUser(mysql, sessionToken)
    : await getSessionUser(db, sessionToken);

  if (!user) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  const body = await readBody(request);

  if (typeof body !== "object" || body === null || typeof body.targetUserId !== "string") {
    return errorResponse("INVALID_REQUEST", "Request body must include targetUserId", 400);
  }

  try {
    return NextResponse.json(
      mysql
        ? await transferMysqlWorkspaceOwnership(mysql, user.id, body.targetUserId)
        : transferWorkspaceOwnership(db, user.id, body.targetUserId),
    );
  } catch (error) {
    if (error instanceof WorkspacePermissionError) {
      return errorResponse("FORBIDDEN", error.message, 403);
    }

    if (error instanceof WorkspaceMemberNotFoundError) {
      return errorResponse("MEMBER_NOT_FOUND", error.message, 404);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
