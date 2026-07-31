import type { AppDatabase } from "@/server/db/client";
import type { MysqlCrawlerLockStore } from "./lock-repository";
import { importCrawlerJsonRunIntoMysql } from "./mysql-json-importer";
import { importCrawlerJsonRunIntoSqlite, stampJurisdiction } from "./sqlite-json-importer";
import type { CrawlableSource } from "./source-registry";
import type { CrawlTaskResult } from "./state-runner";

/**
 * Stamps jurisdiction onto a `runCrawlTask` result's payload (if any) and persists it through
 * the dialect-appropriate JSON importer (SQLite via `importCrawlerJsonRunIntoSqlite`, MySQL via
 * `importCrawlerJsonRunIntoMysql`) — for both success and failure payloads, since a failure
 * payload still needs its `crawler_logs` row.
 *
 * `runCrawlTask` itself only spawns the Python subprocess and parses its stdout into a
 * `CrawlTaskResult`; nothing about the JSON task contract writes that to the database on its
 * own. Task X5 (commit f83ca11) added this wiring for the scheduled path
 * (configured-runner.ts's `runStateSourceAndImport`), but only inline/unexported there. Task X7
 * found the manual admin-trigger route (`api/crawler/state/run/route.ts`) called `runCrawlTask`
 * directly and had the identical persistence gap, so this step was pulled out into its own
 * module — rather than either the scheduled-only `configured-runner.ts` (which also carries
 * unrelated cadence/health-write-back/SAM.gov concerns) or either single-dialect importer file
 * (each of which is deliberately dialect-pure) — so both entry points share one implementation
 * instead of duplicating it.
 *
 * The persistence step is contained end to end — `stampJurisdiction` and the import call are
 * both inside the same try/catch, not just the import: a thrown/rejected error from either is
 * caught and logged (`crawler_json_import_failed`) rather than thrown, so one source's
 * persistence bug can't stop a batch loop from continuing to the next source. This matters
 * because neither loop that calls this function (configured-runner.ts's dispatch loop, or the
 * manual route's) wraps its own call in a try/catch, and orchestrator.ts's `runCrawlerSourceOnce`
 * only has a try/finally (releases the lock, then re-throws) — so an uncaught throw here would
 * abort the *entire* batch, not just the offending source. Today `stampJurisdiction` can only
 * throw if `payload.bids` is present but not an array (Python's `_json_run_payload` always
 * emits a real array, so this is normally unreachable, but the TS side only validates a
 * `status` field on the parsed payload before casting the rest — the array guarantee rests
 * entirely on the Python contract, not on anything checked here). The `CrawlTaskResult` passed
 * in is always returned unchanged either way — a persistence failure never turns a fetch success
 * into a reported failure, it only means that particular run's bids/log didn't make it to the
 * database this time.
 */
export async function persistCrawlTaskResult(
  database: AppDatabase,
  mysql: MysqlCrawlerLockStore | undefined,
  source: CrawlableSource,
  result: CrawlTaskResult,
): Promise<CrawlTaskResult> {
  if (result.payload) {
    try {
      const stamped = stampJurisdiction(result.payload, source);
      if (mysql) {
        await importCrawlerJsonRunIntoMysql(mysql, stamped);
      } else {
        importCrawlerJsonRunIntoSqlite(database, stamped);
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "crawler_json_import_failed",
          source: source.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  return result;
}
