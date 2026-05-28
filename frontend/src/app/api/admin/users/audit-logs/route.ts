import { NextResponse } from "next/server";
import { AdminAuthError, requireAdmin } from "@/server/admin/auth";
import {
  listAdminUserAuditLogs,
  type AdminUserAuditAction,
  type AdminUserAuditActorKind,
  type ListAdminUserAuditLogsOptions,
} from "@/server/admin/users-repository";
import { isFeatureKey, type FeatureKey } from "@/server/auth/entitlements";
import { db } from "@/server/db/client";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function routeError(error: unknown) {
  if (error instanceof AdminAuthError) {
    return errorResponse(error.code, error.message, error.status);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
}

function parseLimit(request: Request) {
  const raw = new URL(request.url).searchParams.get("limit");
  if (!raw) return undefined;

  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function parseActorKind(value: string | null): AdminUserAuditActorKind | null | undefined {
  if (!value) return undefined;
  if (value === "admin" || value === "local-bypass" || value === "self-service") return value;

  return null;
}

function parseAction(value: string | null): AdminUserAuditAction | null | undefined {
  if (!value) return undefined;
  if (value === "user_access_updated" || value === "user_invited" || value === "user_self_deleted") return value;

  return null;
}

function parseAuditLogOptions(request: Request): ListAdminUserAuditLogsOptions | null {
  const searchParams = new URL(request.url).searchParams;
  const limit = parseLimit(request);
  const actorKind = parseActorKind(searchParams.get("actorKind"));
  const action = parseAction(searchParams.get("action"));
  const rawTarget = searchParams.get("target")?.trim();
  const rawFeatureKey = searchParams.get("featureKey");
  let featureKey: FeatureKey | undefined;

  if (limit === null || actorKind === null || action === null) {
    return null;
  }

  if (rawFeatureKey) {
    if (!isFeatureKey(rawFeatureKey) || rawFeatureKey === "admin_console") {
      return null;
    }

    featureKey = rawFeatureKey;
  }

  return {
    limit,
    actorKind,
    action,
    target: rawTarget || undefined,
    featureKey,
  };
}

export async function GET(request: Request) {
  const options = parseAuditLogOptions(request);

  if (!options) {
    return errorResponse("INVALID_REQUEST", "Audit log filters are invalid.", 400);
  }

  try {
    await requireAdmin(db, request);
    return NextResponse.json(listAdminUserAuditLogs(db, options));
  } catch (error) {
    return routeError(error);
  }
}
