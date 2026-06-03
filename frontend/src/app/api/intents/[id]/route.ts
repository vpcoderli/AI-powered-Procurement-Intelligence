import { NextResponse } from "next/server";
import { authRequiredResponse, isAuthenticatedPrincipal } from "@/server/auth/route-guards";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { db } from "@/server/db/client";
import { getUserIntent, updateIntentStatus } from "@/server/intents/service";
import {
  IntentNotFoundError,
  isIntentStatus,
  type IntentStatus,
} from "@/server/intents/types";

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

function parseStatusUpdate(body: unknown): IntentStatus | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const { status } = body as { status?: unknown };

  return isIntentStatus(status) ? status : null;
}

export async function GET(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  try {
    const { id } = await context.params;
    const intent = await getUserIntent(db, principal.userId, id);

    if (!intent) {
      return errorResponse("INTENT_NOT_FOUND", "Intent not found", 404, principal);
    }

    return jsonWithPrincipalCookie({ intent }, principal);
  } catch {
    return errorResponse("INTERNAL_ERROR", "Internal server error", 500, principal);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const body = await request.json().catch(() => null);
  const status = parseStatusUpdate(body);

  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  if (!status) {
    return errorResponse("INVALID_REQUEST", "A supported intent status is required.", 400, principal);
  }

  try {
    const { id } = await context.params;
    const intent = await updateIntentStatus(db, principal.userId, id, status);

    return jsonWithPrincipalCookie({ intent }, principal);
  } catch (error) {
    if (error instanceof IntentNotFoundError) {
      return errorResponse("INTENT_NOT_FOUND", "Intent not found", 404, principal);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500, principal);
  }
}
