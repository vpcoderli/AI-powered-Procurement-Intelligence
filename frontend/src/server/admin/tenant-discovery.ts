/**
 * Node side of contract C4: `python -m apsi_crawler.cli discover-tenant` (stdin JSON in, stdout
 * JSON out) — a read-only probe for county/city sources whose tenant path has moved (the
 * local BidNet sources that answer 404). It only *suggests* a base URL; writing it back is an
 * explicit admin action (PATCH `baseUrl`), never automatic.
 *
 * Same spawn shape as `crawler/state-runner.ts`'s `fetch-task`, with a much tighter timeout:
 * the probe makes at most a handful of spaced requests, so anything past a minute means the
 * platform is stalling us and the pre-check should say so rather than hold the request open.
 */

import { execFile } from "node:child_process";
import { crawlerRuntime } from "@/server/crawler/execution-context";

export const DISCOVER_TENANT_TIMEOUT_MS = 60_000;

export interface DiscoverTenantRequest {
  base_url: string;
  label: string;
  state_code: string;
  provider_family: string | null;
  max_requests: number;
  min_interval_seconds: number;
}

export interface TenantCandidate {
  url: string;
  status: number | null;
  title: string | null;
  labelMatch: boolean;
  rows: number;
  emptyState: boolean;
}

export interface DiscoverTenantResponse {
  candidates: TenantCandidate[];
  suggestedBaseUrl: string | null;
  reason: string | null;
}

export class TenantDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantDiscoveryError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** Defensive parse of the C4 response document. Throws on anything that is not that shape. */
export function parseDiscoverTenantResponse(stdout: string): DiscoverTenantResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new TenantDiscoveryError("discover-tenant did not write a JSON document to stdout.");
  }

  if (!isRecord(parsed)) {
    throw new TenantDiscoveryError("discover-tenant stdout was not a JSON object.");
  }

  const rawCandidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  const candidates = rawCandidates.flatMap((entry): TenantCandidate[] => {
    if (!isRecord(entry)) return [];
    const url = optionalText(entry.url);
    if (!url) return [];

    return [
      {
        url,
        status: optionalNumber(entry.status),
        title: optionalText(entry.title),
        labelMatch: entry.label_match === true || entry.labelMatch === true,
        rows: optionalNumber(entry.rows) ?? 0,
        emptyState: entry.empty_state === true || entry.emptyState === true,
      },
    ];
  });

  return {
    candidates,
    suggestedBaseUrl: optionalText(parsed.suggested_base_url) ?? optionalText(parsed.suggestedBaseUrl),
    reason: optionalText(parsed.reason),
  };
}

export interface RunDiscoverTenantOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function runDiscoverTenant(
  request: DiscoverTenantRequest,
  options: RunDiscoverTenantOptions = {},
): Promise<DiscoverTenantResponse> {
  const { python, ...runtime } = crawlerRuntime();

  return new Promise((resolve, reject) => {
    const child = execFile(
      python,
      ["-m", "apsi_crawler.cli", "discover-tenant"],
      {
        ...runtime,
        timeout: options.timeoutMs ?? DISCOVER_TENANT_TIMEOUT_MS,
        env: process.env,
        signal: options.signal,
      },
      (error, stdout, stderr) => {
        const detail = stderr ? ` (${String(stderr).trim()})` : "";
        if (error) {
          reject(new TenantDiscoveryError(`discover-tenant exited abnormally: ${error.message}${detail}`));
          return;
        }
        try {
          resolve(parseDiscoverTenantResponse(String(stdout ?? "")));
        } catch (parseError) {
          reject(new TenantDiscoveryError(`${(parseError as Error).message}${detail}`));
        }
      },
    );

    child.stdin?.end(JSON.stringify(request));
  });
}
