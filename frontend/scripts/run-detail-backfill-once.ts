import { createDatabase } from "../src/server/db/client";
import { closeResolvedMysqlPool, isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "../src/server/db/mysql";
import { runMigrations } from "../src/server/db/migrate";
import { runConfiguredCrawlerSourcesOnce } from "../src/server/crawler/configured-runner";

/**
 * One controlled sweep of persisted missing bodies, including bids outside the current
 * listing/date window. Each source keeps its governance gate, renewable lease, platform
 * allowance, detail interval, budget, and durable retry cooldown.
 *
 * Usage: npx tsx scripts/run-detail-backfill-once.ts [canonical_source_id ...]
 * With no IDs, retry every enabled, governed source with a missing body.
 */
async function main() {
  const database = createDatabase();
  runMigrations(database);
  const sourceIds = process.argv.slice(2);
  try {
    const results = await runConfiguredCrawlerSourcesOnce({
      database,
      mysql: isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : undefined,
      owner: process.env.CRAWLER_OWNER ?? `detail-backfill-once:${process.pid}`,
      detailBackfillOnly: true,
      ...(sourceIds.length ? { sourceIds } : {}),
      // A body-only retry has no new listing facts to match or notify customers about.
      matcher: async () => ({ evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0, matches: [] }),
      notifier: async () => ({ queued: 0, sent: 0, skipped: 0, failed: 0 }),
    });
    console.log(JSON.stringify(results, null, 2));
    if (results.some((result) => result.status === "failure")) process.exitCode = 1;
  } finally {
    await closeResolvedMysqlPool();
    database.$client.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
