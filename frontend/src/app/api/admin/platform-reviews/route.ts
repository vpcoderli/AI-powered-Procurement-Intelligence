import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminAccess, type AdminAccessPrincipal } from "@/server/admin/auth";
import {
  PlatformReviewValidationError,
  createPlatformReview,
  createPlatformReviewFromMysql,
  effectivePlatformReviewsByFamily,
  listPlatformReviews,
  listPlatformReviewsFromMysql,
  validatePlatformReviewInput,
  type MysqlPlatformReviewsStore,
} from "@/server/admin/platform-reviews-repository";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { csrfRejectedResponse, verifyCsrfSafe } from "@/server/security/csrf";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function routeError(error: unknown) {
  if (error instanceof AdminAuthError) {
    return errorResponse(error.code, error.message, error.status);
  }

  if (error instanceof PlatformReviewValidationError) {
    return errorResponse("INVALID_REQUEST", error.issues.join("; "), 400);
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

/**
 * The platform review ledger (spec 2026-09-24 §7.1): one row per compliance review of a source
 * platform (ToS, robots.txt, access boundary). Readable by every admin-console role; only a full
 * admin may record a review, because a valid one is what unlocks batch approval of that platform's
 * sources.
 */
export function createAdminPlatformReviewsGet(database?: AppDatabase, mysql?: MysqlPlatformReviewsStore) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());

  return async function GET(request: Request) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator", "support"] });
      const store = shouldUseMysqlRuntime() ? mysql ?? resolveMysqlPool() : null;
      const reviews = store ? await listPlatformReviewsFromMysql(store) : listPlatformReviews(resolvedDb);
      return NextResponse.json({ reviews, effective: effectivePlatformReviewsByFamily(reviews, new Date()) });
    } catch (error) {
      return routeError(error);
    }
  };
}

export function createAdminPlatformReviewsPost(database?: AppDatabase, mysql?: MysqlPlatformReviewsStore) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());

  return async function POST(request: Request) {
    if (!verifyCsrfSafe(request)) {
      return csrfRejectedResponse();
    }

    try {
      const resolvedDb = await resolveDatabase(database);
      const access = await requireAdminAccess(resolvedDb, request, { roles: ["admin"] });
      const now = new Date();
      const input = validatePlatformReviewInput(await request.json().catch(() => null), now);
      const options = { actorUserId: actorUserIdForAdminAccess(access), now };
      const store = shouldUseMysqlRuntime() ? mysql ?? resolveMysqlPool() : null;
      const review = store
        ? await createPlatformReviewFromMysql(store, input, options)
        : createPlatformReview(resolvedDb, input, options);
      return NextResponse.json({ review }, { status: 201 });
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminPlatformReviewsGet();
export const POST = createAdminPlatformReviewsPost();
