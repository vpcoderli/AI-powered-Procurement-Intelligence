import { NextResponse } from "next/server";
import { db, type AppDatabase } from "@/server/db/client";
import { listScraperHealthSources } from "@/server/crawler/logs-repository";

function internalError(error: unknown) {
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

export function createScraperHealthGet(database: AppDatabase = db) {
  return async function GET() {
    try {
      const sources = await listScraperHealthSources(database);
      return NextResponse.json({ sources });
    } catch (error) {
      return internalError(error);
    }
  };
}

export const GET = createScraperHealthGet();
