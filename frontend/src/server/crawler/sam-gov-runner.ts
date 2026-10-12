import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { CrawlerLeaseLostError, crawlerRuntime, type CrawlerExecutionContext } from "./execution-context";
import { createDatabase } from "@/server/db/client";
import { importCrawlerJsonRunIntoSqlite } from "./sqlite-json-importer";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { importCrawlerJsonRunIntoMysql, type CrawlerJsonRunPayload } from "./mysql-json-importer";
import { fenceDetailBackfillPayload, loadDetailBackfillCandidates, loadDetailHistory, type DetailHistoryRecord, type DetailHistoryStore } from "./detail-history";

/** fetch-sam-gov's own `--max-descriptions` default. */
const SAM_DEFAULT_MAX_DESCRIPTIONS = 25;

export interface SamGovCrawlerRunOptions {
  postedFrom?: string;
  postedTo?: string;
  limit?: number;
  maxRecords?: number;
  maxDescriptions?: number;
  databasePath?: string;
  archiveDocuments?: boolean;
  archiveDir?: string;
  archiveDetailPages?: boolean;
  outputJson?: boolean;
  detailHistory?: DetailHistoryRecord[];
  historyStore?: DetailHistoryStore;
  detailBackfillOnly?: boolean;
}

export interface SamGovCrawlerRunResult {
  ok: boolean;
  source: "SAM.gov";
  status: "success" | "failure";
  stdout: string;
  stderr: string;
  errorCode?: string | null;
  payload?: CrawlerJsonRunPayload | null;
}

function samGovDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}/${date.getFullYear()}`;
}

function defaultPostedFrom() {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return samGovDate(date);
}

function defaultPostedTo() {
  return samGovDate(new Date());
}

function defaultDatabasePath() {
  // Same resolution rule as the worker scripts and db/client.ts: DATABASE_PATH relative to cwd.
  return path.resolve(process.cwd(), process.env.DATABASE_PATH?.trim() || path.join("data", "apsi.sqlite"));
}

function defaultArchiveDir() {
  return process.env.CRAWLER_ATTACHMENT_DIR ?? path.resolve(process.cwd(), "data", "attachments");
}

function buildArgs(options: SamGovCrawlerRunOptions) {
  const args = [
    "-m",
    "apsi_crawler.cli",
    "fetch-sam-gov",
  ];

  // All persistence happens through the parent's shared admission/merge gate.
  args.push("--output-json");

  args.push(
    "--posted-from",
    options.postedFrom ?? defaultPostedFrom(),
    "--posted-to",
    options.postedTo ?? defaultPostedTo(),
    "--limit",
    String(options.limit ?? 100),
  );

  if (options.maxRecords !== undefined) {
    args.push("--max-records", String(options.maxRecords));
  }
  if (options.detailHistory) args.push("--detail-history-stdin");
  if (options.detailBackfillOnly) args.push("--detail-backfill-only");
  if (options.maxDescriptions !== undefined) {
    args.push("--max-descriptions", String(options.maxDescriptions));
  }

  // Inline archiving would download every resourceLink of every bid in the window, one after
  // another, inside the run's time budget. Managed runs record the links; the attachment-repair
  // worker archives them under the source's own limits. Only an explicit caller archives here.
  if (options.archiveDocuments === true) {
    args.push("--archive-documents", "--archive-dir", options.archiveDir ?? defaultArchiveDir());
  }

  if (options.archiveDetailPages) {
    args.push("--archive-detail-pages");
  }

  return args;
}

function parseCrawlerJsonPayload(stdout: string): CrawlerJsonRunPayload {
  try {
    return JSON.parse(stdout) as CrawlerJsonRunPayload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse crawler JSON output: ${message}`);
  }
}

export async function runSamGovCrawler(
  options: SamGovCrawlerRunOptions = {},
  context?: CrawlerExecutionContext,
): Promise<SamGovCrawlerRunResult> {
  const { python, ...runtime } = crawlerRuntime();
  const useMysqlImport = !options.databasePath && isMysqlDatabaseUrlConfigured();
  const databasePath = options.databasePath ?? defaultDatabasePath();
  // List runs reuse recent history; backfill runs read only their attempt budget of candidates.
  const loadHistory = (store: DetailHistoryStore) => options.detailBackfillOnly
    ? loadDetailBackfillCandidates(store, "sam_gov", undefined, { limit: options.maxDescriptions ?? SAM_DEFAULT_MAX_DESCRIPTIONS })
    : loadDetailHistory(store, "sam_gov");
  let detailHistory = options.detailHistory;
  if (!detailHistory && options.historyStore) {
    detailHistory = await loadHistory(options.historyStore);
  } else if (!detailHistory && !options.outputJson) {
    if (useMysqlImport) {
      detailHistory = await loadHistory({ mysql: resolveMysqlPool() });
    } else if (existsSync(databasePath)) {
      const database = createDatabase(databasePath);
      try {
        detailHistory = await loadHistory({ database });
      } finally {
        database.$client.close();
      }
    }
  }
  options = { ...options, detailHistory };

  return new Promise((resolve) => {
    const child = execFile(
      python,
      buildArgs(options),
      {
        ...runtime,
        env: process.env,
        signal: context?.signal,
      },
      (error, stdout, stderr) => {
        void (async () => {
          let importError: unknown = null;
          const cancelled = context?.signal.aborted === true;
          const timedOut = !cancelled && error?.killed === true && error.signal === "SIGKILL";
          let payload: CrawlerJsonRunPayload | null = null;
          try {
            if (!cancelled && !timedOut && (String(stdout ?? "").trim() || !error)) {
              payload = parseCrawlerJsonPayload(String(stdout ?? ""));
              if (options.detailBackfillOnly) payload = fenceDetailBackfillPayload(payload);
              if (!options.outputJson && (!error || payload.status === "failure")) {
                await context?.assertLease();
                if (useMysqlImport) {
                  await importCrawlerJsonRunIntoMysql(resolveMysqlPool(), payload, context?.lease);
                } else {
                  const database = createDatabase(databasePath);
                  try {
                    importCrawlerJsonRunIntoSqlite(database, payload, context?.lease);
                  } finally {
                    database.$client.close();
                  }
                }
              }
            }
          } catch (caught) {
            importError = caught;
          }

          const lostLease = cancelled || context?.signal.aborted === true || importError instanceof CrawlerLeaseLostError;
          const errorCode = lostLease ? "CrawlerLeaseLostError" : timedOut ? "CrawlerTaskTimeoutError" : importError ? "CrawlerPersistenceError" : payload?.errorCode ?? (error ? String(error.code ?? error.name) : null);
          const failed = Boolean(error || importError || lostLease || payload?.status === "failure");
          const errorText = importError instanceof Error ? importError.message : String(importError ?? "");
          resolve({
            ok: !failed,
            source: "SAM.gov",
            status: failed ? "failure" : "success",
            stdout: String(stdout ?? ""),
            stderr: [String(stderr ?? ""), errorText, lostLease ? "Crawler source lease was lost" : timedOut ? `Crawler task timed out after ${runtime.timeout}ms` : null].filter(Boolean).join("\n"),
            ...(errorCode ? { errorCode } : {}),
            ...(payload ? { payload } : {}),
          });
        })();
      },
    );
    if (detailHistory) child.stdin?.end(JSON.stringify(detailHistory));
  });
}
