import { NextResponse } from "next/server";
import { authRequiredResponse, isAuthenticatedPrincipal } from "@/server/auth/route-guards";
import { FeatureAccessError, featureErrorResponse, requireFeature } from "@/server/auth/feature-gate";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { db } from "@/server/db/client";
import { AwardOutcomeValidationError, getAwardOutcome, updateAwardOutcome } from "@/server/awards/service";
import {
  isAwardNextAction,
  isAwardOutcomeStatus,
  isLossReasonCode,
  type UpdateAwardOutcomeInput,
} from "@/server/awards/types";
import { IntentNotFoundError } from "@/server/intents/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function jsonWithPrincipalCookie(body: unknown, principal: RequestPrincipal, init?: ResponseInit) {
  const response = NextResponse.json(body, init);

  if (principal.kind === "anonymous" && principal.anonymousCookie) {
    response.headers.append("Set-Cookie", principal.anonymousCookie);
  }

  return response;
}

function errorResponse(code: string, message: string, status: number, principal: RequestPrincipal) {
  return jsonWithPrincipalCookie({ error: { code, message } }, principal, { status });
}

function routeError(error: unknown, principal: RequestPrincipal) {
  if (error instanceof FeatureAccessError) {
    return jsonWithPrincipalCookie(featureErrorResponse(error), principal, { status: error.status });
  }

  if (error instanceof IntentNotFoundError) {
    return errorResponse("INTENT_NOT_FOUND", "Intent not found", 404, principal);
  }

  if (error instanceof AwardOutcomeValidationError) {
    return errorResponse("INVALID_REQUEST", error.message, 400, principal);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500, principal);
}

function isHttpUrl(value: string) {
  if (!value.trim()) return true;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseUpdate(body: unknown): UpdateAwardOutcomeInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;

  const source = body as Record<string, unknown>;
  const input: UpdateAwardOutcomeInput = {};
  let knownFields = 0;

  if (source.status !== undefined) {
    knownFields += 1;
    if (!isAwardOutcomeStatus(source.status)) return null;
    input.status = source.status;
  }
  if (source.lossReason !== undefined) {
    knownFields += 1;
    if (!isLossReasonCode(source.lossReason)) return null;
    input.lossReason = source.lossReason;
  }
  if (source.nextAction !== undefined) {
    knownFields += 1;
    if (!isAwardNextAction(source.nextAction)) return null;
    input.nextAction = source.nextAction;
  }

  for (const key of ["awardNoticeUrl", "tabulationArtifactUrl"] as const) {
    if (source[key] !== undefined) {
      knownFields += 1;
      if (typeof source[key] !== "string" || !isHttpUrl(source[key])) return null;
      input[key] = source[key];
    }
  }

  for (const key of ["winnerName", "currency", "lossReasonNotes", "notes"] as const) {
    if (source[key] !== undefined) {
      knownFields += 1;
      if (typeof source[key] !== "string") return null;
      input[key] = source[key];
    }
  }

  for (const key of ["nextActionDueAt", "decidedAt", "tabulationArtifactId"] as const) {
    if (source[key] !== undefined) {
      knownFields += 1;
      if (source[key] !== null && typeof source[key] !== "string") return null;
      input[key] = source[key];
    }
  }

  if (source.awardAmountCents !== undefined) {
    knownFields += 1;
    const amount = source.awardAmountCents;
    if (
      amount !== null &&
      (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0)
    ) {
      return null;
    }
    input.awardAmountCents = amount;
  }

  return knownFields > 0 ? input : null;
}

export async function GET(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  try {
    requireFeature(principal, "award.tabulation.analyze");
    const { id } = await context.params;
    const outcome = await getAwardOutcome(db, principal.userId, id);

    return jsonWithPrincipalCookie({ outcome }, principal);
  } catch (error) {
    return routeError(error, principal);
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
    return errorResponse("INVALID_REQUEST", "Award outcome fields are invalid.", 400, principal);
  }

  try {
    requireFeature(principal, "award.tabulation.analyze");
    const { id } = await context.params;
    const outcome = await updateAwardOutcome(db, principal.userId, id, input);

    return jsonWithPrincipalCookie({ outcome }, principal);
  } catch (error) {
    return routeError(error, principal);
  }
}
