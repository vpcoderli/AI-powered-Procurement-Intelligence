import { NextResponse } from "next/server";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { UsageLimitError, enforceMysqlSearchAlertUsageLimit, enforceUsageLimit } from "@/server/auth/usage-limits";
import { db } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import * as searchAlertService from "@/server/search-alerts/service";
import type { CreateSearchAlertInput } from "@/server/search-alerts/types";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function invalidRequest() {
  return errorResponse("INVALID_REQUEST", "Request body must include a valid alert", 400);
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

function usageLimitError(error: UsageLimitError, principal: RequestPrincipal) {
  return jsonWithPrincipalCookie(
    {
      error: {
        code: error.code,
        message: "Upgrade your plan to create more search alerts.",
        feature: error.feature,
        limit: error.limit,
        used: error.used,
        requiredTier: error.requiredTier,
      },
    },
    principal,
    { status: 402 },
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isQuery(value: unknown): value is CreateSearchAlertInput["query"] {
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

function parseCreateInput(body: unknown): CreateSearchAlertInput | null {
  if (typeof body !== "object" || body === null) return null;

  const input = body as {
    name?: unknown;
    query?: unknown;
    frequency?: unknown;
    isEnabled?: unknown;
  };

  if (
    typeof input.name !== "string" ||
    input.name.trim().length === 0 ||
    !isQuery(input.query) ||
    (input.frequency !== "daily" && input.frequency !== "weekly") ||
    typeof input.isEnabled !== "boolean"
  ) {
    return null;
  }

  return {
    name: input.name.trim(),
    query: input.query,
    frequency: input.frequency,
    isEnabled: input.isEnabled,
  };
}

export async function GET(request: Request) {
  const principal = await resolvePrincipal(db, request);

  try {
    const alerts = await searchAlertService.listSearchAlerts(db, principal.userId);

    return jsonWithPrincipalCookie({ alerts }, principal);
  } catch {
    return internalError(principal);
  }
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return invalidRequest();
  }

  const input = parseCreateInput(body);
  if (!input) return invalidRequest();

  const principal = await resolvePrincipal(db, request);

  try {
    if (isMysqlDatabaseUrlConfigured()) {
      await enforceMysqlSearchAlertUsageLimit(resolveMysqlPool(), {
        userId: principal.userId,
        tier: principal.tier,
      });
    } else {
      enforceUsageLimit(db, {
        userId: principal.userId,
        tier: principal.tier,
        feature: "search_alerts",
      });
    }
    const alert = await searchAlertService.createSearchAlert(db, principal.userId, input);

    return jsonWithPrincipalCookie({ alert }, principal);
  } catch (error) {
    if (error instanceof UsageLimitError) {
      return usageLimitError(error, principal);
    }

    return internalError(principal);
  }
}
