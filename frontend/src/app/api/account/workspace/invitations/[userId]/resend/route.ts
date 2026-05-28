import { NextResponse } from "next/server";
import { readSessionToken } from "@/server/auth/session";
import { getSessionUser } from "@/server/auth/service";
import {
  WorkspaceInvitationNotFoundError,
  WorkspacePermissionError,
  resendWorkspaceInvitation,
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

export async function POST(request: Request, context: RouteContext) {
  const user = await currentUser(request);

  if (!user) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  const { userId } = await context.params;

  try {
    return NextResponse.json(resendWorkspaceInvitation(db, user.id, userId));
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
