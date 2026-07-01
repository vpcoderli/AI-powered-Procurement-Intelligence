import { NextResponse } from "next/server";
import { authRequiredResponse, isAuthenticatedPrincipal } from "@/server/auth/route-guards";
import { FeatureAccessError, requireFeature } from "@/server/auth/feature-gate";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { db } from "@/server/db/client";
import { IntentNotFoundError } from "@/server/intents/types";
import {
  createResponsePackageExport,
  ResponseWorkspaceValidationError,
} from "@/server/response-workspace/service";
import {
  isResponsePackageExportFormat,
  type CreateResponsePackageExportInput,
} from "@/server/response-workspace/types";

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

function parseCreateExport(body: unknown): CreateResponsePackageExportInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const source = body as Record<string, unknown>;

  if (typeof source.snapshotId !== "string" || !source.snapshotId.trim()) return null;
  if (source.format !== undefined && !isResponsePackageExportFormat(source.format)) return null;

  return {
    snapshotId: source.snapshotId,
    ...(source.format ? { format: source.format } : {}),
  };
}

export async function POST(request: Request, context: RouteContext) {
  const body = await request.json().catch(() => null);
  const input = parseCreateExport(body);
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  if (!input) {
    return errorResponse("INVALID_REQUEST", "Response package snapshot is required.", 400, principal);
  }

  try {
    requireFeature(principal, "response.workspace.create");
    const { id } = await context.params;
    const result = await createResponsePackageExport(db, principal.userId, id, input);

    return jsonWithPrincipalCookie(result, principal, { status: 201 });
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
