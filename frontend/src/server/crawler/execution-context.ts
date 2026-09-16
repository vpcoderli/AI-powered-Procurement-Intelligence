import path from "node:path";

/** Checked on the import transaction's own connection before writes and before commit. */
export interface CrawlerLeaseFence {
  readonly source: string;
  readonly owner: string;
  readonly now: () => string;
  readonly signal?: AbortSignal;
}

export interface CrawlerExecutionContext {
  signal: AbortSignal;
  /** Refresh and verify ownership immediately before starting persistence. */
  assertLease: () => Promise<void>;
  lease?: CrawlerLeaseFence;
}

export class CrawlerLeaseLostError extends Error {
  constructor() {
    super("Crawler source lease was lost; ingestion was cancelled.");
    this.name = "CrawlerLeaseLostError";
  }
}

/** Whole-process budget, including listing, enrichment and any archival work. */
export function crawlerRuntime() {
  const configured = process.env.CRAWLER_TASK_TIMEOUT_MS?.trim();
  const timeout = configured ? Number(configured) : 30 * 60 * 1000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2_147_483_647) {
    throw new Error("CRAWLER_TASK_TIMEOUT_MS must be a positive integer no greater than 2147483647");
  }
  return {
    python: process.env.CRAWLER_PYTHON_BIN?.trim() || "python3",
    cwd: path.resolve(process.env.CRAWLER_DIRECTORY?.trim() || path.resolve(process.cwd(), "..", "crawler")),
    timeout,
    killSignal: "SIGKILL" as const,
    maxBuffer: 64 * 1024 * 1024,
  };
}
