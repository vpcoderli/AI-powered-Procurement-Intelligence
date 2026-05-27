import { NextResponse } from "next/server";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { db } from "@/server/db/client";
import { createIntentForBid } from "@/server/intents/service";
import { IntentBidNotFoundError } from "@/server/intents/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function jsonWithPrincipalCookie(
  body: unknown,
  principal: RequestPrincipal,
  init?: ResponseInit,
) {
  const response = NextResponse.json(body, init);

  if (principal.kind === "anonymous" && principal.anonymousCookie) {
    response.headers.append("Set-Cookie", principal.anonymousCookie);
  }

  return response;
}

function bidNotFound(principal: RequestPrincipal) {
  return jsonWithPrincipalCookie(
    { error: { code: "BID_NOT_FOUND", message: "Bid not found" } },
    principal,
    { status: 404 },
  );
}

function internalError(principal: RequestPrincipal) {
  return jsonWithPrincipalCookie(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    principal,
    { status: 500 },
  );
}

export async function POST(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  try {
    const { id } = await context.params;
    const intent = await createIntentForBid(db, principal.userId, id);

    return jsonWithPrincipalCookie({ intent }, principal);
  } catch (error) {
    if (error instanceof IntentBidNotFoundError) {
      return bidNotFound(principal);
    }

    return internalError(principal);
  }
}
