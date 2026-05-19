import { asc, desc } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { crawlerLogs } from "@/server/db/schema";

export interface ScraperHealthSource {
  source: string;
  lastStatus: string;
  lastRunAt: string;
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
}

export async function listScraperHealthSources(db: AppDatabase): Promise<ScraperHealthSource[]> {
  const rows = db
    .select()
    .from(crawlerLogs)
    .orderBy(asc(crawlerLogs.source), desc(crawlerLogs.startedAt))
    .all();
  const latestBySource = new Map<string, ScraperHealthSource>();

  rows.forEach((row) => {
    if (latestBySource.has(row.source)) return;

    latestBySource.set(row.source, {
      source: row.source,
      lastStatus: row.status,
      lastRunAt: row.finishedAt ?? row.startedAt,
      fetchedCount: row.fetchedCount,
      insertedCount: row.insertedCount,
      updatedCount: row.updatedCount,
    });
  });

  return Array.from(latestBySource.values());
}
