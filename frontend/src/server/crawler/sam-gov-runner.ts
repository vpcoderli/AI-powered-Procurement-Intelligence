import { execFile } from "node:child_process";
import path from "node:path";
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

function crawlerDirectory() {
  return path.resolve(process.cwd(), "..", "crawler");
}

function defaultDatabasePath() {
  return path.resolve(process.cwd(), "data", "apsi.sqlite");
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
): Promise<SamGovCrawlerRunResult> {
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
            source: "SAM.gov",
            status: error || importError ? "failure" : "success",
            stdout: String(stdout ?? ""),
            stderr: [String(stderr ?? ""), errorText].filter(Boolean).join("\n"),
          });
        })();
      },
    );
  });
}
