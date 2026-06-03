import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { authRequiredResponse, isAuthenticatedPrincipal } from "@/server/auth/route-guards";
import { ArtifactVaultValidationError, getSupplierArtifactFile } from "@/server/artifacts/service";
import { FeatureAccessError, featureErrorResponse, requireFeature } from "@/server/auth/feature-gate";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { db } from "@/server/db/client";
import { IntentNotFoundError } from "@/server/intents/types";

interface RouteContext {
  params: Promise<{ id: string; artifactId: string }>;
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

function contentDispositionFileName(value: string) {
  return value.replace(/["\r\n]/g, "");
}

export async function GET(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  try {
    requireFeature(principal, "artifact.vault.upload");
    const { id, artifactId } = await context.params;
    const artifact = await getSupplierArtifactFile(db, principal.userId, id, artifactId);
    const bytes = await readFile(/*turbopackIgnore: true*/ artifact.storagePath);

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": artifact.contentType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename="${contentDispositionFileName(artifact.fileName)}"`,
      },
    });
  } catch (error) {
    if (error instanceof FeatureAccessError) {
      return jsonWithPrincipalCookie(featureErrorResponse(error), principal, { status: error.status });
    }

    if (error instanceof IntentNotFoundError) {
      return errorResponse("INTENT_NOT_FOUND", "Intent not found", 404, principal);
    }

    if (error instanceof ArtifactVaultValidationError) {
      return errorResponse("ARTIFACT_NOT_FOUND", error.message, 404, principal);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500, principal);
  }
}
