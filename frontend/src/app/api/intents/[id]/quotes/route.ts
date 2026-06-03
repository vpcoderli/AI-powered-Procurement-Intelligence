import { NextResponse } from "next/server";
import { authRequiredResponse, isAuthenticatedPrincipal } from "@/server/auth/route-guards";
import { FeatureAccessError, featureErrorResponse, requireFeature } from "@/server/auth/feature-gate";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { db } from "@/server/db/client";
import { IntentNotFoundError } from "@/server/intents/types";
import {
  createQuoteRequest,
  getQuoteWorkspace,
  QuoteWorkflowValidationError,
  updateQuoteRequest,
} from "@/server/quotes/service";
import { isQuoteRequestStatus, type CreateQuoteRequestInput, type UpdateQuoteRequestInput } from "@/server/quotes/types";

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

  if (error instanceof QuoteWorkflowValidationError) {
    return errorResponse("INVALID_REQUEST", error.message, 400, principal);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500, principal);
}

function optionalStringArray(value: unknown) {
  if (value === undefined) return undefined;
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

function optionalStringOrArray(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

function parseCreate(body: unknown): CreateQuoteRequestInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const source = body as Record<string, unknown>;

  if (typeof source.title !== "string") return null;
  if (source.partnerId !== undefined && typeof source.partnerId !== "string") return null;
  if (source.partnerName !== undefined && typeof source.partnerName !== "string") return null;

  const artifactIds = optionalStringArray(source.artifactIds);
  const lineItems = optionalStringOrArray(source.lineItems);
  const regions = optionalStringOrArray(source.regions);
  const capabilityTags = optionalStringOrArray(source.capabilityTags);
  if (artifactIds === null || lineItems === null || regions === null || capabilityTags === null) return null;

  const input: CreateQuoteRequestInput = { title: source.title };
  for (const key of ["partnerId", "partnerName", "contactName", "contactEmail", "phone", "category", "description"] as const) {
    if (source[key] !== undefined) {
      if (typeof source[key] !== "string") return null;
      input[key] = source[key];
    }
  }
  if (source.requestedDueAt !== undefined) {
    if (source.requestedDueAt !== null && typeof source.requestedDueAt !== "string") return null;
    input.requestedDueAt = source.requestedDueAt;
  }
  if (artifactIds !== undefined) input.artifactIds = artifactIds;
  if (lineItems !== undefined) input.lineItems = lineItems;
  if (regions !== undefined) input.regions = regions;
  if (capabilityTags !== undefined) input.capabilityTags = capabilityTags;

  return input;
}

function parseUpdate(body: unknown): UpdateQuoteRequestInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const source = body as Record<string, unknown>;
  if (typeof source.requestId !== "string") return null;

  const input: UpdateQuoteRequestInput = { requestId: source.requestId };
  if (source.status !== undefined) {
    if (!isQuoteRequestStatus(source.status)) return null;
    input.status = source.status;
  }
  if (source.requestedDueAt !== undefined) {
    if (source.requestedDueAt !== null && typeof source.requestedDueAt !== "string") return null;
    input.requestedDueAt = source.requestedDueAt;
  }
  if (source.quotedAmountCents !== undefined) {
    if (source.quotedAmountCents !== null && typeof source.quotedAmountCents !== "number") return null;
    input.quotedAmountCents = source.quotedAmountCents;
  }
  if (source.currency !== undefined) {
    if (typeof source.currency !== "string") return null;
    input.currency = source.currency;
  }
  if (source.responseNotes !== undefined) {
    if (typeof source.responseNotes !== "string") return null;
    input.responseNotes = source.responseNotes;
  }

  return input;
}

export async function GET(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  try {
    requireFeature(principal, "quote_workflow");
    const { id } = await context.params;
    const workspace = await getQuoteWorkspace(db, principal.userId, id);

    return jsonWithPrincipalCookie({ workspace }, principal);
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
    return errorResponse("INVALID_REQUEST", "Quote request fields are invalid.", 400, principal);
  }

  try {
    requireFeature(principal, "quote_workflow");
    const { id } = await context.params;
    const workspace = await createQuoteRequest(db, principal.userId, id, input);

    return jsonWithPrincipalCookie({ workspace }, principal, { status: 201 });
  } catch (error) {
    return routeError(error, principal);
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
    return errorResponse("INVALID_REQUEST", "Quote update fields are invalid.", 400, principal);
  }

  try {
    requireFeature(principal, "quote_workflow");
    const { id } = await context.params;
    const workspace = await updateQuoteRequest(db, principal.userId, id, input);

    return jsonWithPrincipalCookie({ workspace }, principal);
  } catch (error) {
    return routeError(error, principal);
  }
}
