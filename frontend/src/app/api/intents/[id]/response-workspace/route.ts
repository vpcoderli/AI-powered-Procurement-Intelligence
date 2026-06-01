import { NextResponse } from "next/server";
import { FeatureAccessError, requireFeature } from "@/server/auth/feature-gate";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { db } from "@/server/db/client";
import { IntentNotFoundError } from "@/server/intents/types";
import {
  getOrCreateResponseWorkspace,
  ResponseWorkspaceValidationError,
  updateResponseWorkspaceItem,
} from "@/server/response-workspace/service";
import {
  isResponseWorkspaceItemStatus,
  type UpdateResponseWorkspaceItemInput,
} from "@/server/response-workspace/types";

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

function parseUpdate(body: unknown): UpdateResponseWorkspaceItemInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const source = body as Record<string, unknown>;

  if (typeof source.itemId !== "string" || !source.itemId.trim()) {
    return null;
  }

  const input: UpdateResponseWorkspaceItemInput = { itemId: source.itemId };

  if ("status" in source) {
    if (!isResponseWorkspaceItemStatus(source.status)) return null;
    input.status = source.status;
  }

  for (const key of ["title", "notes"] as const) {
    if (key in source) {
      if (typeof source[key] !== "string") return null;
      input[key] = source[key];
    }
  }

  if ("dueAt" in source) {
    if (source.dueAt !== null && typeof source.dueAt !== "string") return null;
    input.dueAt = source.dueAt;
  }

  return input;
}

export async function GET(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  try {
    requireFeature(principal, "response.workspace.create");
    const { id } = await context.params;
    const workspace = await getOrCreateResponseWorkspace(db, principal.userId, id);

    return jsonWithPrincipalCookie({ workspace }, principal);
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

  if (!input) {
    return errorResponse("INVALID_REQUEST", "Supported response workspace fields are required.", 400, principal);
  }

  try {
    requireFeature(principal, "response.workspace.create");
    const { id } = await context.params;
    const workspace = await updateResponseWorkspaceItem(db, principal.userId, id, input);

    return jsonWithPrincipalCookie({ workspace }, principal);
  } catch (error) {
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
}
