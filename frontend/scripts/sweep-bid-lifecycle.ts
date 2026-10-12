import { createDatabase } from "../src/server/db/client";
import { closeResolvedMysqlPool, isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "../src/server/db/mysql";
import { runMigrations } from "../src/server/db/migrate";
import { sweepExpiredBids, type LifecycleSweepResult } from "../src/server/bids/lifecycle-sweep";

/**
 * One pass of the deadline sweep: closes every open bid whose deadline has passed. The crawler worker runs
 * the same sweep on every tick; this is the one-shot for a first catch-up, for a source nobody is crawling,
 * and (with --dry-run) for seeing what a sweep would close before it does.
 *
 * Usage: npx tsx scripts/sweep-bid-lifecycle.ts [--dry-run] [--json]
 *   --dry-run  count what would be closed and write nothing
 *   --json     print the result as JSON instead of a summary
 *
 * Works on whichever database DATABASE_URL selects: MySQL when it is a mysql:// URL, else the SQLite file
 * (DATABASE_PATH, default data/apsi.sqlite). Exits 0 when the sweep ran, 1 when it failed.
 */

const USAGE = "Usage: sweep-bid-lifecycle.ts [--dry-run] [--json]";

function parseArgs(argv: string[]) {
  const unknown = argv.filter((argument) => argument !== "--dry-run" && argument !== "--json");
  // A mistyped flag must not turn a dry run into a real sweep.
  if (unknown.length > 0) throw new Error(`Unknown option ${unknown.join(", ")}. ${USAGE}`);
  return { dryRun: argv.includes("--dry-run"), json: argv.includes("--json") };
}

function summary(result: LifecycleSweepResult) {
  const byIssuerType = Object.entries(result.closedByIssuerType).sort(([leftType, left], [rightType, right]) => right - left || leftType.localeCompare(rightType));
  return [
    result.dryRun ? "Bid lifecycle sweep (dry run: nothing was written)" : "Bid lifecycle sweep",
    `scanned: ${result.scanned}`,
    `closed: ${result.closed}${result.dryRun ? " (would be closed)" : ""}`,
    `unparseable: ${result.unparseable}`,
    ...(byIssuerType.length > 0 ? ["closed by issuer type:", ...byIssuerType.map(([issuerType, count]) => `  ${issuerType}: ${count}`)] : []),
  ].join("\n");
}

async function main() {
  const { dryRun, json } = parseArgs(process.argv.slice(2));
  // MySQL mode needs no SQLite file; opening the default one would only leave a stray database behind.
  const database = isMysqlDatabaseUrlConfigured() ? undefined : createDatabase(process.env.DATABASE_PATH?.trim() || undefined);
  try {
    if (database) runMigrations(database);
    const result = await sweepExpiredBids(database ? { database } : { mysql: resolveMysqlPool() }, { now: new Date(), dryRun });
    console.log(json ? JSON.stringify(result, null, 2) : summary(result));
  } finally {
    await closeResolvedMysqlPool();
    database?.$client.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
