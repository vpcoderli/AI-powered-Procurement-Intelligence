import { NextResponse } from "next/server";
import { AdminAuthError, requireAdmin } from "@/server/admin/auth";
import {
  AdminUserEmailExistsError,
  createAdminUserInvite,
  createAdminUserInviteFromMysql,
  listAdminUsers,
  listAdminUsersFromMysql,
  type AdminUserFilterStatus,
  type CreateAdminUserInviteInput,
  type ListAdminUsersFilters,
} from "@/server/admin/users-repository";
import { isAccountTier, isUserRole } from "@/server/auth/entitlements";
import { db } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function routeError(error: unknown) {
  if (error instanceof AdminAuthError) {
    return errorResponse(error.code, error.message, error.status);
  }

  if (error instanceof AdminUserEmailExistsError) {
    return errorResponse("EMAIL_EXISTS", error.message, 409);
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

function parseCreateInput(body: unknown): CreateAdminUserInviteInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const source = body as Record<string, unknown>;

  if (
    typeof source.email !== "string" ||
    source.email.trim().length === 0 ||
    !isUserRole(source.role) ||
    !isAccountTier(source.tier)
  ) {
    return null;
  }

  if ("displayName" in source && source.displayName !== undefined && typeof source.displayName !== "string") {
    return null;
  }

  return {
    email: source.email,
    displayName: typeof source.displayName === "string" ? source.displayName : undefined,
    role: source.role,
    tier: source.tier,
  };
}

export async function GET(request: Request) {
  const filters = parseFilters(request);

  if (!filters) {
    return errorResponse("INVALID_REQUEST", "Unsupported user filter.", 400);
  }

  try {
    await requireAdmin(db, request);
    const users = isMysqlDatabaseUrlConfigured()
      ? await listAdminUsersFromMysql(resolveMysqlPool(), filters)
      : listAdminUsers(db, filters);

    return NextResponse.json(users);
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const input = parseCreateInput(body);

  if (!input) {
    return errorResponse("INVALID_REQUEST", "Invited user email, role, and tier are required.", 400);
  }

  try {
    const principal = await requireAdmin(db, request);
    const actor = {
      actorKind: principal.kind,
      actorUserId: principal.kind === "admin" ? principal.userId : null,
    };
    const result = isMysqlDatabaseUrlConfigured()
      ? await createAdminUserInviteFromMysql(resolveMysqlPool(), input, actor)
      : await createAdminUserInvite(db, input, actor);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
