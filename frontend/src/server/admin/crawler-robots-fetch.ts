/**
 * A `fetch`-shaped robots.txt fetcher that goes through the Python crawler.
 *
 * Node's built-in fetch (undici) is rejected outright by some WAF-fronted portals: BidNet Direct
 * answers 403 to every Node request — even robots.txt, even with a browser User-Agent — while
 * the crawler's `requests` session with `BROWSER_REQUEST_HEADERS` is served (verified
 * 2026-09-16). The robots.txt a portal shows the crawler is also the one that governs the
 * crawler, so compliance checks ask `python -m apsi_crawler.cli fetch-robots` for it.
 *
 * Only robots.txt-style origin URLs are expected here; the Python side derives
 * `<scheme>://<host>/robots.txt` from whatever URL it is given.
 */
import { execFile } from "node:child_process";
import { crawlerRuntime } from "@/server/crawler/execution-context";

export const FETCH_ROBOTS_TIMEOUT_MS = 30_000;

export class CrawlerRobotsFetchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CrawlerRobotsFetchError";
  }
}

interface FetchRobotsDocument {
  robots_url: string;
  status: number;
  final_url: string | null;
  content_type?: string | null;
  body: string;
  truncated?: boolean;
  error?: string | null;
}

export function parseFetchRobotsResponse(stdout: string): FetchRobotsDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new CrawlerRobotsFetchError(`fetch-robots returned no JSON document: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") throw new CrawlerRobotsFetchError("fetch-robots returned a non-object document");
  const record = parsed as Record<string, unknown>;
  if (record.error && typeof record.error === "object") {
    const detail = record.error as { code?: string; message?: string };
    throw new CrawlerRobotsFetchError(`fetch-robots rejected the request: ${detail.code ?? "ERROR"} ${detail.message ?? ""}`.trim());
  }
  if (typeof record.status !== "number" || typeof record.body !== "string") {
    throw new CrawlerRobotsFetchError("fetch-robots document is missing status/body");
  }
  return record as unknown as FetchRobotsDocument;
}

function runFetchRobots(baseUrl: string, timeoutMs: number, signal?: AbortSignal): Promise<FetchRobotsDocument> {
  const { python, ...runtime } = crawlerRuntime();
  return new Promise((resolve, reject) => {
    const child = execFile(
      python,
      ["-m", "apsi_crawler.cli", "fetch-robots"],
      { ...runtime, timeout: timeoutMs, env: process.env, signal },
      (error, stdout, stderr) => {
        const detail = stderr ? ` (${String(stderr).trim().split("\n").pop()})` : "";
        if (error) {
          reject(new CrawlerRobotsFetchError(`fetch-robots exited abnormally: ${error.message}${detail}`));
          return;
        }
        try {
          resolve(parseFetchRobotsResponse(String(stdout ?? "")));
        } catch (parseError) {
          reject(new CrawlerRobotsFetchError(`${(parseError as Error).message}${detail}`));
        }
      },
    );
    child.stdin?.end(JSON.stringify({ base_url: baseUrl }));
  });
}

export interface CrawlerBackedFetchOptions {
  timeoutMs?: number;
}

/**
 * Build a `typeof fetch` that resolves robots.txt through the crawler. A transport failure on
 * the Python side (`status: 0`) rejects like a network error would, so `scanSourceCompliance`
 * records the source as `unreachable`.
 */
export function createCrawlerBackedRobotsFetch(options: CrawlerBackedFetchOptions = {}): typeof fetch {
  const timeoutMs = options.timeoutMs ?? FETCH_ROBOTS_TIMEOUT_MS;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const document = await runFetchRobots(url, timeoutMs, init?.signal ?? undefined);
    if (document.status === 0) {
      throw new CrawlerRobotsFetchError(`fetch-robots could not reach ${document.robots_url}: ${document.error ?? "network error"}`);
    }
    const headers: Record<string, string> = {};
    if (document.content_type) headers["content-type"] = document.content_type;
    return new Response(document.body, { status: document.status, headers });
  }) as typeof fetch;
  return fetchImpl;
}
