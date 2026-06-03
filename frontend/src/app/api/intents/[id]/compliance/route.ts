import { NextResponse } from "next/server";
import { authRequiredResponse, isAuthenticatedPrincipal } from "@/server/auth/route-guards";
import { FeatureAccessError, requireFeature } from "@/server/auth/feature-gate";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import {
  getOrCreateComplianceManifest,
  updateComplianceManifestItem,
} from "@/server/compliance/service";
import {
  isComplianceEvidenceStatus,
  isComplianceItemStatus,
  type UpdateComplianceManifestItemInput,
} from "@/server/compliance/types";
import { db } from "@/server/db/client";
import { IntentNotFoundError } from "@/server/intents/types";

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

function parseUpdate(body: unknown): UpdateComplianceManifestItemInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const source = body as Record<string, unknown>;

  if (typeof source.itemId !== "string" || !source.itemId.trim()) {
    return null;
  }

  const input: UpdateComplianceManifestItemInput = {
    itemId: source.itemId,
  };

  if ("status" in source) {
    if (!isComplianceItemStatus(source.status)) return null;
    input.status = source.status;
  }

  if ("evidenceStatus" in source) {
    if (!isComplianceEvidenceStatus(source.evidenceStatus)) return null;
    input.evidenceStatus = source.evidenceStatus;
  }

  if ("notes" in source) {
    if (typeof source.notes !== "string") return null;
    input.notes = source.notes;
  }

  return input;
}

export async function GET(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  try {
    requireFeature(principal, "compliance_manifest");
    const { id } = await context.params;
    const manifest = await getOrCreateComplianceManifest(db, principal.userId, id);

    return jsonWithPrincipalCookie({ manifest }, principal);
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
    return errorResponse("INVALID_REQUEST", "Supported compliance manifest fields are required.", 400, principal);
  }

  try {
    requireFeature(principal, "compliance_manifest");
    const { id } = await context.params;
    const manifest = await updateComplianceManifestItem(db, principal.userId, id, input);

    return jsonWithPrincipalCookie({ manifest }, principal);
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
