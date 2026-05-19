import { NextResponse } from "next/server";
import { createSessionCookie } from "@/server/auth/session";
import {
  InvalidAuthInputError,
  InvalidCredentialsError,
  loginUser,
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

export async function POST(request: Request) {
  const body = await readBody(request);

  if (
    typeof body !== "object" ||
    body === null ||
    typeof body.email !== "string" ||
    typeof body.password !== "string"
  ) {
    return errorResponse("INVALID_REQUEST", "Request body must include email and password", 400);
  }

  try {
    const result = await loginUser(db, body.email, body.password);
    const response = NextResponse.json({ user: result.user });
    response.headers.set("Set-Cookie", createSessionCookie(result.sessionToken));

    return response;
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      return errorResponse("INVALID_CREDENTIALS", error.message, 401);
    }

    if (error instanceof InvalidAuthInputError) {
      return errorResponse("INVALID_REQUEST", error.message, 400);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
