import { NextResponse } from "next/server";
import { authRequiredResponse, isAuthenticatedPrincipal } from "@/server/auth/route-guards";
import { FeatureAccessError, requireFeature } from "@/server/auth/feature-gate";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { db } from "@/server/db/client";
import { IntentNotFoundError } from "@/server/intents/types";
import {
  getResponsePackageExportFile,
  markResponsePackageExportDownloaded,
  ResponseWorkspaceValidationError,
  updateResponsePackageExportReview,
} from "@/server/response-workspace/service";
import {
  isResponsePackageExportReviewStatus,
  type UpdateResponsePackageExportReviewInput,
} from "@/server/response-workspace/types";
import {
  createObjectStorageProvider,
  ObjectStorageIntegrityError,
  ObjectStoragePathError,
  ObjectStorageUnavailableError,
} from "@/server/storage/object-storage";

interface RouteContext {
  params: Promise<{ id: string; exportId: string }>;
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

function parseReviewUpdate(body: unknown): UpdateResponsePackageExportReviewInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const source = body as Record<string, unknown>;

  if (!isResponsePackageExportReviewStatus(source.reviewStatus)) return null;
  if (source.reviewNotes !== undefined && source.reviewNotes !== null && typeof source.reviewNotes !== "string") {
    return null;
  }

  return {
    reviewStatus: source.reviewStatus,
    reviewNotes: source.reviewNotes ?? "",
  };
}

export async function GET(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  try {
    requireFeature(principal, "response.workspace.create");
    const { id, exportId } = await context.params;
    const exportFile = await getResponsePackageExportFile(db, principal.userId, id, exportId);
    const objectStorage = createObjectStorageProvider();
    const bytes = await objectStorage.getObject(exportFile.storagePath, {
      expectedByteSize: exportFile.byteSize,
      expectedChecksumSha256: exportFile.checksumSha256,
    });
    await markResponsePackageExportDownloaded(db, principal.userId, id, exportId);

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": exportFile.contentType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename="${contentDispositionFileName(exportFile.fileName)}"`,
      },
    });
  } catch (error) {
    if (error instanceof FeatureAccessError) {
      return errorResponse(error.code, error.message, error.status, principal);
    }

    if (error instanceof IntentNotFoundError) {
      return errorResponse("INTENT_NOT_FOUND", "Intent not found", 404, principal);
    }

    if (error instanceof ResponseWorkspaceValidationError) {
      return errorResponse("EXPORT_NOT_FOUND", error.message, 404, principal);
    }

    if (error instanceof ObjectStorageIntegrityError || error instanceof ObjectStoragePathError) {
      return errorResponse("EXPORT_INTEGRITY_FAILED", "Export file failed integrity validation.", 409, principal);
    }

    if (error instanceof ObjectStorageUnavailableError) {
      return errorResponse("EXPORT_STORAGE_UNAVAILABLE", "Export storage is not available.", 503, principal);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500, principal);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const body = await request.json().catch(() => null);
  const input = parseReviewUpdate(body);
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  if (!input) {
    return errorResponse("INVALID_REQUEST", "Response package review status is required.", 400, principal);
  }

  try {
    requireFeature(principal, "response.workspace.create");
    const { id, exportId } = await context.params;
    const result = await updateResponsePackageExportReview(db, principal.userId, id, exportId, input);

    return jsonWithPrincipalCookie(result, principal, { status: 200 });
  } catch (error) {
    if (error instanceof FeatureAccessError) {
      return errorResponse(error.code, error.message, error.status, principal);
    }

    if (error instanceof IntentNotFoundError) {
      return errorResponse("INTENT_NOT_FOUND", "Intent not found", 404, principal);
    }

    if (error instanceof ResponseWorkspaceValidationError) {
      if (error.message === "Export is not available.") {
        return errorResponse("EXPORT_NOT_FOUND", error.message, 404, principal);
      }

      return errorResponse("INVALID_REQUEST", error.message, 400, principal);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500, principal);
  }
}
