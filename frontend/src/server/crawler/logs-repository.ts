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

interface MysqlScraperHealthRow {
  source: string;
  lastStatus: string;
  lastRunAt: string;
  fetchedCount: number | string;
  insertedCount: number | string;
  updatedCount: number | string;
}

export interface MysqlCrawlerLogsReader {
  query: (sql: string) => Promise<[MysqlScraperHealthRow[]] | [MysqlScraperHealthRow[], unknown]>;
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

export async function listScraperHealthSourcesFromMysql(mysql: MysqlCrawlerLogsReader): Promise<ScraperHealthSource[]> {
  const [rows] = await mysql.query(`
    SELECT
      source,
      status AS lastStatus,
      COALESCE(finished_at, started_at) AS lastRunAt,
      fetched_count AS fetchedCount,
      inserted_count AS insertedCount,
      updated_count AS updatedCount
    FROM (
      SELECT
        crawler_logs.*,
        ROW_NUMBER() OVER (PARTITION BY source ORDER BY started_at DESC) AS source_rank
      FROM crawler_logs
    ) ranked_logs
    WHERE source_rank = 1
    ORDER BY source ASC
  `);

  return rows.map((row) => ({
    source: row.source,
    lastStatus: row.lastStatus,
    lastRunAt: row.lastRunAt,
    fetchedCount: Number(row.fetchedCount),
    insertedCount: Number(row.insertedCount),
    updatedCount: Number(row.updatedCount),
  }));
}
