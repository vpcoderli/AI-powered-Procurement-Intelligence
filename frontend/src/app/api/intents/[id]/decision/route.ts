import { NextResponse } from "next/server";
import { authRequiredResponse, isAuthenticatedPrincipal } from "@/server/auth/route-guards";
import { FeatureAccessError, requireFeature } from "@/server/auth/feature-gate";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { db } from "@/server/db/client";
import { IntentNotFoundError } from "@/server/intents/types";
import {
  createPursuitDecision,
  getPursuitDecisionBoard,
} from "@/server/pursuit/service";
import {
  isPursuitDecision,
  type CreatePursuitDecisionInput,
} from "@/server/pursuit/types";

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

function errorResponse(
  code: string,
  message: string,
  status: number,
  principal: RequestPrincipal,
) {
  return jsonWithPrincipalCookie({ error: { code, message } }, principal, { status });
}

function parseUpdate(body: unknown): CreatePursuitDecisionInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const source = body as Record<string, unknown>;

  if (!isPursuitDecision(source.decision)) {
    return null;
  }

  if ("reasons" in source && !(
    Array.isArray(source.reasons) &&
    source.reasons.every((reason) => typeof reason === "string")
  )) {
    return null;
  }

  if ("notes" in source && typeof source.notes !== "string") {
    return null;
  }

  return {
    decision: source.decision,
    reasons: Array.isArray(source.reasons) ? source.reasons : [],
    notes: typeof source.notes === "string" ? source.notes : "",
  };
}

export async function GET(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  try {
    requireFeature(principal, "pursue_no_bid");
    const { id } = await context.params;
    const decisionBoard = await getPursuitDecisionBoard(db, principal.userId, id);

    return jsonWithPrincipalCookie({ decisionBoard }, principal);
  } catch (error) {
    if (error instanceof FeatureAccessError) {
      return errorResponse(error.code, error.message, error.status, principal);
    }

    if (error instanceof IntentNotFoundError) {
      return errorResponse("INTENT_NOT_FOUND", "Intent not found", 404, principal);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500, principal);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const body = await request.json().catch(() => null);
  const input = parseUpdate(body);
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  if (!input) {
    return errorResponse("INVALID_REQUEST", "Supported pursuit decision fields are required.", 400, principal);
  }

  try {
    requireFeature(principal, "pursue_no_bid");
    const { id } = await context.params;
    const decisionBoard = await createPursuitDecision(db, principal.userId, id, input);

    return jsonWithPrincipalCookie({ decisionBoard }, principal);
  } catch (error) {
    if (error instanceof FeatureAccessError) {
      return errorResponse(error.code, error.message, error.status, principal);
    }

    if (error instanceof IntentNotFoundError) {
      return errorResponse("INTENT_NOT_FOUND", "Intent not found", 404, principal);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500, principal);
  }
}
