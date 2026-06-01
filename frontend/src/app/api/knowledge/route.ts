import { NextResponse } from "next/server";
import {
  FeatureAccessError,
  featureErrorResponse,
  requireFeature,
} from "@/server/auth/feature-gate";
import { resolvePrincipal, type RequestPrincipal } from "@/server/auth/principal";
import { db, type AppDatabase } from "@/server/db/client";
import {
  createKnowledgeItem,
  KnowledgeValidationError,
  listKnowledgeItems,
} from "@/server/knowledge/service";

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

function unauthenticatedResponse(principal: RequestPrincipal) {
  return errorResponse(
    "UNAUTHENTICATED",
    "Sign in to use Knowledge Station.",
    401,
    principal,
  );
}

function workspaceOrganizationId(principal: RequestPrincipal) {
  if (principal.kind !== "authenticated") return null;

  return principal.workspace?.organizationId ?? null;
}

function optionalQueryValue(value: string | null) {
  return value?.trim() || null;
}

function limitQueryValue(value: string | null) {
  if (!value) return null;

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function objectBody(body: unknown) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {};
  }

  return body as Record<string, unknown>;
}

export function createKnowledgeRouteHandlers(database: AppDatabase) {
  async function GET(request: Request) {
    const principal = await resolvePrincipal(database, request);
    const organizationId = workspaceOrganizationId(principal);

    if (!organizationId) {
      return unauthenticatedResponse(principal);
    }

    try {
      requireFeature(principal, "knowledge_station");

      const searchParams = new URL(request.url).searchParams;
      const result = await listKnowledgeItems(database, {
        organizationId,
        intentId: optionalQueryValue(searchParams.get("intentId")),
        bidId: optionalQueryValue(searchParams.get("bidId")),
        q: optionalQueryValue(searchParams.get("q")),
        type: optionalQueryValue(searchParams.get("type")),
        limit: limitQueryValue(searchParams.get("limit")),
      });

      return jsonWithPrincipalCookie(result, principal);
    } catch (error) {
      if (error instanceof FeatureAccessError) {
        return NextResponse.json(featureErrorResponse(error), { status: error.status });
      }

      if (error instanceof KnowledgeValidationError) {
        return errorResponse("INVALID_REQUEST", error.message, 400, principal);
      }

      return errorResponse("INTERNAL_ERROR", "Internal server error", 500, principal);
    }
  }

  async function POST(request: Request) {
    const body = objectBody(await request.json().catch(() => null));
    const principal = await resolvePrincipal(database, request);
    const organizationId = workspaceOrganizationId(principal);

    if (!organizationId) {
      return unauthenticatedResponse(principal);
    }

    try {
      requireFeature(principal, "knowledge_station");

      const item = await createKnowledgeItem(database, {
        organizationId,
        userId: principal.userId,
        title: body.title as string,
        body: body.body as string,
        type: body.type as string,
        tags: body.tags,
        sourceKind: body.sourceKind as string,
        sourceIntentId: body.sourceIntentId as string | null | undefined,
        sourceBidId: body.sourceBidId as string | null | undefined,
        sourceUrl: body.sourceUrl as string | null | undefined,
      });

      return jsonWithPrincipalCookie({ item }, principal, { status: 201 });
    } catch (error) {
      if (error instanceof FeatureAccessError) {
        return NextResponse.json(featureErrorResponse(error), { status: error.status });
      }

      if (error instanceof KnowledgeValidationError) {
        return errorResponse("INVALID_REQUEST", error.message, 400, principal);
      }

      return errorResponse("INTERNAL_ERROR", "Internal server error", 500, principal);
    }
  }

  return { GET, POST };
}

export const { GET, POST } = createKnowledgeRouteHandlers(db);
