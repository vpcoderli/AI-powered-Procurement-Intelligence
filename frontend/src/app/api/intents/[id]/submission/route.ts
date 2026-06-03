import { NextResponse } from "next/server";
import { authRequiredResponse, isAuthenticatedPrincipal } from "@/server/auth/route-guards";
import { FeatureAccessError, requireFeature } from "@/server/auth/feature-gate";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { db } from "@/server/db/client";
import { IntentNotFoundError } from "@/server/intents/types";
import {
  getOrCreateSubmissionGuidance,
  updateSubmissionGuidance,
} from "@/server/submission/service";
import { isSubmissionMethod, type UpdateSubmissionGuidanceInput } from "@/server/submission/types";

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

function parseUpdate(body: unknown): UpdateSubmissionGuidanceInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const source = body as Record<string, unknown>;
  const input: UpdateSubmissionGuidanceInput = {};

  if ("method" in source) {
    if (!isSubmissionMethod(source.method)) return null;
    input.method = source.method;
  }

  for (const key of ["portalUrl", "contactEmail"] as const) {
    if (key in source) {
      if (typeof source[key] !== "string") return null;
      input[key] = source[key];
    }
  }

  for (const key of [
    "requiresRegistration",
    "requiresPhysicalDelivery",
    "requiresAddendaAcknowledgement",
  ] as const) {
    if (key in source) {
      if (typeof source[key] !== "boolean") return null;
      input[key] = source[key];
    }
  }

  return input;
}

export async function GET(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  try {
    requireFeature(principal, "submission_guidance");
    const { id } = await context.params;
    const submission = await getOrCreateSubmissionGuidance(db, principal.userId, id);

    return jsonWithPrincipalCookie({ submission }, principal);
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
    return errorResponse("INVALID_REQUEST", "Supported submission guidance fields are required.", 400, principal);
  }

  try {
    requireFeature(principal, "submission_guidance");
    const { id } = await context.params;
    const submission = await updateSubmissionGuidance(db, principal.userId, id, input);

    return jsonWithPrincipalCookie({ submission }, principal);
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
