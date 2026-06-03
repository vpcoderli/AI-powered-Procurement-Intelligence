import { execFile } from "node:child_process";
import path from "node:path";
import { STATE_CRAWLER_SOURCES, type StateCrawlerSourceId } from "@/lib/state-crawler-sources";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { importCrawlerJsonRunIntoMysql, type CrawlerJsonRunPayload } from "./mysql-json-importer";
import { prepareMysqlCrawlerRun } from "./mysql-runner";

export { STATE_CRAWLER_SOURCES, type StateCrawlerSourceId };

export interface StateCrawlerRunOptions {
  source: StateCrawlerSourceId;
  query?: string;
  limit?: number;
  databasePath?: string;
  allowFixtureFallback?: boolean;
  archiveDocuments?: boolean;
  archiveDir?: string;
  archiveDetailPages?: boolean;
  outputJson?: boolean;
}

export interface StateCrawlerOrchestratorOptions {
  query?: string;
  limit?: number;
  databasePath?: string;
  allowFixtureFallback?: boolean;
  archiveDocuments?: boolean;
  archiveDir?: string;
  archiveDetailPages?: boolean;
}

export interface StateCrawlerRunResult {
  ok: boolean;
  source: StateCrawlerSourceId;
  status: "success" | "failure";
  stdout: string;
  stderr: string;
}

function crawlerDirectory() {
  return path.resolve(process.cwd(), "..", "crawler");
}

function defaultDatabasePath() {
  return path.resolve(process.cwd(), "data", "apsi.sqlite");
}

function defaultArchiveDir() {
  return process.env.CRAWLER_ATTACHMENT_DIR ?? path.resolve(process.cwd(), "data", "attachments");
}

function buildArgs(options: StateCrawlerRunOptions) {
  const args = [
    "-m",
    "apsi_crawler.cli",
    "fetch-state",
  ];

  if (options.outputJson) {
    args.push("--output-json");
  } else {
    args.push("--database", options.databasePath ?? defaultDatabasePath());
  }

  args.push(
    "--source",
    options.source,
    "--limit",
    String(options.limit ?? 25),
  );

  if (options.query) {
    args.push("--query", options.query);
  }

  if (options.allowFixtureFallback) {
    args.push("--fallback-fixture");
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

export async function runStateCrawler(options: StateCrawlerRunOptions): Promise<StateCrawlerRunResult> {
  const useDirectMysqlImport = !options.databasePath && isMysqlDatabaseUrlConfigured();
  const mysqlRun = useDirectMysqlImport ? null : prepareMysqlCrawlerRun(options.databasePath);
  const databasePath = mysqlRun?.databasePath;

  return new Promise((resolve) => {
    execFile(
      "python3",
      buildArgs(useDirectMysqlImport ? { ...options, outputJson: true } : { ...options, databasePath }),
      {
        cwd: crawlerDirectory(),
        env: process.env,
      },
      (error, stdout, stderr) => {
        void (async () => {
          let importError: unknown = null;
          try {
            if (useDirectMysqlImport) {
              await importCrawlerJsonRunIntoMysql(resolveMysqlPool(), parseCrawlerJsonPayload(String(stdout ?? "")));
            } else if (mysqlRun?.isMysqlImport) {
              await mysqlRun.importIntoMysql();
            }
          } catch (caught) {
            importError = caught;
          } finally {
            mysqlRun?.cleanup();
          }

          const errorText = importError instanceof Error ? importError.message : String(importError ?? "");
          resolve({
            ok: !error && !importError,
            source: options.source,
            status: error || importError ? "failure" : "success",
            stdout: String(stdout ?? ""),
            stderr: [String(stderr ?? ""), errorText].filter(Boolean).join("\n"),
          });
        })();
      },
    );
  });
}

export function createStateCrawlerRunner(source: StateCrawlerSourceId) {
  return (options: StateCrawlerOrchestratorOptions = {}) =>
    runStateCrawler({
      source,
      query: options.query,
      limit: options.limit,
      databasePath: options.databasePath,
      allowFixtureFallback: options.allowFixtureFallback,
      archiveDocuments: options.archiveDocuments,
      archiveDir: options.archiveDir,
      archiveDetailPages: options.archiveDetailPages,
    });
}
