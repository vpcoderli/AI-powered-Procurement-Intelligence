import { NextResponse } from "next/server";
import { readSessionToken } from "@/server/auth/session";
import { getSessionUser } from "@/server/auth/service";
import { isAccountTier } from "@/server/auth/entitlements";
import {
  InvalidSubscriptionInputError,
  createCheckoutSession,
} from "@/server/billing/subscriptions";
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
  const sessionToken = readSessionToken(request);

  if (!sessionToken) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  const body = await readBody(request);

  if (typeof body !== "object" || body === null || !isAccountTier((body as { tier?: unknown }).tier)) {
    return errorResponse("INVALID_REQUEST", "Request body must include a valid tier", 400);
  }

  try {
    const sessionUser = await getSessionUser(db, sessionToken);

    if (!sessionUser) {
      return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
    }

    return NextResponse.json(
      createCheckoutSession(db, sessionUser.id, {
        tier: body.tier,
        origin: new URL(request.url).origin,
      }),
    );
  } catch (error) {
    if (error instanceof InvalidSubscriptionInputError) {
      return errorResponse("INVALID_REQUEST", error.message, 400);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
