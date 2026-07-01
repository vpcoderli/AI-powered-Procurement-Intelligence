import { STATE_CRAWLER_SOURCES } from "@/lib/state-crawler-sources";

export type LiveSourceHealthStatus = "healthy" | "unhealthy" | "skipped";
export type LiveSourceHealthClassification =
  | "ok"
  | "forbidden"
  | "timeout"
  | "bot_check"
  | "login_required"
  | "empty_or_placeholder"
  | "tls_or_network_error"
  | "http_error"
  | "unknown";
export type LiveSourceHealthErrorCode =
  | "missing_base_url"
  | "http_error"
  | "fetch_error"
  | "empty_body"
  | "access_challenge";
export type LiveSourceHealthOperationalSeverity = "none" | "info" | "warning" | "critical";
export type LiveSourceHealthRecommendedAction =
  | "none"
  | "update_registry_url"
  | "browser_or_access_review"
  | "retry_or_increase_timeout"
  | "network_or_tls_review"
  | "add_base_url";

export interface LiveSourceHealthInput {
  id: string;
  stateCode: string;
  label: string;
  baseUrl: string | null;
  sourceAuthority: string;
  trustStatus: string;
}

export interface LiveSourceHealthResult {
  stateCode: string;
  sourceId: string;
  label: string;
  url: string | null;
  sourceAuthority: string;
  trustStatus: string;
  status: LiveSourceHealthStatus;
  checkedAt?: string;
  method: "HEAD" | "GET" | null;
  httpStatus: number | null;
  statusCode?: number | null;
  statusText: string | null;
  errorCode: LiveSourceHealthErrorCode | null;
  errorMessage: string | null;
  error?: string | null;
  classification?: LiveSourceHealthClassification;
  reason?: string | null;
  evidenceSnippets?: string[];
  latencyMs?: number | null;
  operationalSeverity: LiveSourceHealthOperationalSeverity;
  recommendedAction: LiveSourceHealthRecommendedAction;
}

type LiveSourceHealthBaseResult = Omit<LiveSourceHealthResult, "operationalSeverity" | "recommendedAction">;

export interface LiveSourceHealthReport {
  ok: boolean;
  checkedAt: string;
  summary: {
    total: number;
    healthy: number;
    unhealthy: number;
    skipped: number;
  };
  results: LiveSourceHealthResult[];
}

export interface LiveSourceHealthOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: Date;
  inspectBody?: boolean;
}

function timeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, method: "HEAD" | "GET", timeoutMs: number) {
  const timeout = timeoutSignal(timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetchImpl(url, {
      method,
      redirect: "follow",
      signal: timeout.signal,
      headers: {
        "user-agent": "WinBids Source Health Check/1.0",
      },
    });

    return {
      response,
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  } finally {
    timeout.clear();
  }
}

function httpEvidence(status: number | null, statusText: string | null) {
  if (status === null) return null;
  return `HTTP ${status}${statusText ? ` ${statusText}` : ""}`.trim();
}

function truncateSnippet(value: string, maxLength = 180) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}...`;
}

function textFromHtml(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeEvidenceSnippet(value: string) {
  const sensitiveKeyPattern = [
    "api[-_ ]?key",
    "access[-_ ]?token",
    "refresh[-_ ]?token",
    "token",
    "password",
    "secret",
    "session",
    "authorization",
  ].join("|");
  const sensitiveAssignment = new RegExp(
    `\\b(${sensitiveKeyPattern})\\s*[:=]\\s*["']?[^"'\\s<>&]+`,
    "gi",
  );

  return truncateSnippet(
    textFromHtml(value)
      .replace(sensitiveAssignment, "$1=[REDACTED]")
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[EMAIL]"),
  );
}

