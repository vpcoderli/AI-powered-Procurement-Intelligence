import { NextResponse } from "next/server";
import { AdminAuthError, requireAdmin } from "@/server/admin/auth";
import {
  AdminUserFeatureOverrideError,
  AdminUserNotFoundError,
  listAdminUserFeatureOverrides,
  updateAdminUserFeatureOverride,
  type UpdateAdminUserFeatureOverrideInput,
} from "@/server/admin/users-repository";
import { isFeatureKey } from "@/server/auth/entitlements";
import { db } from "@/server/db/client";

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

  if (error instanceof AdminUserNotFoundError) {
    return errorResponse("USER_NOT_FOUND", error.message, 404);
  }

  if (error instanceof AdminUserFeatureOverrideError) {
    return errorResponse("INVALID_REQUEST", error.message, 400);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
}

function parseUpdate(body: unknown): UpdateAdminUserFeatureOverrideInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const source = body as Record<string, unknown>;
  if (!isFeatureKey(source.featureKey) || source.featureKey === "admin_console") {
    return null;
  }

  if (source.isEnabled !== true && source.isEnabled !== false && source.isEnabled !== null) {
    return null;
  }

  if ("reason" in source && source.reason !== undefined && source.reason !== null && typeof source.reason !== "string") {
    return null;
  }

  if (
    "expiresAt" in source &&
    source.expiresAt !== undefined &&
    source.expiresAt !== null &&
    (typeof source.expiresAt !== "string" || !Number.isFinite(new Date(source.expiresAt).getTime()))
  ) {
    return null;
  }

  return {
    featureKey: source.featureKey,
    isEnabled: source.isEnabled,
    reason: typeof source.reason === "string" ? source.reason : null,
    expiresAt: typeof source.expiresAt === "string" ? new Date(source.expiresAt).toISOString() : null,
  };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireAdmin(db, request);
    const { id } = await context.params;

    return NextResponse.json(listAdminUserFeatureOverrides(db, id));
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const body = await request.json().catch(() => null);
  const input = parseUpdate(body);

  if (!input) {
    return errorResponse("INVALID_REQUEST", "Feature key and override state are required.", 400);
  }

  try {
    const principal = await requireAdmin(db, request);
    const { id } = await context.params;

    return NextResponse.json(updateAdminUserFeatureOverride(db, id, input, {
      actorKind: principal.kind,
      actorUserId: principal.kind === "admin" ? principal.userId : null,
    }));
  } catch (error) {
    return routeError(error);
  }
}
