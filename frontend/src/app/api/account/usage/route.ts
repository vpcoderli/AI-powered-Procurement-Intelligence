import { NextResponse } from "next/server";
import { getAccountUsage } from "@/server/account/usage";
import { readSessionToken } from "@/server/auth/session";
import { getSessionUser } from "@/server/auth/service";
import { db } from "@/server/db/client";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request) {
  const sessionToken = readSessionToken(request);

  if (!sessionToken) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  const user = await getSessionUser(db, sessionToken);

  if (!user) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  try {
    return NextResponse.json(getAccountUsage(db, user.id));
  } catch {
    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
