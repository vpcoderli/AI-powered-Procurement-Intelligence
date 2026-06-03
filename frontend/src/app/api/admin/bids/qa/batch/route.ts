import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminAccess } from "@/server/admin/auth";
import {
  batchUpdateAdminBidQaItems,
  batchUpdateAdminBidQaItemsFromMysql,
  isAdminBidQaDisplayStatus,
  isAdminBidQaReviewStatus,
  type BatchUpdateAdminBidQaInput,
} from "@/server/admin/bid-qa-repository";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function routeError(error: unknown) {
  if (error instanceof AdminAuthError) {
    return errorResponse(error.code, error.message, error.status);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
}

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;

  const client = await import("@/server/db/client");
  return client.db;
}

type ParsedBatchBody = Omit<BatchUpdateAdminBidQaInput, "reviewerId" | "reviewedAt">;

async function parseBatchBody(request: Request): Promise<ParsedBatchBody | null> {
  const body = (await request.json().catch(() => null)) as {
    bidIds?: unknown;
    displayStatus?: unknown;
    note?: unknown;
    reviewStatus?: unknown;
  } | null;

  if (!body || !Array.isArray(body.bidIds) || body.bidIds.some((id) => typeof id !== "string")) {
    return null;
  }
  if ("note" in body && body.note !== null && body.note !== undefined && typeof body.note !== "string") {
    return null;
  }

  const reviewStatus = isAdminBidQaReviewStatus(body.reviewStatus) ? body.reviewStatus : undefined;
  const displayStatus = isAdminBidQaDisplayStatus(body.displayStatus) ? body.displayStatus : undefined;
  if (Boolean(reviewStatus) === Boolean(displayStatus)) {
    return null;
  }

  return reviewStatus
    ? {
        bidIds: body.bidIds,
        note: typeof body.note === "string" ? body.note : null,
        reviewStatus,
      }
    : {
        bidIds: body.bidIds,
        displayStatus,
      };
}

export function createAdminBidQaBatchPost(database?: AppDatabase) {
  const shouldUseMysqlRuntime = () => !database && isMysqlDatabaseUrlConfigured();

  return async function POST(request: Request) {
    const input = await parseBatchBody(request);
    if (!input) {
      return errorResponse("INVALID_REQUEST", "Request body must include bidIds and one valid batch action.", 400);
    }

    try {
      const resolvedDb = await resolveDatabase(database);
      const principal = await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator"] });
      const reviewerId = principal.kind === "admin" ? principal.userId : "local-bypass";
      const payload = {
        ...input,
        reviewerId,
      };
      const result = shouldUseMysqlRuntime()
        ? await batchUpdateAdminBidQaItemsFromMysql(resolveMysqlPool(), payload)
        : await batchUpdateAdminBidQaItems(resolvedDb, payload);

      return NextResponse.json(result);
    } catch (error) {
      return routeError(error);
    }
  };
}

export const POST = createAdminBidQaBatchPost();
