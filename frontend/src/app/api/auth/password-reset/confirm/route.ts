import { NextResponse } from "next/server";
import {
  ExpiredPasswordResetTokenError,
  InvalidPasswordResetTokenError,
  resetPasswordWithToken,
} from "@/server/auth/password-reset";
import { AccountDisabledError, WeakPasswordError } from "@/server/auth/service";
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

export async function POST(request: Request) {
  const body = await readBody(request);

  if (
    typeof body !== "object" ||
    body === null ||
    typeof body.token !== "string" ||
    typeof body.password !== "string" ||
    body.token.trim().length === 0
  ) {
    return errorResponse("INVALID_REQUEST", "Request body must include token and password", 400);
  }

  try {
    await resetPasswordWithToken(db, body.token, body.password);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (
      error instanceof InvalidPasswordResetTokenError ||
      error instanceof ExpiredPasswordResetTokenError
    ) {
      return errorResponse("INVALID_RESET_TOKEN", error.message, 400);
    }

    if (error instanceof WeakPasswordError) {
      return errorResponse("WEAK_PASSWORD", error.message, 400);
    }

    if (error instanceof AccountDisabledError) {
      return errorResponse("ACCOUNT_DISABLED", error.message, 403);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
