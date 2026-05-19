import { NextResponse } from "next/server";
import { readSessionToken } from "@/server/auth/session";
import { getSessionUser } from "@/server/auth/service";
import { db } from "@/server/db/client";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request) {
  const sessionToken = readSessionToken(request);

  try {
    if (!sessionToken) {
      return NextResponse.json({ user: null });
    }

    return NextResponse.json({ user: await getSessionUser(db, sessionToken) });
  } catch {
    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
