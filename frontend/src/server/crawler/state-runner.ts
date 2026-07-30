import { execFile } from "node:child_process";
import path from "node:path";
import type { CrawlableSource } from "./source-registry";

function crawlerDirectory() {
  return path.resolve(process.cwd(), "..", "crawler");
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
}

export interface CrawlTaskOptions {
  taskId: string;
  limit?: number;
  query?: string | null;
}

export function buildCrawlTaskPayload(
  source: CrawlableSource,
  options: CrawlTaskOptions,
): CrawlTaskPayload {
  const fetchConfig = { ...source.fetchConfig };
  if (!fetchConfig.base_url && source.baseUrl) {
    fetchConfig.base_url = source.baseUrl;
  }

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
        resolve({
          ok,
          source: source.id,
          status: ok ? "success" : "failure",
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          fetchedCount: Array.isArray(parsed.bids) ? parsed.bids.length : 0,
          errorCode: parsed.errorCode ?? null,
        });
      },
    );

    child.stdin?.end(JSON.stringify(payload));
  });
}
