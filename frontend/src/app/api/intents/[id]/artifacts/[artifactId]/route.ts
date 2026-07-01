import { NextResponse } from "next/server";
import { authRequiredResponse, isAuthenticatedPrincipal } from "@/server/auth/route-guards";
import {
  ArtifactVaultValidationError,
  deleteSupplierArtifact,
  getSupplierArtifactFile,
  replaceSupplierArtifact,
} from "@/server/artifacts/service";
import type { ReplaceSupplierArtifactInput } from "@/server/artifacts/types";
import { FeatureAccessError, featureErrorResponse, requireFeature } from "@/server/auth/feature-gate";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { db } from "@/server/db/client";
import { IntentNotFoundError } from "@/server/intents/types";
import {
  createObjectStorageProvider,
  ObjectStorageIntegrityError,
  ObjectStoragePathError,
  ObjectStorageUnavailableError,
} from "@/server/storage/object-storage";

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

function formString(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function parseReplaceArtifact(form: FormData): ReplaceSupplierArtifactInput | null {
  const file = form.get("file");

  if (!(file instanceof File)) {
    return null;
  }

  return {
    file,
    replacementReason: formString(form, "replacementReason"),
    title: formString(form, "title") || undefined,
    expiresAt: formString(form, "expiresAt") || undefined,
    notes: formString(form, "notes") || undefined,
  };
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
    const objectStorage = createObjectStorageProvider();
    const bytes = await objectStorage.getObject(artifact.storagePath, {
      expectedByteSize: artifact.byteSize,
      expectedChecksumSha256: artifact.checksumSha256,
    });

    return new Response(new Uint8Array(bytes), {
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

    if (error instanceof ObjectStorageIntegrityError || error instanceof ObjectStoragePathError) {
      return errorResponse(
        "ARTIFACT_INTEGRITY_FAILED",
        "Artifact file failed integrity validation.",
        409,
        principal,
      );
    }

    if (error instanceof ObjectStorageUnavailableError) {
      return errorResponse("ARTIFACT_STORAGE_UNAVAILABLE", "Artifact storage is not available.", 503, principal);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500, principal);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  try {
    requireFeature(principal, "artifact.vault.upload");
    const { id, artifactId } = await context.params;
    const vault = await deleteSupplierArtifact(db, principal.userId, id, artifactId);

    return jsonWithPrincipalCookie({ vault }, principal);
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

export async function PUT(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }
  const form = await request.formData().catch(() => null);
  const input = form ? parseReplaceArtifact(form) : null;

  if (!input) {
    return errorResponse("INVALID_REQUEST", "Replacement file is required.", 400, principal);
  }

  try {
    requireFeature(principal, "artifact.vault.upload");
    const { id, artifactId } = await context.params;
    const vault = await replaceSupplierArtifact(db, principal.userId, id, artifactId, input);

    return jsonWithPrincipalCookie({ vault }, principal);
  } catch (error) {
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
}
