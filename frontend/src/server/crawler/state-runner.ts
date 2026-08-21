import { execFile } from "node:child_process";
import path from "node:path";
import type { CrawlerJsonRunPayload } from "./mysql-json-importer";
import type { CrawlableSource } from "./source-registry";

function crawlerDirectory() {
  return path.resolve(process.cwd(), "..", "crawler");
}

export interface CrawlTaskDateRange {
  from: string | null;
  to: string | null;
}

export interface CrawlTaskPayload {
  task_id: string;
  source_id: string;
  label: string;
  state_code: string;
  provider_family: string | null;
  jurisdiction_level: string | null;
  fetch_config: Record<string, unknown>;
  limit: number;
  query: string | null;
  /** Published-date window (ISO yyyy-mm-dd, inclusive). Python filters fail-open. */
  date_range: CrawlTaskDateRange | null;
}

export interface CrawlTaskOptions {
  taskId: string;
  limit?: number;
  query?: string | null;
  postedFrom?: string | null;
  postedTo?: string | null;
}

export function buildCrawlTaskPayload(
  source: CrawlableSource,
  options: CrawlTaskOptions,
): CrawlTaskPayload {
  const fetchConfig = { ...source.fetchConfig };
  if (!fetchConfig.base_url && source.baseUrl) {
    fetchConfig.base_url = source.baseUrl;
  }

  const postedFrom = options.postedFrom ?? null;
  const postedTo = options.postedTo ?? null;

  return {
    task_id: options.taskId,
    source_id: source.id,
    label: source.label,
    state_code: source.stateCode,
    provider_family: source.providerFamily,
    jurisdiction_level: source.jurisdictionLevel,
    fetch_config: fetchConfig,
    limit: options.limit ?? 25,
    query: options.query ?? null,
    date_range: postedFrom || postedTo ? { from: postedFrom, to: postedTo } : null,
  };
}

export interface CrawlTaskResult {
  ok: boolean;
  source: string;
  status: "success" | "failure";
  stdout: string;
  stderr: string;
  fetchedCount: number;
  errorCode: string | null;
  /**
   * The full camelCase run payload parsed from stdout, on both success and failure — the
   * importer (configured-runner.ts) needs the whole thing, not just the fetchedCount/errorCode
   * summary fields above. `null` only when stdout did not parse into an object carrying a
   * `status` field (e.g. unparseable JSON, or a payload shape from an unrelated failure mode).
   */
  payload: CrawlerJsonRunPayload | null;
}

export async function runCrawlTask(
  source: CrawlableSource,
  options: CrawlTaskOptions,
): Promise<CrawlTaskResult> {
  const payload = buildCrawlTaskPayload(source, options);

  return new Promise((resolve) => {
    const child = execFile(
      "python3",
      ["-m", "apsi_crawler.cli", "fetch-task"],
      { cwd: crawlerDirectory(), env: process.env },
      (error, stdout, stderr) => {
        // Python 侧 _json_run_payload 输出 camelCase 键,不是 snake_case。
        let parsed: { status?: string; bids?: unknown[]; errorCode?: string | null } = {};
        try {
          parsed = JSON.parse(String(stdout ?? ""));
        } catch {
          parsed = {};
        }

        const ok = !error && parsed.status === "success";
        // Same `parsed` value as above — not re-parsed — just validated for the shape the
        // importer needs (an object with a status field) before being exposed as `resultPayload`.
        // Named distinctly from the outer `payload` (the outbound task request) so the two
        // don't shadow each other.
        const resultPayload: CrawlerJsonRunPayload | null =
          parsed !== null && typeof parsed === "object" && typeof parsed.status === "string"
            ? (parsed as CrawlerJsonRunPayload)
            : null;

        resolve({
          ok,
          source: source.id,
          status: ok ? "success" : "failure",
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          fetchedCount: Array.isArray(parsed.bids) ? parsed.bids.length : 0,
          errorCode: parsed.errorCode ?? null,
          payload: resultPayload,
        });
      },
    );

    child.stdin?.end(JSON.stringify(payload));
  });
}
