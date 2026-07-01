import { NextResponse } from "next/server";
import { requireAdminAccess, AdminAuthError, type AdminAccessPrincipal } from "@/server/admin/auth";
import {
  AdminDataSourceNotFoundError,
  updateAdminDataSource,
  updateAdminDataSourceFromMysql,
  type MysqlDataSourcesStore,
  type UpdateAdminDataSourceInput,
} from "@/server/admin/data-sources-repository";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import type { SourceApprovalStatus, SourceLegalReviewStatus } from "@/lib/state-crawler-sources";

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

  if (error instanceof AdminDataSourceNotFoundError) {
    return errorResponse("DATA_SOURCE_NOT_FOUND", "Data source was not found.", 404);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
}

function parseApprovalStatus(value: unknown): SourceApprovalStatus | null | undefined {
  if (value === undefined) return undefined;
  if (value === "approved" || value === "needs_review" || value === "blocked") return value;
  return null;
}

function parseLegalReviewStatus(value: unknown): SourceLegalReviewStatus | null | undefined {
  if (value === undefined) return undefined;
  if (value === "approved_public" || value === "not_reviewed" || value === "restricted") return value;
  return null;
}

function parseNullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "string") return value;
  return undefined;
}

async function parsePatchBody(request: Request): Promise<UpdateAdminDataSourceInput | null> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return null;
  }

  const approvalStatus = parseApprovalStatus(body.approvalStatus);
  const legalReviewStatus = parseLegalReviewStatus(body.legalReviewStatus);
  if (approvalStatus === null || legalReviewStatus === null) {
    return null;
  }

  const input: UpdateAdminDataSourceInput = {};
  if (Object.hasOwn(body, "isEnabled")) {
    if (typeof body.isEnabled !== "boolean") return null;
    input.isEnabled = body.isEnabled;
  }
  if (Object.hasOwn(body, "approvedForIngestion")) {
    if (typeof body.approvedForIngestion !== "boolean") return null;
    input.approvedForIngestion = body.approvedForIngestion;
  }
  if (approvalStatus !== undefined) {
    input.approvalStatus = approvalStatus;
  }
  if (legalReviewStatus !== undefined) {
    input.legalReviewStatus = legalReviewStatus;
  }
  if (Object.hasOwn(body, "approvalNotes")) {
    if (body.approvalNotes !== null && typeof body.approvalNotes !== "string") return null;
    input.approvalNotes = body.approvalNotes;
  }
  if (Object.hasOwn(body, "liveHealthOwner")) {
    const value = parseNullableString(body.liveHealthOwner);
    if (value === undefined) return null;
    input.liveHealthOwner = value;
  }
  if (Object.hasOwn(body, "liveHealthDisposition")) {
    const value = parseNullableString(body.liveHealthDisposition);
    if (value === undefined) return null;
    input.liveHealthDisposition = value;
  }
  if (Object.hasOwn(body, "liveHealthNextReviewAt")) {
    const value = parseNullableString(body.liveHealthNextReviewAt);
    if (value === undefined) return null;
    input.liveHealthNextReviewAt = value;
  }
  if (Object.hasOwn(body, "liveHealthNotes")) {
    const value = parseNullableString(body.liveHealthNotes);
    if (value === undefined) return null;
    input.liveHealthNotes = value;
  }
  if (Object.hasOwn(body, "liveHealthReviewedAt")) {
    const value = parseNullableString(body.liveHealthReviewedAt);
    if (value === undefined) return null;
    input.liveHealthReviewedAt = value;
  }
  if (Object.hasOwn(body, "tosReviewed")) {
    if (body.tosReviewed !== null && typeof body.tosReviewed !== "boolean") return null;
    input.tosReviewed = body.tosReviewed as boolean | null;
  }
  if (Object.hasOwn(body, "tosReviewedAt")) {
    const value = parseNullableString(body.tosReviewedAt);
    if (value === undefined) return null;
    input.tosReviewedAt = value;
  }
  if (Object.hasOwn(body, "tosUrl")) {
    const value = parseNullableString(body.tosUrl);
    if (value === undefined) return null;
    input.tosUrl = value;
  }
  if (Object.hasOwn(body, "complianceReviewer")) {
    const value = parseNullableString(body.complianceReviewer);
    if (value === undefined) return null;
    input.complianceReviewer = value;
  }
  if (Object.hasOwn(body, "legalOpinionReference")) {
    const value = parseNullableString(body.legalOpinionReference);
    if (value === undefined) return null;
    input.legalOpinionReference = value;
  }
  if (Object.hasOwn(body, "complianceReviewDueAt")) {
    const value = parseNullableString(body.complianceReviewDueAt);
    if (value === undefined) return null;
    input.complianceReviewDueAt = value;
  }
  if (Object.hasOwn(body, "complianceNotes")) {
    const value = parseNullableString(body.complianceNotes);
    if (value === undefined) return null;
    input.complianceNotes = value;
  }

  return Object.keys(input).length > 0 ? input : null;
}

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;
  if (isMysqlDatabaseUrlConfigured()) return {} as AppDatabase;

  const client = await import("@/server/db/client");
  return client.db;
}

function includesGovernanceUpdate(input: UpdateAdminDataSourceInput) {
  return (
    Object.hasOwn(input, "approvedForIngestion") ||
    Object.hasOwn(input, "approvalStatus") ||
    Object.hasOwn(input, "legalReviewStatus") ||
    Object.hasOwn(input, "approvalNotes") ||
    Object.hasOwn(input, "tosReviewed") ||
    Object.hasOwn(input, "tosReviewedAt") ||
    Object.hasOwn(input, "tosUrl") ||
    Object.hasOwn(input, "complianceReviewer") ||
    Object.hasOwn(input, "legalOpinionReference") ||
    Object.hasOwn(input, "complianceReviewDueAt") ||
    Object.hasOwn(input, "complianceNotes")
  );
}

function actorUserIdForAdminAccess(access: AdminAccessPrincipal) {
  return access.kind === "admin" ? access.userId : null;
}

export function createAdminDataSourcePatch(database?: AppDatabase, mysql?: MysqlDataSourcesStore) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());

  return async function PATCH(request: Request, context: RouteContext) {
    try {
      const resolvedDb = await resolveDatabase(database);
      const access = await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator"] });

      const input = await parsePatchBody(request);
      if (!input) {
        return errorResponse("INVALID_REQUEST", "Request body must include a valid data source update.", 400);
      }
      let actorUserId = actorUserIdForAdminAccess(access);
      if (includesGovernanceUpdate(input)) {
        const adminAccess = await requireAdminAccess(resolvedDb, request, { roles: ["admin"] });
        actorUserId = actorUserIdForAdminAccess(adminAccess);
      }

      const { id } = await context.params;
      const source = shouldUseMysqlRuntime()
        ? await updateAdminDataSourceFromMysql(mysql ?? resolveMysqlPool(), id, input, { actorUserId })
        : await updateAdminDataSource(resolvedDb, id, input, { actorUserId });

      return NextResponse.json({ source });
    } catch (error) {
      return routeError(error);
    }
  };
}

export const PATCH = createAdminDataSourcePatch();
