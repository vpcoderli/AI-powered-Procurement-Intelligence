import { NextResponse } from "next/server";
import { AdminAuthError, requireAdmin } from "@/server/admin/auth";
import {
  AdminUserNotFoundError,
  updateAdminUser,
  type UpdateAdminUserInput,
} from "@/server/admin/users-repository";
import { isAccountTier, isUserRole } from "@/server/auth/entitlements";
import { db } from "@/server/db/client";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function parseUpdate(body: unknown): UpdateAdminUserInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const source = body as Record<string, unknown>;
  const input: UpdateAdminUserInput = {};

  if ("role" in source) {
    if (!isUserRole(source.role)) return null;
    input.role = source.role;
  }

  if ("tier" in source) {
    if (!isAccountTier(source.tier)) return null;
    input.tier = source.tier;
  }

  if ("isDisabled" in source) {
    if (typeof source.isDisabled !== "boolean") return null;
    input.isDisabled = source.isDisabled;
  }

  return input;
}

function routeError(error: unknown) {
  if (error instanceof AdminAuthError) {
    return errorResponse(error.code, error.message, error.status);
  }

  if (error instanceof AdminUserNotFoundError) {
    return errorResponse("USER_NOT_FOUND", error.message, 404);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
}

export async function PATCH(request: Request, context: RouteContext) {
  const body = await request.json().catch(() => null);
  const input = parseUpdate(body);

  if (!input) {
    return errorResponse("INVALID_REQUEST", "Supported user fields are required.", 400);
  }

  try {
    const principal = await requireAdmin(db, request);
    const { id } = await context.params;
    const user = updateAdminUser(db, id, input, {
      actorKind: principal.kind,
      actorUserId: principal.kind === "admin" ? principal.userId : null,
    });

    return NextResponse.json({ user });
  } catch (error) {
    return routeError(error);
  }
}
