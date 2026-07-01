import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/server/auth/principal";
import { authRequiredResponse, isAuthenticatedPrincipal } from "@/server/auth/route-guards";
import { db, type AppDatabase } from "@/server/db/client";
import { createDashboardSummary, type DashboardSummary, type DashboardSummarySubject } from "@/server/dashboard/summary";

interface DashboardSummaryRouteDependencies {
  database?: AppDatabase | unknown;
  createSummary?: (
    database: AppDatabase | unknown,
    subject: DashboardSummarySubject,
    now: Date,
  ) => Promise<DashboardSummary>;
  now?: () => Date;
}

function errorResponse(error: unknown) {
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Internal server error",
      },
    },
    { status: 500 },
  );
}

export function createDashboardSummaryGet(dependencies: DashboardSummaryRouteDependencies = {}) {
  return async function GET(request: Request) {
    const database = dependencies.database ?? db;

    try {
      const principal = await resolvePrincipal(database as AppDatabase, request);

      if (!isAuthenticatedPrincipal(principal)) {
        return authRequiredResponse();
      }

      const createSummary = dependencies.createSummary ?? createDashboardSummary;
      const summary = await createSummary(
        database,
        {
          userId: principal.userId,
          role: principal.role,
          tier: principal.tier,
        },
        dependencies.now?.() ?? new Date(),
      );
      const response = NextResponse.json({ summary });

      return response;
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const GET = createDashboardSummaryGet();
