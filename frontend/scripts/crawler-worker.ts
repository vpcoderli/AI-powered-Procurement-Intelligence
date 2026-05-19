import { createDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { runCrawlerSourceOnce } from "../src/server/crawler/orchestrator";
import { runSamGovCrawler } from "../src/server/crawler/sam-gov-runner";
import { sendMatchedAlertNotifications } from "../src/server/notifications/service";
import { matchEnabledSearchAlerts } from "../src/server/search-alerts/matcher";

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
      const result = await runCrawlerSourceOnce(db, {
        source: "SAM.gov",
        owner: owner(),
        runner: runSamGovCrawler,
        matcher: () => matchEnabledSearchAlerts(db),
        notifier: ({ alertMatching }) => sendMatchedAlertNotifications(db, alertMatching),
      });
      console.log(JSON.stringify(result, null, 2));

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
