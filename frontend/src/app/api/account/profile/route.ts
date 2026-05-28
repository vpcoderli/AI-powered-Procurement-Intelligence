import { NextResponse } from "next/server";
import { readSessionToken } from "@/server/auth/session";
import {
  AccountDisabledError,
  InvalidAuthInputError,
  getSessionUser,
  updateUserProfile,
} from "@/server/auth/service";
import { db } from "@/server/db/client";

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

export async function PATCH(request: Request) {
  const sessionToken = readSessionToken(request);

  if (!sessionToken) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  const body = await readBody(request);

  if (
    typeof body !== "object" ||
    body === null ||
    !("displayName" in body) ||
    typeof body.displayName !== "string"
  ) {
    return errorResponse("INVALID_REQUEST", "Request body must include displayName", 400);
  }

  try {
    const sessionUser = await getSessionUser(db, sessionToken);

    if (!sessionUser) {
      return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
    }

    const user = await updateUserProfile(db, sessionUser.id, {
      displayName: body.displayName,
    });

    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof InvalidAuthInputError) {
      return errorResponse("INVALID_REQUEST", error.message, 400);
    }

    if (error instanceof AccountDisabledError) {
      return errorResponse("ACCOUNT_DISABLED", error.message, 403);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
