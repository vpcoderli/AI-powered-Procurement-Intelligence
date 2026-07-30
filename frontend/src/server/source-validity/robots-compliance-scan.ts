import { createHash } from "node:crypto";
import { STATE_CRAWLER_SOURCE_DEFINITIONS } from "@/lib/state-crawler-sources";

// Data-source compliance pre-check (P1-2).
//
// IMPORTANT: this module is a signal/triage tool only. It fetches and hashes
// each source's robots.txt and flags sources whose robots.txt appears to
// disallow crawling entirely, or disallow paths that look like the paths
// APSI crawls. It does NOT parse or evaluate Terms of Service text, and a
// "clear" robots.txt result is not a legal authorization to crawl. Actual
// legal review and sign-off remain a human/legal action — see
// docs/operations/data-source-compliance-ledger.md.

export type RobotsTxtStatus =
  | "clear"
  | "disallow_all"
  | "disallow_crawled_paths"
  | "unreachable"
  | "not_found"
  | "unknown";

export interface SourceComplianceInput {
  id: string;
  stateCode: string;
  label: string;
  baseUrl: string | null;
  /** Path fragments the crawler is known to request for this source, used to check for targeted disallow rules. */
  crawledPathHints?: string[];
}

export interface SourceComplianceResult {
  stateCode: string;
  sourceId: string;
  label: string;
  baseUrl: string | null;
  robotsTxtUrl: string | null;
  status: RobotsTxtStatus;
  httpStatus: number | null;
  robotsTxtHash: string | null;
  disallowsCrawledPaths: boolean;
  flagged: boolean;
  flagReason: string | null;
  matchedDisallowRules: string[];
  checkedAt: string;
  errorMessage: string | null;
}

export interface SourceComplianceReport {
  ok: boolean;
  checkedAt: string;
  summary: {
    total: number;
    clear: number;
    flagged: number;
    unreachable: number;
  };
  results: SourceComplianceResult[];
}

export interface SourceComplianceScanOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: Date;
  /** Default crawled-path hints applied to every source unless the source specifies its own. */
  defaultCrawledPathHints?: string[];
}

// NOTE: intentionally does not include a bare "/" — that would match nearly
// every Disallow rule via substring containment (most paths contain "/") and
// make every non-empty robots.txt look flagged. Disallow: / (disallow-all)
// is handled separately by isDisallowAll().
const DEFAULT_CRAWLED_PATH_HINTS = ["bid", "solicitation", "procurement", "opportunit", "search", "api"];

function timeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

async function fetchRobotsTxt(fetchImpl: typeof fetch, robotsUrl: string, timeoutMs: number) {
  const timeout = timeoutSignal(timeoutMs);

  try {
    const response = await fetchImpl(robotsUrl, {
      method: "GET",
      redirect: "follow",
      signal: timeout.signal,
      headers: {
        "user-agent": "APSI Source Compliance Scan/1.0 (+data-source-compliance-ledger)",
      },
    });

    return { response };
  } finally {
    timeout.clear();
  }
}

