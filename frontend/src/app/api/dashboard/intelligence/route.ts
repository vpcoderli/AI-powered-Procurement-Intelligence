import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/server/auth/principal";
import { authRequiredResponse, isAuthenticatedPrincipal } from "@/server/auth/route-guards";
import { db, type AppDatabase } from "@/server/db/client";
import {
  createProcurementIntelligenceSummary,
} from "@/server/intelligence/service";
import type { ProcurementIntelligenceSummary } from "@/server/intelligence/types";

interface DashboardIntelligenceRouteDependencies {
  database?: AppDatabase | unknown;
  createSummary?: (
    database: AppDatabase | unknown,
    userId: string,
    now: Date,
  ) => Promise<ProcurementIntelligenceSummary>;
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

export function createDashboardIntelligenceGet(dependencies: DashboardIntelligenceRouteDependencies = {}) {
  return async function GET(request: Request) {
    const database = dependencies.database ?? db;

    try {
      const principal = await resolvePrincipal(database as AppDatabase, request);

      if (!isAuthenticatedPrincipal(principal)) {
        return authRequiredResponse();
      }

      const createSummary = dependencies.createSummary ?? createProcurementIntelligenceSummary;
      const intelligence = await createSummary(
        database as AppDatabase,
        principal.userId,
        dependencies.now?.() ?? new Date(),
      );

      return NextResponse.json({ intelligence });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const GET = createDashboardIntelligenceGet();
