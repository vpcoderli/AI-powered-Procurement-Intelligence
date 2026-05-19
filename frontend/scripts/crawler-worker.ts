import { createDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { parseStateCrawlerLimit, runConfiguredCrawlerSourcesOnce } from "../src/server/crawler/configured-runner";

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

function intervalMs() {
  const value = Number(process.env.CRAWLER_WORKER_INTERVAL_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_INTERVAL_MS;
}

function owner() {
  return process.env.CRAWLER_OWNER ?? `crawler-worker:${process.pid}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const db = createDatabase();
  runMigrations(db);

  let stopping = false;
  const stop = () => {
    stopping = true;
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    while (!stopping) {
      const results = await runConfiguredCrawlerSourcesOnce({
        database: db,
        owner: owner(),
        stateRunnerOptions: { limit: parseStateCrawlerLimit() },
      });
      console.log(JSON.stringify(results, null, 2));

      if (!stopping) {
        await sleep(intervalMs());
      }
    }
  } finally {
    db.$client.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
