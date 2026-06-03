import { NextResponse } from "next/server";
import { readSessionToken } from "@/server/auth/session";
import { getSessionUser } from "@/server/auth/service";
import { getMysqlSessionUser } from "@/server/auth/mysql-service";
import {
  WorkspaceInvitationNotFoundError,
  WorkspacePermissionError,
  resendWorkspaceInvitation,
} from "@/server/account/workspace";
import { resendMysqlWorkspaceInvitation } from "@/server/account/mysql-workspace";
import { db } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";

interface RouteContext {
  params: Promise<{ userId: string }>;
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function currentUser(request: Request) {
  const sessionToken = readSessionToken(request);
  if (!sessionToken) return null;

  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const user = mysql
    ? await getMysqlSessionUser(mysql, sessionToken)
    : await getSessionUser(db, sessionToken);

  return user ? { mysql, user } : null;
}

export async function POST(request: Request, context: RouteContext) {
  const current = await currentUser(request);

  if (!current) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  const { userId } = await context.params;

  try {
    return NextResponse.json(
      current.mysql
        ? await resendMysqlWorkspaceInvitation(current.mysql, current.user.id, userId)
        : resendWorkspaceInvitation(db, current.user.id, userId),
    );
  } catch (error) {
    if (error instanceof WorkspacePermissionError) {
      return errorResponse("FORBIDDEN", error.message, 403);
    }

    if (error instanceof WorkspaceInvitationNotFoundError) {
      return errorResponse("INVITATION_NOT_FOUND", error.message, 404);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
