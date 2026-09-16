import { execFile } from "node:child_process";
import path from "node:path";
import { CrawlerLeaseLostError, crawlerRuntime, type CrawlerExecutionContext } from "./execution-context";
import { createDatabase } from "@/server/db/client";
import { importCrawlerJsonRunIntoSqlite } from "./sqlite-json-importer";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { importCrawlerJsonRunIntoMysql, type CrawlerJsonRunPayload } from "./mysql-json-importer";
import { prepareMysqlCrawlerRun } from "./mysql-runner";

export interface SamGovCrawlerRunOptions {
  postedFrom?: string;
  postedTo?: string;
  limit?: number;
  maxRecords?: number;
  databasePath?: string;
  archiveDocuments?: boolean;
  archiveDir?: string;
  archiveDetailPages?: boolean;
  outputJson?: boolean;
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

  if (options.outputJson) {
    args.push("--output-json");
  } else {
    args.push("--database", options.databasePath ?? defaultDatabasePath());
  }

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

  if (options.archiveDocuments !== false) {
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
  const useDirectMysqlImport = !options.databasePath && isMysqlDatabaseUrlConfigured();
  const useManagedSqliteImport = Boolean(context) && !useDirectMysqlImport && !options.outputJson;
  const mysqlRun = useDirectMysqlImport ? null : prepareMysqlCrawlerRun(options.databasePath);
  const databasePath = mysqlRun?.databasePath;

  return new Promise((resolve) => {
    execFile(
      python,
      buildArgs(useDirectMysqlImport || useManagedSqliteImport
        ? { ...options, outputJson: true }
        : { ...options, databasePath }),
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
            if (cancelled || timedOut) {
              // Never import successful-looking stdout from a cancelled/killed subprocess.
            } else if (useDirectMysqlImport || useManagedSqliteImport) {
              payload = parseCrawlerJsonPayload(String(stdout ?? ""));
              if (!error || payload.status === "failure") {
                await context?.assertLease();
                if (useDirectMysqlImport) {
                  await importCrawlerJsonRunIntoMysql(resolveMysqlPool(), payload, context?.lease);
                } else {
                  // Managed children never receive the live SQLite path. Persistence starts
                  // in the parent only after confirming the renewable lease is still ours.
                  const database = createDatabase(databasePath ?? defaultDatabasePath());
                  try {
                    importCrawlerJsonRunIntoSqlite(database, payload, context?.lease);
                  } finally {
                    database.$client.close();
                  }
                }
              }
            } else if (!error && mysqlRun?.isMysqlImport) {
              await context?.assertLease();
              await mysqlRun.importIntoMysql();
            }
          } catch (caught) {
            importError = caught;
          } finally {
            mysqlRun?.cleanup();
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
  });
}
