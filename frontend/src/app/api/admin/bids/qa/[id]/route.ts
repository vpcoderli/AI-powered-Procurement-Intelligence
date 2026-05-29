import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminAccess } from "@/server/admin/auth";
import {
  AdminBidQaNotFoundError,
  isAdminBidQaReviewStatus,
  updateAdminBidQaReview,
} from "@/server/admin/bid-qa-repository";
import type { AppDatabase } from "@/server/db/client";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function routeError(error: unknown) {
  if (error instanceof AdminAuthError) {
    return errorResponse(error.code, error.message, error.status);
  }

  if (error instanceof AdminBidQaNotFoundError) {
    return errorResponse("BID_NOT_FOUND", "Bid was not found.", 404);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
}

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;

  const client = await import("@/server/db/client");
  return client.db;
}

async function parsePatchBody(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    reviewStatus?: unknown;
    note?: unknown;
  } | null;

  if (!body || !isAdminBidQaReviewStatus(body.reviewStatus)) {
    return null;
  }

  if ("note" in body && body.note !== null && body.note !== undefined && typeof body.note !== "string") {
    return null;
  }

  const note = typeof body.note === "string" ? body.note : null;

  return {
    reviewStatus: body.reviewStatus,
    note,
  };
}

export function createAdminBidQaPatch(database?: AppDatabase) {
  return async function PATCH(request: Request, context: RouteContext) {
    const input = await parsePatchBody(request);
    if (!input) {
      return errorResponse("INVALID_REQUEST", "Request body must include a valid reviewStatus.", 400);
    }

    try {
      const resolvedDb = await resolveDatabase(database);
      const principal = await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator"] });
      const { id } = await context.params;
      const item = await updateAdminBidQaReview(resolvedDb, id, {
        ...input,
        reviewerId: principal.kind === "admin" ? principal.userId : "local-bypass",
      });

      return NextResponse.json({ item });
    } catch (error) {
      return routeError(error);
    }
  };
}

export const PATCH = createAdminBidQaPatch();
