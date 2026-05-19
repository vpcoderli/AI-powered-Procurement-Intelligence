import { execFile } from "node:child_process";
import path from "node:path";

export const STATE_CRAWLER_SOURCES = [
  { id: "ca_caleprocure", label: "California Cal eProcure" },
  { id: "tx_esbd", label: "Texas ESBD" },
  { id: "ny_contract_reporter", label: "New York State Contract Reporter" },
  { id: "fl_mfmp", label: "MyFloridaMarketPlace" },
  { id: "il_bidbuy", label: "Illinois BidBuy" },
] as const;

export type StateCrawlerSourceId = (typeof STATE_CRAWLER_SOURCES)[number]["id"];

export interface StateCrawlerRunOptions {
  source: StateCrawlerSourceId;
  query?: string;
  limit?: number;
  databasePath?: string;
  allowFixtureFallback?: boolean;
}

export interface StateCrawlerOrchestratorOptions {
  query?: string;
  limit?: number;
  databasePath?: string;
  allowFixtureFallback?: boolean;
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

function buildArgs(options: StateCrawlerRunOptions) {
  const args = [
    "-m",
    "apsi_crawler.cli",
    "fetch-state",
    "--database",
    options.databasePath ?? defaultDatabasePath(),
    "--source",
    options.source,
    "--limit",
    String(options.limit ?? 25),
  ];

  if (options.query) {
    args.push("--query", options.query);
  }

  if (options.allowFixtureFallback) {
    args.push("--fallback-fixture");
  }

  return args;
}

export async function runStateCrawler(options: StateCrawlerRunOptions): Promise<StateCrawlerRunResult> {
  return new Promise((resolve) => {
    execFile(
      "python3",
      buildArgs(options),
      {
        cwd: crawlerDirectory(),
        env: process.env,
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          source: options.source,
          status: error ? "failure" : "success",
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
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
    });
}
