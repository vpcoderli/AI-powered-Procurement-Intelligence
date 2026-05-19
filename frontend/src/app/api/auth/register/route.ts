import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import {
  DuplicateEmailError,
  InvalidAuthInputError,
  WeakPasswordError,
  registerUser,
} from "@/server/auth/service";
import { createSessionCookie } from "@/server/auth/session";

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
    typeof body.email !== "string" ||
    typeof body.password !== "string" ||
    ("displayName" in body && typeof body.displayName !== "string")
  ) {
    return errorResponse("INVALID_REQUEST", "Request body must include email and password", 400);
  }

  if (body.password.length < 8) {
    return errorResponse("WEAK_PASSWORD", "Password must be at least 8 characters", 400);
  }

  try {
    const result = await registerUser(db, {
      email: body.email,
      password: body.password,
      displayName: body.displayName,
    });
    const response = NextResponse.json({ user: result.user }, { status: 201 });
    response.headers.set("Set-Cookie", createSessionCookie(result.sessionToken));

    return response;
  } catch (error) {
    if (error instanceof DuplicateEmailError) {
      return errorResponse("EMAIL_ALREADY_REGISTERED", error.message, 409);
    }

    if (error instanceof WeakPasswordError) {
      return errorResponse("WEAK_PASSWORD", error.message, 400);
    }

    if (error instanceof InvalidAuthInputError) {
      return errorResponse("INVALID_REQUEST", error.message, 400);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
