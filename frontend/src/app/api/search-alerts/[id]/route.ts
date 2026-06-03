import { NextResponse } from "next/server";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { authRequiredResponse, isAuthenticatedPrincipal } from "@/server/auth/route-guards";
import { db } from "@/server/db/client";
import * as searchAlertService from "@/server/search-alerts/service";
import { SearchAlertNotFoundError, type UpdateSearchAlertInput } from "@/server/search-alerts/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function invalidRequest() {
  return errorResponse("INVALID_REQUEST", "Request body must include a valid alert update", 400);
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

function internalError(principal: RequestPrincipal) {
  return jsonWithPrincipalCookie(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    principal,
    { status: 500 },
  );
}

function notFound(principal: RequestPrincipal) {
  return jsonWithPrincipalCookie(
    { error: { code: "ALERT_NOT_FOUND", message: "Search alert not found" } },
    principal,
    { status: 404 },
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isQuery(value: unknown): value is NonNullable<UpdateSearchAlertInput["query"]> {
  if (typeof value !== "object" || value === null) return false;

  const query = value as {
    q?: unknown;
    states?: unknown;
    issuerType?: unknown;
    deadline?: unknown;
    published?: unknown;
    sort?: unknown;
  };

  return (
    (query.q === undefined || typeof query.q === "string") &&
    (query.states === undefined || isStringArray(query.states)) &&
    (query.issuerType === undefined ||
      query.issuerType === "all" ||
      query.issuerType === "federal" ||
      query.issuerType === "state") &&
    (query.deadline === undefined ||
      query.deadline === "any" ||
      query.deadline === "next7" ||
      query.deadline === "next30") &&
    (query.published === undefined ||
      query.published === "any" ||
      query.published === "last24" ||
      query.published === "last7") &&
    (query.sort === undefined ||
      query.sort === "relevance" ||
      query.sort === "newest" ||
      query.sort === "deadline")
  );
}

function parseUpdateInput(body: unknown): UpdateSearchAlertInput | null {
  if (typeof body !== "object" || body === null) return null;

  const bodyObject = body as {
    name?: unknown;
    query?: unknown;
    frequency?: unknown;
    isEnabled?: unknown;
  };
  const input: UpdateSearchAlertInput = {};

  if ("name" in bodyObject) {
    if (typeof bodyObject.name !== "string" || bodyObject.name.trim().length === 0) {
      return null;
    }
    input.name = bodyObject.name.trim();
  }

  if ("query" in bodyObject) {
    if (!isQuery(bodyObject.query)) return null;
    input.query = bodyObject.query;
  }

  if ("frequency" in bodyObject) {
    if (bodyObject.frequency !== "daily" && bodyObject.frequency !== "weekly") return null;
    input.frequency = bodyObject.frequency;
  }

  if ("isEnabled" in bodyObject) {
    if (typeof bodyObject.isEnabled !== "boolean") return null;
    input.isEnabled = bodyObject.isEnabled;
  }

  return Object.keys(input).length > 0 ? input : null;
}

export async function PATCH(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return invalidRequest();
  }

  const input = parseUpdateInput(body);
  if (!input) return invalidRequest();

  try {
    const { id } = await context.params;
    const alert = await searchAlertService.updateSearchAlert(db, principal.userId, id, input);

    return jsonWithPrincipalCookie({ alert }, principal);
  } catch (error) {
    if (error instanceof SearchAlertNotFoundError) {
      return notFound(principal);
    }

    return internalError(principal);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const principal = await resolvePrincipal(db, request);

  if (!isAuthenticatedPrincipal(principal)) {
    return authRequiredResponse();
  }

  try {
    const { id } = await context.params;
    await searchAlertService.deleteSearchAlert(db, principal.userId, id);

    return jsonWithPrincipalCookie({}, principal);
  } catch (error) {
    if (error instanceof SearchAlertNotFoundError) {
      return notFound(principal);
    }

    return internalError(principal);
  }
}
