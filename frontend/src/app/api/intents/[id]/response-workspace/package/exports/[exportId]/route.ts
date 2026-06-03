import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { authRequiredResponse, isAuthenticatedPrincipal } from "@/server/auth/route-guards";
import { FeatureAccessError, requireFeature } from "@/server/auth/feature-gate";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { db } from "@/server/db/client";
import { IntentNotFoundError } from "@/server/intents/types";
import {
  getResponsePackageExportFile,
  ResponseWorkspaceValidationError,
} from "@/server/response-workspace/service";

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

export async function GET(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  try {
    requireFeature(principal, "response.workspace.create");
    const { id, exportId } = await context.params;
    const exportFile = await getResponsePackageExportFile(db, principal.userId, id, exportId);
    const bytes = await readFile(/*turbopackIgnore: true*/ exportFile.storagePath);

    return new Response(bytes, {
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

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500, principal);
  }
}
