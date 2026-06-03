import { NextResponse } from "next/server";
import { authRequiredResponse, isAuthenticatedPrincipal } from "@/server/auth/route-guards";
import { ArtifactVaultValidationError, createSupplierArtifact, getArtifactVault } from "@/server/artifacts/service";
import { isArtifactPurpose, isArtifactType, type CreateSupplierArtifactInput } from "@/server/artifacts/types";
import { FeatureAccessError, featureErrorResponse, requireFeature } from "@/server/auth/feature-gate";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { db } from "@/server/db/client";
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

  if (error instanceof ArtifactVaultValidationError) {
    return errorResponse("INVALID_REQUEST", error.message, 400, principal);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500, principal);
}

function formString(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function parseCreateArtifact(form: FormData): CreateSupplierArtifactInput | null {
  const file = form.get("file");
  const artifactType = formString(form, "artifactType");
  const purpose = formString(form, "purpose");

  if (!(file instanceof File) || !isArtifactType(artifactType) || !isArtifactPurpose(purpose)) {
    return null;
  }

  return {
    title: formString(form, "title"),
    artifactType,
    purpose,
    expiresAt: formString(form, "expiresAt") || null,
    notes: formString(form, "notes"),
    file,
  };
}

export async function GET(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  try {
    requireFeature(principal, "artifact.vault.upload");
    const { id } = await context.params;
    const vault = await getArtifactVault(db, principal.userId, id);

    return jsonWithPrincipalCookie({ vault }, principal);
  } catch (error) {
    return routeError(error, principal);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }
  const form = await request.formData().catch(() => null);
  const input = form ? parseCreateArtifact(form) : null;

  if (!input) {
    return errorResponse("INVALID_REQUEST", "Artifact title, type, purpose, and file are required.", 400, principal);
  }

  try {
    requireFeature(principal, "artifact.vault.upload");
    const { id } = await context.params;
    const vault = await createSupplierArtifact(db, principal.userId, id, input);

    return jsonWithPrincipalCookie({ vault }, principal, { status: 201 });
  } catch (error) {
    return routeError(error, principal);
  }
}
