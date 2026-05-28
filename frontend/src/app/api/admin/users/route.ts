import { NextResponse } from "next/server";
import { AdminAuthError, requireAdmin } from "@/server/admin/auth";
import { listAdminUsers, type AdminUserFilterStatus, type ListAdminUsersFilters } from "@/server/admin/users-repository";
import { isAccountTier, isUserRole } from "@/server/auth/entitlements";
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

function isFilterStatus(value: unknown): value is AdminUserFilterStatus {
  return value === "enabled" || value === "disabled";
}

function parseFilters(request: Request): ListAdminUsersFilters | null {
  const url = new URL(request.url);
  const filters: ListAdminUsersFilters = {};
  const q = url.searchParams.get("q")?.trim();
  const role = url.searchParams.get("role");
  const tier = url.searchParams.get("tier");
  const status = url.searchParams.get("status");

  if (q) filters.q = q;
  if (role !== null) {
    if (!isUserRole(role)) return null;
    filters.role = role;
  }
  if (tier !== null) {
    if (!isAccountTier(tier)) return null;
    filters.tier = tier;
  }
  if (status !== null) {
    if (!isFilterStatus(status)) return null;
    filters.status = status;
  }

  return filters;
}

export async function GET(request: Request) {
  const filters = parseFilters(request);

  if (!filters) {
    return errorResponse("INVALID_REQUEST", "Unsupported user filter.", 400);
  }

  try {
    await requireAdmin(db, request);
    return NextResponse.json(listAdminUsers(db, filters));
  } catch (error) {
    return routeError(error);
  }
}
