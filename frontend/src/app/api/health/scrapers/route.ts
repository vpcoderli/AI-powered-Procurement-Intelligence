import { NextResponse } from "next/server";
import { db, type AppDatabase } from "@/server/db/client";
import {
  listScraperHealthSources,
  listScraperHealthSourcesFromMysql,
  type MysqlCrawlerLogsReader,
} from "@/server/crawler/logs-repository";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";

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

interface ScraperHealthDependencies {
  database?: AppDatabase;
  mysql?: MysqlCrawlerLogsReader;
}

async function resolveScraperHealthDependencies(dependencies?: ScraperHealthDependencies | AppDatabase) {
  if (dependencies && "select" in dependencies) {
    return { database: dependencies };
  }

  if (dependencies?.mysql) {
    return { mysql: dependencies.mysql };
  }

  if (dependencies?.database) {
    return { database: dependencies.database };
  }

  if (isMysqlDatabaseUrlConfigured()) {
    return { mysql: resolveMysqlPool() };
  }

  return { database: db };
}

export function createScraperHealthGet(dependencies?: ScraperHealthDependencies | AppDatabase) {
  return async function GET() {
    try {
      const resolved = await resolveScraperHealthDependencies(dependencies);
      const sources = resolved.mysql
        ? await listScraperHealthSourcesFromMysql(resolved.mysql)
        : await listScraperHealthSources(resolved.database);
      return NextResponse.json({ sources });
    } catch (error) {
      return internalError(error);
    }
  };
}

export const GET = createScraperHealthGet();
