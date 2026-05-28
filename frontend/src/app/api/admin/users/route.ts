import { NextResponse } from "next/server";
import { AdminAuthError, requireAdmin } from "@/server/admin/auth";
import { listAdminUsers } from "@/server/admin/users-repository";
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

export async function GET(request: Request) {
  try {
    await requireAdmin(db, request);
    return NextResponse.json(listAdminUsers(db));
  } catch (error) {
    return routeError(error);
  }
}
