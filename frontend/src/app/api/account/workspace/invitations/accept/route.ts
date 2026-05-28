import { NextResponse } from "next/server";
import {
  InvalidWorkspaceInputError,
  InvalidWorkspaceInvitationTokenError,
  acceptWorkspaceInvitation,
} from "@/server/account/workspace";
import { createSessionCookie } from "@/server/auth/session";
import { UsageLimitError } from "@/server/auth/usage-limits";
import { db } from "@/server/db/client";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function usageLimitResponse(error: UsageLimitError) {
  return NextResponse.json({
    error: {
      code: error.code,
      message: "This workspace has reached its team member limit.",
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
  const body = await readBody(request);

  if (
    typeof body !== "object" ||
    body === null ||
    typeof body.token !== "string" ||
    typeof body.password !== "string" ||
    ("displayName" in body && typeof body.displayName !== "string")
  ) {
    return errorResponse("INVALID_REQUEST", "Request body must include token and password", 400);
  }

  try {
    const result = await acceptWorkspaceInvitation(db, {
      token: body.token,
      password: body.password,
      displayName: body.displayName,
    });
    const response = NextResponse.json({ user: result.user });
    response.headers.append("Set-Cookie", createSessionCookie(result.sessionToken));

    return response;
  } catch (error) {
    if (error instanceof UsageLimitError) {
      return usageLimitResponse(error);
    }

    if (error instanceof InvalidWorkspaceInvitationTokenError) {
      return errorResponse("INVALID_INVITATION_TOKEN", error.message, 400);
    }

    if (error instanceof InvalidWorkspaceInputError) {
      return errorResponse("INVALID_REQUEST", error.message, 400);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
