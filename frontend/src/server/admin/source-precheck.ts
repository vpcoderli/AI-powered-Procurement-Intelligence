/**
 * Contract C5 — admin approval pre-check.
 *
 * Gathers the evidence an admin needs before approving a county/city source, in one pass:
 *   1. robots.txt for the source's host (triage signal, never a legal determination);
 *   2. a dry-run `fetch-task` with a small limit — no persistence, and deliberately NO
 *      governance gate, because this is exactly the check the gate exists to inform;
 *   3. when the dry run came back 404, a read-only tenant-path probe (contract C4) that
 *      *suggests* a base URL for the admin to confirm.
 *
 * The verdict and the robots result are written back onto the `data_sources` row
 * (`robots_txt_*`, `live_health_*`) so the admin console and the compliance ledger can show
 * them later. Nothing here approves anything: approval stays a human PATCH.
 */

import type { AppDatabase } from "@/server/db/client";
import { hasVerifiedEmptyState } from "@/server/crawler/persistence-errors";
import { listAllSources, listAllSourcesFromMysql, type CrawlableSource } from "@/server/crawler/source-registry";
import { runCrawlTask as defaultRunCrawlTask, type CrawlTaskResult } from "@/server/crawler/state-runner";
import { createCrawlerBackedRobotsFetch } from "./crawler-robots-fetch";
import {
  scanSourceCompliance as defaultScanSourceCompliance,
  type SourceComplianceResult,
} from "@/server/source-validity/robots-compliance-scan";
import {
  AdminDataSourceNotFoundError,
  recordSourcePrecheck,
  recordSourcePrecheckFromMysql,
  type MysqlDataSourcesStore,
} from "./data-sources-repository";
import { runDiscoverTenant as defaultRunDiscoverTenant, type DiscoverTenantResponse } from "./tenant-discovery";

export const DEFAULT_PRECHECK_LIMIT = 5;
const DISCOVERY_MAX_REQUESTS = 6;
const DISCOVERY_MIN_INTERVAL_SECONDS = 3;
const SAMPLE_SIZE = 3;

export type SourcePrecheckVerdict = "ready" | "empty" | "needs_fix";
export type SourcePrecheckFetchStatus = "ok" | "empty_verified" | "failed";

export interface SourcePrecheckSample {
  title: string | null;
  url: string | null;
}

export interface SourcePrecheckRobots {
  status: string;
  flagged: boolean;
  flagReason: string | null;
}

export interface SourcePrecheckFetch {
  status: SourcePrecheckFetchStatus;
  items: number;
  sample: SourcePrecheckSample[];
  listMethod: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  httpStatus: number | null;
  wafChallenge: boolean;
}

export interface SourcePrecheckResult {
  sourceId: string;
  checkedAt: string;
  verdict: SourcePrecheckVerdict;
  reasons: string[];
  robots: SourcePrecheckRobots;
  fetch: SourcePrecheckFetch;
  suggestedBaseUrl: string | null;
}

export class SourcePrecheckFailedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SourcePrecheckFailedError";
  }
}

