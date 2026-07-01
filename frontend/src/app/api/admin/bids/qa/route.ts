import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminAccess } from "@/server/admin/auth";
import {
  isAdminBidQaDisplayStatus,
  isAdminBidQaReviewStatus,
  listAdminBidQaItems,
  listAdminBidQaItemsFromMysql,
  type AdminBidQaArchiveStatus,
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

function numberParam(params: URLSearchParams, key: string) {
  const value = params.get(key);
  if (!value) return undefined;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringParam(params: URLSearchParams, key: string) {
  return params.get(key)?.trim() || undefined;
}

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;
  if (isMysqlDatabaseUrlConfigured()) return {} as AppDatabase;

  const client = await import("@/server/db/client");
  return client.db;
}

export function createAdminBidQaGet(database?: AppDatabase) {
  const shouldUseMysqlRuntime = () => !database && isMysqlDatabaseUrlConfigured();

  return async function GET(request: Request) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator", "support"] });

      const params = new URL(request.url).searchParams;
      const reviewStatus = stringParam(params, "reviewStatus");
      const displayStatus = stringParam(params, "displayStatus");
      const filters = {
        limit: numberParam(params, "limit"),
        q: stringParam(params, "q"),
        stateCode: stringParam(params, "stateCode"),
        reviewStatus: isAdminBidQaReviewStatus(reviewStatus) ? reviewStatus : undefined,
        archiveStatus: stringParam(params, "archiveStatus") as AdminBidQaArchiveStatus | undefined,
        displayStatus: isAdminBidQaDisplayStatus(displayStatus) ? displayStatus : undefined,
        sourceConfidence: stringParam(params, "sourceConfidence"),
        minQualityScore: numberParam(params, "minQualityScore"),
        maxQualityScore: numberParam(params, "maxQualityScore"),
        reviewerId: stringParam(params, "reviewerId"),
        reviewedFrom: stringParam(params, "reviewedFrom"),
        reviewedTo: stringParam(params, "reviewedTo"),
      };
      const response = shouldUseMysqlRuntime()
        ? await listAdminBidQaItemsFromMysql(resolveMysqlPool(), filters)
        : await listAdminBidQaItems(resolvedDb, filters);

      return NextResponse.json(response);
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminBidQaGet();
