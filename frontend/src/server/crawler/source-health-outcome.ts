import type { AppDatabase } from "@/server/db/client";
import type { MysqlCrawlerLockStore } from "./lock-repository";
import type { CrawlerRunResult, RunCrawlerSourceOnceResult } from "./orchestrator";
import { classifyCrawlerFailure, type CrawlerFailureInput } from "./failure-classifier";
import { recordSourceFailure, recordSourceFailureInMysql, recordSourceSuccess, recordSourceSuccessInMysql } from "./source-health-repository";

export async function recordSourceHealthOutcome(
  options: { database: AppDatabase; mysql?: MysqlCrawlerLockStore },
  sourceId: string,
  result: RunCrawlerSourceOnceResult,
  at: string,
): Promise<void> {
  try {
    if (result.ok) {
      if (options.mysql) {
        await recordSourceSuccessInMysql(options.mysql, sourceId, at);
      } else {
        recordSourceSuccess(options.database, sourceId, at);
      }
      return;
    }

    if (result.status !== "failure") {
      // "locked" / "disabled" / "blocked" / "deferred": the crawler never ran against the portal,
      // so there is nothing this source's health can learn from the outcome. In particular a
      // C7 platform deferral is evidence about the platform's rate limiter, not about this
      // source — counting it would push an untouched source into failure backoff.
      return;
    }
    if (result.runner.errorCode === "CrawlerLeaseLostError") {
      // Lease loss is worker contention, not evidence about the portal; counting it would
      // push the source into failure backoff for a reason a retry cannot observe.
      return;
    }

    const kind = classifyCrawlerFailure(buildCrawlerFailureInput(result.runner));

    if (options.mysql) {
      await recordSourceFailureInMysql(options.mysql, { sourceId, at, kind });
    } else {
      recordSourceFailure(options.database, { sourceId, at, kind });
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "crawler_health_write_back_failed",
        source: sourceId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/** Include structured Python failures even when stderr is empty. */
export function buildCrawlerFailureInput(runner: CrawlerRunResult): CrawlerFailureInput {
  return {
    errorCode: runner.errorCode ?? null,
    errorMessage: [runner.payload?.errorMessage, runner.stderr].filter(Boolean).join("\n") || null,
    fetchedCount: runner.fetchedCount ?? null,
  };
}
