import { createDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { runCrawlerSourceOnce } from "../src/server/crawler/orchestrator";
import { runSamGovCrawler } from "../src/server/crawler/sam-gov-runner";
import { sendMatchedAlertNotifications } from "../src/server/notifications/service";
import { matchEnabledSearchAlerts } from "../src/server/search-alerts/matcher";

function owner() {
  return process.env.CRAWLER_OWNER ?? `crawler-once:${process.pid}`;
}

export async function runSamGovCrawlerOnce() {
  const db = createDatabase();
  runMigrations(db);

  try {
    return await runCrawlerSourceOnce(db, {
      source: "SAM.gov",
      owner: owner(),
      runner: runSamGovCrawler,
      matcher: () => matchEnabledSearchAlerts(db),
      notifier: ({ alertMatching }) => sendMatchedAlertNotifications(db, alertMatching),
    });
  } finally {
    db.$client.close();
  }
}

async function main() {
  const result = await runSamGovCrawlerOnce();
  console.log(JSON.stringify(result, null, 2));

  if (result.status === "failure") {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
