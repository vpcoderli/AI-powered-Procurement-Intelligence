import { NextResponse } from "next/server";
import { requestPasswordReset } from "@/server/auth/password-reset";
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
    body.email.trim().length === 0
  ) {
    return errorResponse("INVALID_REQUEST", "Request body must include email", 400);
  }

  try {
    const result = await requestPasswordReset(db, body.email);

    return NextResponse.json(result);
  } catch {
    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
