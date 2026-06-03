import { NextResponse } from "next/server";
import { authRequiredResponse, isAuthenticatedPrincipal } from "@/server/auth/route-guards";
import { FeatureAccessError, requireFeature } from "@/server/auth/feature-gate";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { db } from "@/server/db/client";
import { IntentNotFoundError } from "@/server/intents/types";
import {
  createResponseWorkspaceComment,
  listResponseWorkspaceComments,
  ResponseWorkspaceValidationError,
} from "@/server/response-workspace/service";
import type { CreateResponseWorkspaceCommentInput } from "@/server/response-workspace/types";

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
    return errorResponse(error.code, error.message, error.status, principal);
  }

  if (error instanceof IntentNotFoundError) {
    return errorResponse("INTENT_NOT_FOUND", "Intent not found", 404, principal);
  }

  if (error instanceof ResponseWorkspaceValidationError) {
    return errorResponse("INVALID_REQUEST", error.message, 400, principal);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500, principal);
}

function parseCreate(body: unknown): CreateResponseWorkspaceCommentInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const source = body as Record<string, unknown>;
  if (typeof source.itemId !== "string" || !source.itemId.trim()) return null;
  if (typeof source.body !== "string" || !source.body.trim()) return null;

  return {
    itemId: source.itemId,
    body: source.body,
  };
}

export async function GET(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }
  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get("itemId");

  if (!itemId) {
    return errorResponse("INVALID_REQUEST", "Response workspace item is required.", 400, principal);
  }

  try {
    requireFeature(principal, "response.workspace.create");
    const { id } = await context.params;
    const comments = await listResponseWorkspaceComments(db, principal.userId, id, itemId);

    return jsonWithPrincipalCookie({ comments }, principal);
  } catch (error) {
    return routeError(error, principal);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const body = await request.json().catch(() => null);
  const input = parseCreate(body);
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  if (!input) {
    return errorResponse("INVALID_REQUEST", "Response workspace comment fields are invalid.", 400, principal);
  }

  try {
    requireFeature(principal, "response.workspace.create");
    const { id } = await context.params;
    const comment = await createResponseWorkspaceComment(db, principal.userId, id, input);

    return jsonWithPrincipalCookie({ comment }, principal, { status: 201 });
  } catch (error) {
    return routeError(error, principal);
  }
}
