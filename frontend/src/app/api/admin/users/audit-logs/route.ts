import { NextResponse } from "next/server";
import { AdminAuthError, requireAdmin } from "@/server/admin/auth";
import { listAdminUserAuditLogs } from "@/server/admin/users-repository";
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

export async function GET(request: Request) {
  const limit = parseLimit(request);

  if (limit === null) {
    return errorResponse("INVALID_REQUEST", "Limit must be a positive integer.", 400);
  }

  try {
    await requireAdmin(db, request);
    return NextResponse.json(listAdminUserAuditLogs(db, { limit }));
  } catch (error) {
    return routeError(error);
  }
}
