import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminAccess } from "@/server/admin/auth";
import {
  AdminBidQaNotFoundError,
  isAdminBidQaCorrectionField,
  isAdminBidQaDisplayStatus,
  isAdminBidQaReviewStatus,
  listAdminBidQaCorrections,
  listAdminBidQaCorrectionsFromMysql,
  updateAdminBidQaCorrection,
  updateAdminBidQaCorrectionFromMysql,
  updateAdminBidQaDisplayStatus,
  updateAdminBidQaDisplayStatusFromMysql,
  updateAdminBidQaReview,
  updateAdminBidQaReviewFromMysql,
} from "@/server/admin/bid-qa-repository";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { csrfRejectedResponse, verifyCsrfSafe } from "@/server/security/csrf";

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

function isBlankRequiredCorrection(field: string, value: string | null) {
  return (field === "title" || field === "issuerName" || field === "sourceUrl") && (!value || value.trim().length === 0);
}

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;
  if (isMysqlDatabaseUrlConfigured()) return {} as AppDatabase;

  const client = await import("@/server/db/client");
  return client.db;
}

async function parsePatchBody(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    corrections?: unknown;
    displayStatus?: unknown;
    reviewStatus?: unknown;
    note?: unknown;
  } | null;

  if (!body) {
    return null;
  }

  if ("note" in body && body.note !== null && body.note !== undefined && typeof body.note !== "string") {
    return null;
  }

  const note = typeof body.note === "string" ? body.note : null;

  if (isAdminBidQaReviewStatus(body.reviewStatus) && body.displayStatus === undefined && body.corrections === undefined) {
    return {
      action: "review" as const,
      reviewStatus: body.reviewStatus,
      note,
    };
  }

  if (isAdminBidQaDisplayStatus(body.displayStatus) && body.reviewStatus === undefined && body.corrections === undefined) {
    return {
      action: "display" as const,
      displayStatus: body.displayStatus,
    };
  }

  if (typeof body.corrections === "object" && body.corrections !== null && !Array.isArray(body.corrections)) {
    const corrections: Record<string, string | null> = {};
    for (const [field, value] of Object.entries(body.corrections)) {
      if (!isAdminBidQaCorrectionField(field)) return null;
      if (value !== null && typeof value !== "string") return null;
      if (isBlankRequiredCorrection(field, value)) return null;
      corrections[field] = value;
    }
    if (Object.keys(corrections).length === 0 || body.reviewStatus !== undefined || body.displayStatus !== undefined) {
      return null;
    }
    return {
      action: "correction" as const,
      corrections,
      note,
    };
  }

  return null;
}

export function createAdminBidQaPatch(database?: AppDatabase) {
  const shouldUseMysqlRuntime = () => !database && isMysqlDatabaseUrlConfigured();

  return async function PATCH(request: Request, context: RouteContext) {
    if (!verifyCsrfSafe(request)) {
      return csrfRejectedResponse();
    }

    const input = await parsePatchBody(request);
    if (!input) {
      return errorResponse("INVALID_REQUEST", "Request body must include a valid reviewStatus.", 400);
    }

    try {
      const resolvedDb = await resolveDatabase(database);
      const principal = await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator"] });
      const { id } = await context.params;
      const reviewerId = principal.kind === "admin" ? principal.userId : "local-bypass";
      const mysql = shouldUseMysqlRuntime() ? resolveMysqlPool() : null;
      const item =
        input.action === "review"
          ? mysql
            ? await updateAdminBidQaReviewFromMysql(mysql, id, {
                reviewStatus: input.reviewStatus,
                note: input.note,
                reviewerId,
              })
            : await updateAdminBidQaReview(resolvedDb, id, {
              reviewStatus: input.reviewStatus,
              note: input.note,
              reviewerId,
            })
          : input.action === "display"
            ? mysql
              ? await updateAdminBidQaDisplayStatusFromMysql(mysql, id, {
                  displayStatus: input.displayStatus,
                  reviewerId,
                })
              : await updateAdminBidQaDisplayStatus(resolvedDb, id, {
                displayStatus: input.displayStatus,
                reviewerId,
              })
            : mysql
              ? await updateAdminBidQaCorrectionFromMysql(mysql, id, {
                  corrections: input.corrections,
                  note: input.note,
                  reviewerId,
                })
              : await updateAdminBidQaCorrection(resolvedDb, id, {
                corrections: input.corrections,
                note: input.note,
                reviewerId,
              });

      return NextResponse.json({ item });
    } catch (error) {
      return routeError(error);
    }
  };
}

export function createAdminBidQaGet(database?: AppDatabase) {
  const shouldUseMysqlRuntime = () => !database && isMysqlDatabaseUrlConfigured();

  return async function GET(request: Request, context: RouteContext) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request);
      const { id } = await context.params;
      const corrections = shouldUseMysqlRuntime()
        ? await listAdminBidQaCorrectionsFromMysql(resolveMysqlPool(), id)
        : await listAdminBidQaCorrections(resolvedDb, id);

      return NextResponse.json({ corrections });
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminBidQaGet();
export const PATCH = createAdminBidQaPatch();
