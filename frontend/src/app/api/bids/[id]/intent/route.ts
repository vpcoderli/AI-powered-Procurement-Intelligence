import { NextResponse } from "next/server";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { authRequiredResponse, isAuthenticatedPrincipal } from "@/server/auth/route-guards";
import { UsageLimitError, enforceMysqlIntentUsageLimit, enforceUsageLimit } from "@/server/auth/usage-limits";
import { db } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
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

function usageLimitError(error: UsageLimitError, principal: RequestPrincipal) {
  return jsonWithPrincipalCookie(
    {
      error: {
        code: error.code,
        message: "Upgrade your plan to create more intent workspaces.",
        feature: error.feature,
        limit: error.limit,
        used: error.used,
        requiredTier: error.requiredTier,
      },
    },
    principal,
    { status: 402 },
  );
}

export async function POST(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  try {
    const { id } = await context.params;
    if (isMysqlDatabaseUrlConfigured()) {
      await enforceMysqlIntentUsageLimit(resolveMysqlPool(), {
        userId: principal.userId,
        tier: principal.tier ?? "free",
        resourceId: id,
      });
    } else {
      enforceUsageLimit(db, {
        userId: principal.userId,
        tier: principal.tier ?? "free",
        feature: "intent_workspace",
        resourceId: id,
      });
    }

    const intent = await createIntentForBid(db, principal.userId, id);

    return jsonWithPrincipalCookie({ intent }, principal);
  } catch (error) {
    if (error instanceof UsageLimitError) {
      return usageLimitError(error, principal);
    }

    if (error instanceof IntentBidNotFoundError) {
      return bidNotFound(principal);
    }

    return internalError(principal);
  }
}