function evidenceAroundMarker(body: string, markers: string[]) {
  const text = textFromHtml(body);
  const lower = text.toLowerCase();
  const markerIndex = markers
    .map((marker) => lower.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (markerIndex === undefined) {
    return sanitizeEvidenceSnippet(text);
  }

  const start = Math.max(0, markerIndex - 60);
  const end = Math.min(text.length, markerIndex + 120);

  return sanitizeEvidenceSnippet(text.slice(start, end));
}

function classifyHealthResult(input: {
  status: LiveSourceHealthStatus;
  httpStatus: number | null;
  errorCode: LiveSourceHealthErrorCode | null;
  errorMessage: string | null;
  classification?: LiveSourceHealthClassification | null;
}): Pick<LiveSourceHealthResult, "operationalSeverity" | "recommendedAction"> {
  if (input.status === "healthy") {
    return { operationalSeverity: "none", recommendedAction: "none" };
  }

  if (input.errorCode === "missing_base_url") {
    return { operationalSeverity: "critical", recommendedAction: "add_base_url" };
  }

  if (input.httpStatus === 404 || input.httpStatus === 410) {
    return { operationalSeverity: "critical", recommendedAction: "update_registry_url" };
  }

  if (input.classification === "timeout") {
    return { operationalSeverity: "warning", recommendedAction: "retry_or_increase_timeout" };
  }

  if (input.classification === "tls_or_network_error") {
    return { operationalSeverity: "warning", recommendedAction: "network_or_tls_review" };
  }

  if (
    input.classification === "forbidden" ||
    input.classification === "bot_check" ||
    input.classification === "login_required" ||
    input.classification === "empty_or_placeholder"
  ) {
    return { operationalSeverity: "warning", recommendedAction: "browser_or_access_review" };
  }

  if ([401, 403, 429].includes(input.httpStatus ?? 0)) {
    return { operationalSeverity: "warning", recommendedAction: "browser_or_access_review" };
  }

  if (input.errorCode === "empty_body" || input.errorCode === "access_challenge") {
    return { operationalSeverity: "warning", recommendedAction: "browser_or_access_review" };
  }

  const message = (input.errorMessage ?? "").toLowerCase();
  if (message.includes("aborted") || message.includes("timeout") || message.includes("timed out")) {
    return { operationalSeverity: "warning", recommendedAction: "retry_or_increase_timeout" };
  }

  if (input.errorCode === "fetch_error") {
    return { operationalSeverity: "warning", recommendedAction: "network_or_tls_review" };
  }

  return { operationalSeverity: "warning", recommendedAction: "browser_or_access_review" };
}

const BOT_CHECK_MARKERS = [
  "captcha",
  "bot check",
  "browser check",
  "verify you are human",
  "checking your browser",
  "cloudflare",
  "akamai",
  "perimeterx",
];

const LOGIN_MARKERS = [
  "login required",
  "log in",
  "sign in",
  "signed in",
  "vendor account",
  "authentication required",
  "password",
  "sso",
];

const PLACEHOLDER_MARKERS = [
  "coming soon",
  "under construction",
  "site temporarily unavailable",
  "no content available",
  "placeholder",
  "default web site page",
];

function markerMatch(body: string, markers: string[]) {
  const lower = textFromHtml(body).toLowerCase();
  return markers.some((marker) => lower.includes(marker));
}

function bodyClassification(body: string) {
  const text = textFromHtml(body);

  if (!text.trim()) {
    return {
      classification: "empty_or_placeholder" as const,
      reason: "HTTP success returned an empty or placeholder response body.",
      evidenceSnippets: ["Body was empty after trimming."],
      errorCode: "empty_body" as const,
      errorMessage: "HTTP success returned an empty or placeholder response body.",
    };
  }

  if (markerMatch(body, BOT_CHECK_MARKERS)) {
    return {
      classification: "bot_check" as const,
      reason: "Body inspection found bot-check or CAPTCHA content.",
      evidenceSnippets: [evidenceAroundMarker(body, BOT_CHECK_MARKERS)],
      errorCode: "access_challenge" as const,
      errorMessage: "HTTP success returned a bot-check or CAPTCHA page.",
    };
  }

  if (markerMatch(body, LOGIN_MARKERS)) {
    return {
      classification: "login_required" as const,
      reason: "Body inspection found login-required content.",
      evidenceSnippets: [evidenceAroundMarker(body, LOGIN_MARKERS)],
      errorCode: "access_challenge" as const,
      errorMessage: "HTTP success returned a login-required page.",
    };
  }

  if (markerMatch(body, PLACEHOLDER_MARKERS)) {
    return {
      classification: "empty_or_placeholder" as const,
      reason: "HTTP success returned an empty or placeholder response body.",
      evidenceSnippets: [evidenceAroundMarker(body, PLACEHOLDER_MARKERS)],
      errorCode: "empty_body" as const,
      errorMessage: "HTTP success returned an empty or placeholder response body.",
    };
  }

  return null;
}

function httpClassification(status: number, statusText: string | null) {
  const reason = httpEvidence(status, statusText) ?? `HTTP ${status}`;

  if (status >= 200 && status < 400) {
    return {
      classification: "ok" as const,
      reason: "Source responded with usable content.",
      evidenceSnippets: [reason],
      errorCode: null,
      errorMessage: null,
      status: "healthy" as const,
    };
  }

  if (status === 401) {
    return {
      classification: "login_required" as const,
      reason,
      evidenceSnippets: [reason],
      errorCode: "http_error" as const,
      errorMessage: reason,
      status: "unhealthy" as const,
    };
  }

  if (status === 403) {
    return {
      classification: "forbidden" as const,
      reason,
      evidenceSnippets: [reason],
      errorCode: "http_error" as const,
      errorMessage: reason,
      status: "unhealthy" as const,
    };
  }

  if (status === 408 || status === 504) {
    return {
      classification: "timeout" as const,
      reason,
      evidenceSnippets: [reason],
      errorCode: "http_error" as const,
      errorMessage: reason,
      status: "unhealthy" as const,
    };
  }

  if (status === 429) {
    return {
      classification: "bot_check" as const,
      reason,
      evidenceSnippets: [reason],
      errorCode: "http_error" as const,
      errorMessage: reason,
      status: "unhealthy" as const,
    };
  }

  return {
    classification: "http_error" as const,
    reason,
    evidenceSnippets: [reason],
    errorCode: "http_error" as const,
    errorMessage: reason,
    status: "unhealthy" as const,
  };
}

function fetchErrorClassification(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = rawMessage || name || "Unknown fetch error";
  const lower = `${name} ${message}`.toLowerCase();
  const evidenceSnippets = [sanitizeEvidenceSnippet(message)].filter((snippet) => snippet.length > 0);

  if (
    name === "AbortError" ||
    lower.includes("abort") ||
    lower.includes("timeout") ||
    lower.includes("timed out")
  ) {
    return {
      classification: "timeout" as const,
      reason: "Timed out while probing source.",
      evidenceSnippets,
    };
  }

  if (
    lower.includes("tls") ||
    lower.includes("ssl") ||
    lower.includes("certificate") ||
    lower.includes("network") ||
    lower.includes("enotfound") ||
    lower.includes("econnrefused") ||
    lower.includes("econnreset") ||
    lower.includes("fetch failed")
  ) {
    return {
      classification: "tls_or_network_error" as const,
      reason: "Network or TLS failure while probing source.",
      evidenceSnippets,
    };
  }

  return {
    classification: "unknown" as const,
    reason: "Unknown failure while probing source.",
    evidenceSnippets,
  };
}

async function resultFromResponse(
  source: LiveSourceHealthInput,
  method: "HEAD" | "GET",
  response: Response,
  inspectBody: boolean,
  latencyMs: number | null,
  checkedAt: string,
): Promise<LiveSourceHealthResult> {
  const httpDetails = httpClassification(response.status, response.statusText);
  const bodyDetails =
    inspectBody && method === "GET" && typeof response.text === "function"
      ? bodyClassification(await response.text())
      : null;
  const details =
    bodyDetails && (httpDetails.status === "healthy" || bodyDetails.classification !== "empty_or_placeholder")
      ? {
          ...bodyDetails,
          status: "unhealthy" as const,
        }
      : httpDetails;

  const baseResult: LiveSourceHealthBaseResult = {
    stateCode: source.stateCode,
    sourceId: source.id,
    label: source.label,
    url: source.baseUrl,
    sourceAuthority: source.sourceAuthority,
    trustStatus: source.trustStatus,
    status: details.status,
    checkedAt,
    method,
    httpStatus: response.status,
    statusCode: response.status,
    statusText: response.statusText,
    errorCode: details.errorCode,
    errorMessage: details.errorMessage,
    error: details.errorMessage,
    classification: details.classification,
    reason: details.reason,
    evidenceSnippets: details.evidenceSnippets.filter((snippet) => snippet.length > 0),
    latencyMs,
  };

  return {
    ...baseResult,
    ...classifyHealthResult(baseResult),
  };
}

function errorResult(source: LiveSourceHealthInput, error: unknown, checkedAt: string): LiveSourceHealthResult {
  const classification = fetchErrorClassification(error);
  const errorMessage = sanitizeEvidenceSnippet(error instanceof Error ? error.message : String(error));
  const baseResult: LiveSourceHealthBaseResult = {
    stateCode: source.stateCode,
    sourceId: source.id,
    label: source.label,
    url: source.baseUrl,
    sourceAuthority: source.sourceAuthority,
    trustStatus: source.trustStatus,
    status: "unhealthy",
    checkedAt,
    method: null,
    httpStatus: null,
    statusCode: null,
    statusText: null,
    errorCode: "fetch_error",
    errorMessage,
    error: errorMessage,
    classification: classification.classification,
    reason: classification.reason,
    evidenceSnippets: classification.evidenceSnippets,
    latencyMs: null,
  };

  return {
    ...baseResult,
    ...classifyHealthResult(baseResult),
  };
}

async function checkOneSource(
  source: LiveSourceHealthInput,
  options: Required<Pick<LiveSourceHealthOptions, "fetchImpl" | "timeoutMs" | "inspectBody">>,
  checkedAt: string,
): Promise<LiveSourceHealthResult> {
  if (!source.baseUrl) {
    const baseResult: LiveSourceHealthBaseResult = {
      stateCode: source.stateCode,
      sourceId: source.id,
      label: source.label,
      url: null,
      sourceAuthority: source.sourceAuthority,
      trustStatus: source.trustStatus,
      status: "skipped",
      checkedAt,
      method: null,
      httpStatus: null,
      statusCode: null,
      statusText: null,
      errorCode: "missing_base_url",
      errorMessage: "Source has no base URL.",
      error: "Source has no base URL.",
      classification: "unknown",
      reason: "Source has no base URL.",
      evidenceSnippets: ["Source has no base URL."],
      latencyMs: null,
    };

    return {
      ...baseResult,
      ...classifyHealthResult(baseResult),
    };
  }

  try {
    const headResult = await fetchWithTimeout(options.fetchImpl, source.baseUrl, "HEAD", options.timeoutMs);
    if (![403, 405, 501].includes(headResult.response.status)) {
      if (headResult.response.status >= 200 && headResult.response.status < 400 && options.inspectBody) {
        const getResult = await fetchWithTimeout(options.fetchImpl, source.baseUrl, "GET", options.timeoutMs);
        return resultFromResponse(source, "GET", getResult.response, true, getResult.latencyMs, checkedAt);
      }

      return resultFromResponse(source, "HEAD", headResult.response, false, headResult.latencyMs, checkedAt);
    }

    const getResult = await fetchWithTimeout(options.fetchImpl, source.baseUrl, "GET", options.timeoutMs);
    return resultFromResponse(source, "GET", getResult.response, options.inspectBody, getResult.latencyMs, checkedAt);
  } catch (error) {
    return errorResult(source, error, checkedAt);
  }
}

function summarize(results: LiveSourceHealthResult[]) {
  return {
    total: results.length,
    healthy: results.filter((result) => result.status === "healthy").length,
    unhealthy: results.filter((result) => result.status === "unhealthy").length,
    skipped: results.filter((result) => result.status === "skipped").length,
  };
}

export async function checkLiveSourceHealth(
  sources: readonly LiveSourceHealthInput[] = STATE_CRAWLER_SOURCES,
  options: LiveSourceHealthOptions = {},
): Promise<LiveSourceHealthReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const inspectBody = options.inspectBody ?? false;
  const checkedAt = (options.now ?? new Date()).toISOString();
  const results = await Promise.all(
    sources.map((source) =>
      checkOneSource(
        source,
        {
          fetchImpl,
          timeoutMs,
          inspectBody,
        },
        checkedAt,
      ),
    ),
  );
  const summary = summarize(results);

  return {
    ok: summary.unhealthy === 0,
    checkedAt,
    summary,
    results,
  };
}

export function formatLiveSourceHealthReport(report: LiveSourceHealthReport) {
  const lines = [
    `Source health ${report.ok ? "PASS" : "FAIL"} at ${report.checkedAt}`,
    `Summary: ${report.summary.healthy}/${report.summary.total} healthy, `
      + `${report.summary.unhealthy} unhealthy, ${report.summary.skipped} skipped`,
    ...report.results.map((result) => {
      const prefix = result.status === "healthy" ? "PASS" : result.status === "skipped" ? "SKIP" : "FAIL";
      const http = result.httpStatus ? ` HTTP ${result.httpStatus}` : "";
      const method = result.method ? ` ${result.method}` : "";
      const classification = result.classification ? ` classification=${result.classification}` : "";
      const error = result.errorCode ? ` ${result.errorCode}: ${result.errorMessage}` : "";
      const action =
        result.recommendedAction && result.recommendedAction !== "none"
          ? ` action=${result.recommendedAction} severity=${result.operationalSeverity}`
          : "";
      return `${prefix} ${result.stateCode} ${result.sourceId}${method}${http} ${result.url ?? "no-url"} `
        + `[${result.sourceAuthority}/${result.trustStatus}]${classification}${error}${action}`;
    }),
  ];

  return lines.join("\n");
}
