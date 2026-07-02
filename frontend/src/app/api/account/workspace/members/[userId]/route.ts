import { NextResponse } from "next/server";
import { readSessionToken } from "@/server/auth/session";
import { getSessionUser } from "@/server/auth/service";
import { getMysqlSessionUser } from "@/server/auth/mysql-service";
import {
  InvalidWorkspaceInputError,
  WorkspaceLastOwnerError,
  WorkspaceMemberNotFoundError,
  WorkspacePermissionError,
  disableWorkspaceMember,
  removeWorkspaceMember,
  restoreWorkspaceMember,
  updateWorkspaceMemberRole,
} from "@/server/account/workspace";
import {
  disableMysqlWorkspaceMember,
  removeMysqlWorkspaceMember,
  restoreMysqlWorkspaceMember,
  updateMysqlWorkspaceMemberRole,
} from "@/server/account/mysql-workspace";
import { db } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { csrfRejectedResponse, verifyCsrfSafe } from "@/server/security/csrf";

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

async function readBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function workspaceErrorResponse(error: unknown) {
  if (error instanceof WorkspacePermissionError) {
    return errorResponse("FORBIDDEN", error.message, 403);
  }

  if (error instanceof WorkspaceLastOwnerError) {
    return errorResponse("LAST_OWNER_REQUIRED", error.message, 409);
  }

  if (error instanceof WorkspaceMemberNotFoundError) {
    return errorResponse("MEMBER_NOT_FOUND", error.message, 404);
  }

  if (error instanceof InvalidWorkspaceInputError) {
    return errorResponse("INVALID_REQUEST", error.message, 400);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!verifyCsrfSafe(request)) {
    return csrfRejectedResponse();
  }

  const current = await currentUser(request);

  if (!current) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  const { userId } = await context.params;
  const body = await readBody(request);

  if (typeof body !== "object" || body === null) {
    return errorResponse("INVALID_REQUEST", "Request body must include role or status", 400);
  }

  try {
    if ("status" in body) {
      if (body.status === "disabled") {
        return NextResponse.json(
          current.mysql
            ? await disableMysqlWorkspaceMember(current.mysql, current.user.id, userId)
            : disableWorkspaceMember(db, current.user.id, userId),
        );
      }

      if (body.status === "active") {
        return NextResponse.json(
          current.mysql
            ? await restoreMysqlWorkspaceMember(current.mysql, current.user.id, userId)
            : restoreWorkspaceMember(db, current.user.id, userId),
        );
      }
    }

    if (body.role === "owner" || body.role === "member") {
      return NextResponse.json(
        current.mysql
          ? await updateMysqlWorkspaceMemberRole(current.mysql, current.user.id, userId, { role: body.role })
          : updateWorkspaceMemberRole(db, current.user.id, userId, { role: body.role }),
      );
    }

    return errorResponse("INVALID_REQUEST", "Request body must include role or status", 400);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!verifyCsrfSafe(request)) {
    return csrfRejectedResponse();
  }

  const current = await currentUser(request);

  if (!current) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  const { userId } = await context.params;

  try {
    return NextResponse.json(
      current.mysql
        ? await removeMysqlWorkspaceMember(current.mysql, current.user.id, userId)
        : removeWorkspaceMember(db, current.user.id, userId),
    );
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
