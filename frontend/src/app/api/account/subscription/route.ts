import { NextResponse } from "next/server";
import { readSessionToken } from "@/server/auth/session";
import { getSessionUser } from "@/server/auth/service";
import {
  InvalidSubscriptionInputError,
  getAccountSubscription,
} from "@/server/billing/subscriptions";
import { db } from "@/server/db/client";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request) {
  const sessionToken = readSessionToken(request);

  if (!sessionToken) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  try {
    const sessionUser = await getSessionUser(db, sessionToken);

    if (!sessionUser) {
      return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
    }

    return NextResponse.json(getAccountSubscription(db, sessionUser.id));
  } catch (error) {
    if (error instanceof InvalidSubscriptionInputError) {
      return errorResponse("INVALID_REQUEST", error.message, 400);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
