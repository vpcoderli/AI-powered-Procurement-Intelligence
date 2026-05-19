import { execFile } from "node:child_process";
import path from "node:path";

export interface SamGovCrawlerRunOptions {
  postedFrom?: string;
  postedTo?: string;
  limit?: number;
  maxRecords?: number;
  databasePath?: string;
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

function buildArgs(options: SamGovCrawlerRunOptions) {
  const args = [
    "-m",
    "apsi_crawler.cli",
    "fetch-sam-gov",
    "--database",
    options.databasePath ?? defaultDatabasePath(),
    "--posted-from",
    options.postedFrom ?? defaultPostedFrom(),
    "--posted-to",
    options.postedTo ?? defaultPostedTo(),
    "--limit",
    String(options.limit ?? 100),
  ];

  if (options.maxRecords !== undefined) {
    args.push("--max-records", String(options.maxRecords));
  }

  return args;
}

export async function runSamGovCrawler(
  options: SamGovCrawlerRunOptions = {},
): Promise<SamGovCrawlerRunResult> {
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
          source: "SAM.gov",
          status: error ? "failure" : "success",
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
  });
}
