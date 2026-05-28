import { NextResponse } from "next/server";
import { readSessionToken } from "@/server/auth/session";
import { getSessionUser } from "@/server/auth/service";
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
import { db } from "@/server/db/client";

interface RouteContext {
  params: Promise<{ userId: string }>;
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function currentUser(request: Request) {
  const sessionToken = readSessionToken(request);
  if (!sessionToken) return null;

  return getSessionUser(db, sessionToken);
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
  const user = await currentUser(request);

  if (!user) {
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
        return NextResponse.json(disableWorkspaceMember(db, user.id, userId));
      }

      if (body.status === "active") {
        return NextResponse.json(restoreWorkspaceMember(db, user.id, userId));
      }
    }

    if (body.role === "owner" || body.role === "member") {
      return NextResponse.json(updateWorkspaceMemberRole(db, user.id, userId, { role: body.role }));
    }

    return errorResponse("INVALID_REQUEST", "Request body must include role or status", 400);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const user = await currentUser(request);

  if (!user) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  const { userId } = await context.params;

  try {
    return NextResponse.json(removeWorkspaceMember(db, user.id, userId));
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