function robotsTxtUrlFor(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host}/robots.txt`;
  } catch {
    return null;
  }
}

function hashBody(body: string) {
  return createHash("sha256").update(body).digest("hex");
}

interface ParsedRobotsRule {
  userAgent: string;
  disallow: string[];
}

/**
 * Minimal robots.txt parser: groups Disallow directives by the user-agent
 * block they appear under. Only used for triage signal purposes — this is
 * not a spec-complete robots.txt implementation (no Allow precedence,
 * wildcard matching is a simple prefix/substring heuristic).
 */
function parseRobotsTxt(body: string): ParsedRobotsRule[] {
  const lines = body.split(/\r?\n/);
  const groups: ParsedRobotsRule[] = [];
  let current: ParsedRobotsRule | null = null;

  for (const rawLine of lines) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;

    const field = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();

    if (field === "user-agent") {
      current = { userAgent: value.toLowerCase(), disallow: [] };
      groups.push(current);
      continue;
    }

    if (field === "disallow" && current) {
      current.disallow.push(value);
    }
  }

  return groups;
}

function applicableGroups(groups: ParsedRobotsRule[]) {
  const wildcard = groups.filter((group) => group.userAgent === "*");
  if (wildcard.length > 0) return wildcard;

  // No wildcard block: fall back to any block that looks like it targets
  // generic bots/crawlers, otherwise treat as no applicable restriction.
  return groups.filter((group) => /bot|crawl|spider/.test(group.userAgent));
}

function isDisallowAll(disallowValues: string[]) {
  return disallowValues.some((value) => value.trim() === "/");
}

function matchesCrawledPathHints(disallowValue: string, hints: string[]) {
  const normalized = disallowValue.trim().toLowerCase();
  if (!normalized || normalized === "/") return false;

  return hints.some((hint) => normalized.includes(hint.toLowerCase()));
}

function evaluateRobotsBody(body: string, hints: string[]) {
  const groups = applicableGroups(parseRobotsTxt(body));
  const disallowValues = groups.flatMap((group) => group.disallow);

  if (isDisallowAll(disallowValues)) {
    return {
      status: "disallow_all" as const,
      disallowsCrawledPaths: true,
      flagged: true,
      flagReason: "robots.txt disallows all paths (Disallow: /) for applicable user-agent group(s).",
      matchedDisallowRules: disallowValues.filter((value) => value.trim() === "/"),
    };
  }

  const matched = disallowValues.filter((value) => matchesCrawledPathHints(value, hints));
  if (matched.length > 0) {
    return {
      status: "disallow_crawled_paths" as const,
      disallowsCrawledPaths: true,
      flagged: true,
      flagReason: `robots.txt disallows path(s) that overlap with paths APSI crawls: ${matched.join(", ")}.`,
      matchedDisallowRules: matched,
    };
  }

  return {
    status: "clear" as const,
    disallowsCrawledPaths: false,
    flagged: false,
    flagReason: null,
    matchedDisallowRules: [] as string[],
  };
}

async function scanOneSource(
  source: SourceComplianceInput,
  options: Required<Pick<SourceComplianceScanOptions, "fetchImpl" | "timeoutMs">>,
  defaultHints: string[],
  checkedAt: string,
): Promise<SourceComplianceResult> {
  const base: Omit<SourceComplianceResult, "status" | "httpStatus" | "robotsTxtHash" | "disallowsCrawledPaths" | "flagged" | "flagReason" | "matchedDisallowRules" | "errorMessage"> = {
    stateCode: source.stateCode,
    sourceId: source.id,
    label: source.label,
    baseUrl: source.baseUrl,
    robotsTxtUrl: source.baseUrl ? robotsTxtUrlFor(source.baseUrl) : null,
    checkedAt,
  };

  if (!source.baseUrl || !base.robotsTxtUrl) {
    return {
      ...base,
      status: "unknown",
      httpStatus: null,
      robotsTxtHash: null,
      disallowsCrawledPaths: false,
      flagged: true,
      flagReason: "Source has no base URL; robots.txt could not be located. Needs manual legal review.",
      matchedDisallowRules: [],
      errorMessage: "Missing or unparseable base URL.",
    };
  }

  const hints = source.crawledPathHints && source.crawledPathHints.length > 0 ? source.crawledPathHints : defaultHints;

  try {
    const { response } = await fetchRobotsTxt(options.fetchImpl, base.robotsTxtUrl, options.timeoutMs);

    if (response.status === 404) {
      return {
        ...base,
        status: "not_found",
        httpStatus: response.status,
        robotsTxtHash: null,
        disallowsCrawledPaths: false,
        flagged: false,
        flagReason: null,
        matchedDisallowRules: [],
        errorMessage: null,
      };
    }

    if (!response.ok) {
      return {
        ...base,
        status: "unreachable",
        httpStatus: response.status,
        robotsTxtHash: null,
        disallowsCrawledPaths: false,
        flagged: true,
        flagReason: `robots.txt fetch returned HTTP ${response.status}; could not evaluate. Needs manual review.`,
        matchedDisallowRules: [],
        errorMessage: `HTTP ${response.status}`,
      };
    }

    const body = await response.text();
    const hash = hashBody(body);
    const evaluation = evaluateRobotsBody(body, hints);

    return {
      ...base,
      status: evaluation.status,
      httpStatus: response.status,
      robotsTxtHash: hash,
      disallowsCrawledPaths: evaluation.disallowsCrawledPaths,
      flagged: evaluation.flagged,
      flagReason: evaluation.flagReason,
      matchedDisallowRules: evaluation.matchedDisallowRules,
      errorMessage: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      ...base,
      status: "unreachable",
      httpStatus: null,
      robotsTxtHash: null,
      disallowsCrawledPaths: false,
      flagged: true,
      flagReason: `robots.txt could not be fetched (${message}). Needs manual review.`,
      matchedDisallowRules: [],
      errorMessage: message,
    };
  }
}

function summarize(results: SourceComplianceResult[]) {
  return {
    total: results.length,
    clear: results.filter((result) => !result.flagged).length,
    flagged: results.filter((result) => result.flagged).length,
    unreachable: results.filter((result) => result.status === "unreachable").length,
  };
}

export async function scanSourceCompliance(
  sources: readonly SourceComplianceInput[] = STATE_CRAWLER_SOURCE_DEFINITIONS,
  options: SourceComplianceScanOptions = {},
): Promise<SourceComplianceReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const defaultHints = options.defaultCrawledPathHints ?? DEFAULT_CRAWLED_PATH_HINTS;
  const checkedAt = (options.now ?? new Date()).toISOString();

  const results = await Promise.all(
    sources.map((source) => scanOneSource(source, { fetchImpl, timeoutMs }, defaultHints, checkedAt)),
  );
  const summary = summarize(results);

  return {
    ok: summary.flagged === 0,
    checkedAt,
    summary,
    results,
  };
}

export function formatSourceComplianceReport(report: SourceComplianceReport) {
  const lines = [
    `Source Compliance Pre-Check (robots.txt) — ${report.ok ? "CLEAR" : "FLAGGED"}`,
    `Checked at: ${report.checkedAt}`,
    `Total: ${report.summary.total}  Clear: ${report.summary.clear}  Flagged: ${report.summary.flagged}  Unreachable: ${report.summary.unreachable}`,
    "",
    "This is an automated triage signal only, not a legal determination.",
    "Flagged and clear sources both require human legal review before first production crawl.",
    "",
  ];

  const flagged = report.results.filter((result) => result.flagged);
  if (flagged.length > 0) {
    lines.push("Flagged sources:");
    for (const result of flagged) {
      lines.push(
        `  [${result.stateCode}] ${result.sourceId} (${result.label}) - ${result.status}: ${result.flagReason ?? "unknown reason"}`,
      );
    }
    lines.push("");
  }

  const clear = report.results.filter((result) => !result.flagged);
  lines.push(`Clear sources (still require human legal review): ${clear.length}`);

  return lines.join("\n");
}
