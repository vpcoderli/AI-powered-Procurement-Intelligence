import { NextResponse } from "next/server";
import { readSessionToken } from "@/server/auth/session";
import { getSessionUser } from "@/server/auth/service";
import {
  InvalidWorkspaceInputError,
  WorkspacePermissionError,
  getAccountWorkspace,
  updateOrganizationName,
} from "@/server/account/workspace";
import { db } from "@/server/db/client";

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

export async function GET(request: Request) {
  const user = await currentUser(request);

  if (!user) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  try {
    return NextResponse.json(getAccountWorkspace(db, user.id));
  } catch {
    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}

export async function PATCH(request: Request) {
  const user = await currentUser(request);

  if (!user) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  const body = await readBody(request);

  if (typeof body !== "object" || body === null || typeof body.name !== "string") {
    return errorResponse("INVALID_REQUEST", "Request body must include name", 400);
  }

  try {
    return NextResponse.json(updateOrganizationName(db, user.id, { name: body.name }));
  } catch (error) {
    if (error instanceof WorkspacePermissionError) {
      return errorResponse("FORBIDDEN", error.message, 403);
    }

    if (error instanceof InvalidWorkspaceInputError) {
      return errorResponse("INVALID_REQUEST", error.message, 400);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
