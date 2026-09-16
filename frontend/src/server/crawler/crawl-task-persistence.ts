import type { AppDatabase } from "@/server/db/client";
import type { MysqlCrawlerLockStore } from "./lock-repository";
import { importCrawlerJsonRunIntoMysql } from "./mysql-json-importer";
import { importCrawlerJsonRunIntoSqlite, stampJurisdiction } from "./sqlite-json-importer";
import type { CrawlableSource } from "./source-registry";
import type { CrawlTaskResult } from "./state-runner";
import type { CrawlerLeaseFence } from "./execution-context";

import { persistenceFailurePayload } from "./persistence-errors";

/** Persist the full source result before callers can announce success or run notifications. */
export async function persistCrawlTaskResult(
  database: AppDatabase,
  mysql: MysqlCrawlerLockStore | undefined,
  source: CrawlableSource,
  result: CrawlTaskResult,
  lease?: CrawlerLeaseFence,
): Promise<CrawlTaskResult> {
  if (result.payload) {
    try {
      const stamped = stampJurisdiction(result.payload, source);
      if (mysql) {
        await importCrawlerJsonRunIntoMysql(mysql, stamped, lease);
      } else {
        importCrawlerJsonRunIntoSqlite(database, stamped, lease);
      }
    } catch (error) {
      const failurePayload = persistenceFailurePayload(result.payload, error);
      if (!(error instanceof Error && "failureLogged" in error && error.failureLogged)) {
        try {
          if (mysql) await importCrawlerJsonRunIntoMysql(mysql, failurePayload);
          else importCrawlerJsonRunIntoSqlite(database, failurePayload);
        } catch { /* Return the failure even when the database cannot retain a log. */ }
      }
      console.error(
        JSON.stringify({
          event: "crawler_json_import_failed",
          source: source.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return {
        ...result,
        ok: false,
        status: "failure",
        fetchedCount: 0,
        errorCode: failurePayload.errorCode ?? "CrawlerPersistenceError",
        payload: failurePayload,
        stderr: [result.stderr, failurePayload.errorMessage].filter(Boolean).join("\n"),
      };
    }
  }

  return result;
}
