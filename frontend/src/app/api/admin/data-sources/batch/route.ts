import { NextResponse } from "next/server";
import { requireAdminAccess, AdminAuthError, type AdminAccessPrincipal } from "@/server/admin/auth";
import {
  AdminDataSourceNotFoundError,
  updateAdminDataSource,
  updateAdminDataSourceFromMysql,
  type AdminDataSource,
  type MysqlDataSourcesStore,
  type UpdateAdminDataSourceInput,
} from "@/server/admin/data-sources-repository";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { csrfRejectedResponse, verifyCsrfSafe } from "@/server/security/csrf";

type BatchSourceApprovalAction = "approve" | "hold";

interface ParsedBatchBody {
  sourceIds: string[];
  action: BatchSourceApprovalAction;
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function routeError(error: unknown) {
  if (error instanceof AdminAuthError) {
    return errorResponse(error.code, error.message, error.status);
  }

  if (error instanceof AdminDataSourceNotFoundError) {
    return errorResponse("DATA_SOURCE_NOT_FOUND", "Data source was not found.", 404);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
}

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;
  if (isMysqlDatabaseUrlConfigured()) return {} as AppDatabase;

  const client = await import("@/server/db/client");
  return client.db;
}

function actorUserIdForAdminAccess(access: AdminAccessPrincipal) {
  return access.kind === "admin" ? access.userId : null;
}

async function parseBatchBody(request: Request): Promise<ParsedBatchBody | null> {
  const body = (await request.json().catch(() => null)) as {
    sourceIds?: unknown;
    action?: unknown;
  } | null;

  if (!body || !Array.isArray(body.sourceIds) || body.sourceIds.some((id) => typeof id !== "string")) {
    return null;
  }

  const sourceIds = Array.from(new Set(body.sourceIds.map((id) => id.trim()).filter(Boolean)));
  if (sourceIds.length === 0 || sourceIds.length > 100) {
    return null;
  }

  if (body.action !== "approve" && body.action !== "hold") {
    return null;
  }

  return {
    sourceIds,
    action: body.action,
  };
}

function inputForBatchAction(action: BatchSourceApprovalAction): UpdateAdminDataSourceInput {
  if (action === "approve") {
    return {
      approvedForIngestion: true,
      approvalStatus: "approved",
      legalReviewStatus: "approved_public",
      approvalNotes: "Approved from Admin batch source approval workflow.",
    };
  }

  return {
    approvedForIngestion: false,
    approvalStatus: "needs_review",
    legalReviewStatus: "not_reviewed",
    approvalNotes: "Held from Admin batch source approval workflow.",
  };
}

export function createAdminDataSourcesBatchPost(database?: AppDatabase, mysql?: MysqlDataSourcesStore) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());

  return async function POST(request: Request) {
    if (!verifyCsrfSafe(request)) {
      return csrfRejectedResponse();
    }

    const body = await parseBatchBody(request);
    if (!body) {
      return errorResponse("INVALID_REQUEST", "Request body must include sourceIds and a valid batch action.", 400);
    }

    try {
      const resolvedDb = await resolveDatabase(database);
      const access = await requireAdminAccess(resolvedDb, request, { roles: ["admin"] });
      const actorUserId = actorUserIdForAdminAccess(access);
      const input = inputForBatchAction(body.action);
      const sources: AdminDataSource[] = [];
      const store = shouldUseMysqlRuntime() ? mysql ?? resolveMysqlPool() : null;

      for (const sourceId of body.sourceIds) {
        sources.push(
          store
            ? await updateAdminDataSourceFromMysql(store, sourceId, input, { actorUserId })
            : await updateAdminDataSource(resolvedDb, sourceId, input, { actorUserId }),
        );
      }

      return NextResponse.json({
        updatedCount: sources.length,
        sources,
      });
    } catch (error) {
      return routeError(error);
    }
  };
}

export const POST = createAdminDataSourcesBatchPost();
