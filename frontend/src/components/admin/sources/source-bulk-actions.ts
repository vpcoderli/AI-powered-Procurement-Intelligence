import type { StateCrawlerRunResponse } from "@/lib/api/admin";
import { crawlerRunIdFor, type CrawlerRunSource } from "./crawler-run-id";

/** Spec §5.2 limits. */
export const PRECHECK_REQUEST_CHUNK = 500;
export const RUN_NOW_LIMIT = 20;

export function runTargets(items: readonly CrawlerRunSource[]): { runIds: string[]; skippedIds: string[] } {
  const runIds: string[] = [];
  const skippedIds: string[] = [];
  for (const item of items) {
    const runId = crawlerRunIdFor(item);
    if (runId) runIds.push(runId);
    else skippedIds.push(item.id);
  }
  return { runIds: Array.from(new Set(runIds)), skippedIds };
}

/** success → ok; failure and unknown ids → failed; blocked/locked/disabled/deferred → skipped. */
export function summarizeRunResults(response: StateCrawlerRunResponse): { ok: number; failed: number; skipped: number } {
  let ok = 0;
  let failed = response.errors?.length ?? 0;
  let skipped = 0;
  for (const result of response.results) {
    if (result.status === "success") ok += 1;
    else if (result.status === "failure") failed += 1;
    else skipped += 1;
  }
  return { ok, failed, skipped };
}