export interface RunSourcePrecheckOptions {
  database: AppDatabase;
  mysql?: MysqlDataSourcesStore;
  sourceId: string;
  limit?: number;
  now?: Date;
  runCrawlTask?: typeof defaultRunCrawlTask;
  discoverTenant?: typeof defaultRunDiscoverTenant;
  scanCompliance?: typeof defaultScanSourceCompliance;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function metadataOf(result: CrawlTaskResult): Record<string, unknown> {
  const metadata = result.payload?.metadata;
  return isRecord(metadata) ? metadata : {};
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

const STATUS_IN_MESSAGE = /\b(?:status|http|code)\w*\W{0,4}(\d{3})\b/i;

/** The portal's HTTP status, from whichever of the Python-side fields carried it. */
export function extractHttpStatus(result: CrawlTaskResult): number | null {
  const metadata = metadataOf(result);
  for (const key of ["httpStatus", "http_status", "statusCode", "status_code"]) {
    const value = numericValue(metadata[key]);
    if (value !== null) return value;
  }

  const message = [result.payload?.errorMessage, result.stderr].filter(Boolean).join("\n");
  const matched = STATUS_IN_MESSAGE.exec(message);
  return matched ? Number(matched[1]) : null;
}

export function isWafChallenge(result: CrawlTaskResult, httpStatus: number | null): boolean {
  const metadata = metadataOf(result);
  if (metadata.wafChallenge === true || metadata.waf_challenge === true) return true;
  if (typeof result.errorCode === "string" && /ChallengeError$/.test(result.errorCode)) return true;
  return httpStatus === 202 || httpStatus === 403;
}

function sampleOf(result: CrawlTaskResult): SourcePrecheckSample[] {
  const bids = Array.isArray(result.payload?.bids) ? result.payload.bids : [];
  return bids.slice(0, SAMPLE_SIZE).map((bid) => {
    const row = isRecord(bid) ? bid : {};
    const title = row.title ?? row.name;
    const url = row.source_url ?? row.sourceUrl ?? row.url;
    return {
      title: typeof title === "string" ? title : null,
      url: typeof url === "string" ? url : null,
    };
  });
}

function listMethodOf(result: CrawlTaskResult): string | null {
  const listExtraction = metadataOf(result).listExtraction;
  if (!isRecord(listExtraction)) return null;
  return typeof listExtraction.method === "string" ? listExtraction.method : null;
}

function summarizeFetch(result: CrawlTaskResult): SourcePrecheckFetch {
  const items = Array.isArray(result.payload?.bids) ? result.payload.bids.length : result.fetchedCount;
  const httpStatus = extractHttpStatus(result);
  const emptyVerified = result.ok && items === 0 && hasVerifiedEmptyState(result.payload?.metadata ?? null);

  return {
    status: result.ok ? (emptyVerified ? "empty_verified" : "ok") : "failed",
    items: result.ok ? items : 0,
    sample: result.ok ? sampleOf(result) : [],
    listMethod: listMethodOf(result),
    errorCode: result.ok ? null : result.errorCode,
    errorMessage: result.ok ? null : result.payload?.errorMessage ?? (result.stderr.trim() || null),
    httpStatus,
    wafChallenge: isWafChallenge(result, httpStatus),
  };
}

function toPrecheckRobots(robots: SourceComplianceResult): SourcePrecheckRobots {
  return {
    status: robots.status,
    flagged: robots.flagged,
    flagReason: robots.flagReason,
  };
}

function findSource(sources: CrawlableSource[], sourceId: string): CrawlableSource {
  const source = sources.find((candidate) => candidate.id === sourceId);
  if (!source) throw new AdminDataSourceNotFoundError(sourceId);
  return source;
}

function verdictFor(fetchSummary: SourcePrecheckFetch): SourcePrecheckVerdict {
  if (fetchSummary.status === "failed") return "needs_fix";
  if (fetchSummary.status === "empty_verified") return "empty";
  return fetchSummary.items > 0 ? "ready" : "needs_fix";
}

function reasonsFor(
  fetchSummary: SourcePrecheckFetch,
  robots: SourcePrecheckRobots,
  discovery: DiscoverTenantResponse | null,
): string[] {
  const reasons: string[] = [];

  if (fetchSummary.status === "ok" && fetchSummary.items > 0) {
    reasons.push(`Dry run parsed ${fetchSummary.items} solicitation(s).`);
  }
  if (fetchSummary.status === "empty_verified") {
    reasons.push("Dry run reached the tenant's own list page and it declares no open solicitations.");
  }
  if (fetchSummary.status === "failed") {
    reasons.push(
      `Dry run failed${fetchSummary.errorCode ? ` (${fetchSummary.errorCode})` : ""}${
        fetchSummary.httpStatus ? ` with HTTP ${fetchSummary.httpStatus}` : ""
      }.`,
    );
  }
  if (fetchSummary.status === "ok" && fetchSummary.items === 0) {
    reasons.push("Dry run succeeded but parsed no rows and no verified empty state.");
  }
  if (fetchSummary.wafChallenge) {
    reasons.push("The platform answered with a bot/WAF challenge; retry later and keep the platform interval.");
  }
  if (robots.flagged) {
    reasons.push(`robots.txt is flagged: ${robots.flagReason ?? robots.status}. A legal opinion reference is required.`);
  }
  if (discovery) {
    reasons.push(
      discovery.suggestedBaseUrl
        ? `Tenant path probe suggests ${discovery.suggestedBaseUrl}; confirm it before writing base_url.`
        : `Tenant path probe found no confirmed candidate${discovery.reason ? ` (${discovery.reason})` : ""}.`,
    );
  }

  return reasons;
}

/** Runs the C5 pre-check for one source and writes its robots/live-health evidence back. */
export async function runSourcePrecheck(options: RunSourcePrecheckOptions): Promise<SourcePrecheckResult> {
  const runCrawlTask = options.runCrawlTask ?? defaultRunCrawlTask;
  const discoverTenant = options.discoverTenant ?? defaultRunDiscoverTenant;
  // robots.txt goes through the crawler's HTTP client: WAF-fronted portals (BidNet) reject
  // Node's fetch outright, and the crawler's view of robots.txt is the one that governs it.
  const scanCompliance = options.scanCompliance
    ?? ((inputs, scanOptions) => defaultScanSourceCompliance(inputs, { ...scanOptions, fetchImpl: createCrawlerBackedRobotsFetch() }));
  const now = options.now ?? new Date();
  const checkedAt = now.toISOString();
  const limit = options.limit ?? DEFAULT_PRECHECK_LIMIT;

  const sources = options.mysql
    ? await listAllSourcesFromMysql(options.mysql)
    : listAllSources(options.database);
  const source = findSource(sources, options.sourceId);

  const complianceReport = await scanCompliance(
    [
      {
        id: source.id,
        stateCode: source.stateCode,
        label: source.label,
        baseUrl: source.baseUrl,
      },
    ],
    { now },
  );
  const robotsResult = complianceReport.results[0];
  const robots = toPrecheckRobots(robotsResult);

  let fetchResult: CrawlTaskResult;
  try {
    fetchResult = await runCrawlTask(source, {
      taskId: `precheck_${source.id}_${now.getTime()}`,
      limit,
    });
  } catch (error) {
    throw new SourcePrecheckFailedError(
      `Pre-check could not run the crawler for ${source.id}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  const fetchSummary = summarizeFetch(fetchResult);

  let discovery: DiscoverTenantResponse | null = null;
  if (fetchSummary.status === "failed" && fetchSummary.httpStatus === 404 && source.baseUrl) {
    try {
      discovery = await discoverTenant({
        base_url: source.baseUrl,
        label: source.label,
        state_code: source.stateCode,
        provider_family: source.providerFamily,
        max_requests: DISCOVERY_MAX_REQUESTS,
        min_interval_seconds: DISCOVERY_MIN_INTERVAL_SECONDS,
      });
    } catch (error) {
      // A failed probe is a missing suggestion, not a failed pre-check — the 404 evidence the
      // admin actually needs is already in hand.
      console.error(
        JSON.stringify({
          event: "source_precheck_tenant_discovery_failed",
          source: source.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  const verdict = verdictFor(fetchSummary);
  const result: SourcePrecheckResult = {
    sourceId: source.id,
    checkedAt,
    verdict,
    reasons: reasonsFor(fetchSummary, robots, discovery),
    robots,
    fetch: fetchSummary,
    suggestedBaseUrl: discovery?.suggestedBaseUrl ?? null,
  };

  const writeBack = {
    robots: {
      status: robotsResult.status,
      checkedAt: robotsResult.checkedAt,
      hash: robotsResult.robotsTxtHash,
      disallowsCrawledPaths: robotsResult.disallowsCrawledPaths,
      flagReason: robotsResult.flagReason,
    },
    liveHealth: {
      disposition: verdict,
      notes: JSON.stringify({
        precheck: {
          checkedAt,
          verdict,
          reasons: result.reasons,
          fetch: fetchSummary,
          robots,
          suggestedBaseUrl: result.suggestedBaseUrl,
        },
      }),
      reviewedAt: checkedAt,
    },
  };

  if (options.mysql) {
    await recordSourcePrecheckFromMysql(options.mysql, source.id, writeBack);
  } else {
    recordSourcePrecheck(options.database, source.id, writeBack);
  }

  return result;
}
