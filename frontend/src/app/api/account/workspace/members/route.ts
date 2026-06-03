import { NextResponse } from "next/server";
import { readSessionToken } from "@/server/auth/session";
import { getSessionUser } from "@/server/auth/service";
import { getMysqlSessionUser } from "@/server/auth/mysql-service";
import { UsageLimitError } from "@/server/auth/usage-limits";
import {
  InvalidWorkspaceInputError,
  WorkspaceEmailExistsError,
  WorkspacePermissionError,
  inviteWorkspaceMember,
} from "@/server/account/workspace";
import { inviteMysqlWorkspaceMember } from "@/server/account/mysql-workspace";
import { db } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function usageLimitResponse(error: UsageLimitError) {
  return NextResponse.json({
    error: {
      code: error.code,
      message: "Upgrade your plan to add more team members.",
      feature: error.feature,
      limit: error.limit,
      used: error.used,
      requiredTier: error.requiredTier,
    },
  }, { status: 402 });
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

  if (
    typeof body !== "object" ||
    body === null ||
    typeof body.email !== "string" ||
    ("displayName" in body && typeof body.displayName !== "string") ||
    ("role" in body && body.role !== "owner" && body.role !== "member")
  ) {
    return errorResponse("INVALID_REQUEST", "Request body must include email", 400);
  }

  try {
    const result = mysql ? await inviteMysqlWorkspaceMember(mysql, user.id, {
      email: body.email,
      displayName: body.displayName,
      role: body.role,
    }) : await inviteWorkspaceMember(db, user.id, {
      email: body.email,
      displayName: body.displayName,
      role: body.role,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof UsageLimitError) {
      return usageLimitResponse(error);
    }

    if (error instanceof WorkspaceEmailExistsError) {
      return errorResponse("EMAIL_ALREADY_REGISTERED", error.message, 409);
    }

    if (error instanceof WorkspacePermissionError) {
      return errorResponse("FORBIDDEN", error.message, 403);
    }

    if (error instanceof InvalidWorkspaceInputError) {
      return errorResponse("INVALID_REQUEST", error.message, 400);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
