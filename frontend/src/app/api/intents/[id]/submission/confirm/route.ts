import { NextResponse } from "next/server";
import { FeatureAccessError, requireFeature } from "@/server/auth/feature-gate";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { db } from "@/server/db/client";
import { IntentNotFoundError } from "@/server/intents/types";
import { createSubmissionConfirmation } from "@/server/submission/service";
import {
  isSubmissionMethod,
  type CreateSubmissionConfirmationInput,
} from "@/server/submission/types";

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

function parseConfirmation(body: unknown): CreateSubmissionConfirmationInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const source = body as Record<string, unknown>;

  if (typeof source.submittedAt !== "string" || !isSubmissionMethod(source.method)) {
    return null;
  }

  const confirmationReference = source.confirmationReference;
  const confirmationNotes = source.confirmationNotes;

  if (confirmationReference !== undefined && typeof confirmationReference !== "string") {
    return null;
  }

  if (confirmationNotes !== undefined && typeof confirmationNotes !== "string") {
    return null;
  }

  return {
    submittedAt: source.submittedAt,
    method: source.method,
    confirmationReference,
    confirmationNotes,
  };
}

export async function POST(request: Request, context: RouteContext) {
  const body = await request.json().catch(() => null);
  const input = parseConfirmation(body);
  const principal = await resolvePrincipal(db, request);

  if (!input) {
    return errorResponse("INVALID_REQUEST", "Submission confirmation details are required.", 400, principal);
  }

  try {
    requireFeature(principal, "submission_guidance");
    const { id } = await context.params;
    const confirmation = await createSubmissionConfirmation(db, principal.userId, id, input);

    return jsonWithPrincipalCookie({ confirmation }, principal, { status: 201 });
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
