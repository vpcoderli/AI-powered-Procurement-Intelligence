import { createDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { parseStateCrawlerLimit, runConfiguredCrawlerSourcesOnce } from "../src/server/crawler/configured-runner";

function owner() {
  return process.env.CRAWLER_OWNER ?? `crawler-once:${process.pid}`;
}

export async function runCrawlerOnce() {
  const db = createDatabase();
  runMigrations(db);

  try {
    return await runConfiguredCrawlerSourcesOnce({
      database: db,
      owner: owner(),
      stateRunnerOptions: { limit: parseStateCrawlerLimit() },
    });
  } finally {
    db.$client.close();
  }
}

async function main() {
  const results = await runCrawlerOnce();
  console.log(JSON.stringify(results, null, 2));

  if (results.some((result) => result.status === "failure")) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
