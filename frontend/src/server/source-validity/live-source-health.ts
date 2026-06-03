import { STATE_CRAWLER_SOURCES } from "@/lib/state-crawler-sources";

export type LiveSourceHealthStatus = "healthy" | "unhealthy" | "skipped";
export type LiveSourceHealthErrorCode = "missing_base_url" | "http_error" | "fetch_error";
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
  method: "HEAD" | "GET" | null;
  httpStatus: number | null;
  statusCode?: number | null;
  statusText: string | null;
  errorCode: LiveSourceHealthErrorCode | null;
  errorMessage: string | null;
  error?: string | null;
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
}

function timeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, method: "HEAD" | "GET", timeoutMs: number) {
  const timeout = timeoutSignal(timeoutMs);

  try {
    return await fetchImpl(url, {
      method,
      redirect: "follow",
      signal: timeout.signal,
      headers: {
        "user-agent": "WinBids Source Health Check/1.0",
      },
    });
  } finally {
    timeout.clear();
  }
}

function classifyHealthResult(input: {
  status: LiveSourceHealthStatus;
  httpStatus: number | null;
  errorCode: LiveSourceHealthErrorCode | null;
  errorMessage: string | null;
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

  if ([401, 403, 429].includes(input.httpStatus ?? 0)) {
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

function resultFromResponse(
  source: LiveSourceHealthInput,
  method: "HEAD" | "GET",
  response: Response,
): LiveSourceHealthResult {
  const healthy = response.status >= 200 && response.status < 400;

  const baseResult: LiveSourceHealthBaseResult = {
    stateCode: source.stateCode,
    sourceId: source.id,
    label: source.label,
    url: source.baseUrl,
    sourceAuthority: source.sourceAuthority,
    trustStatus: source.trustStatus,
    status: healthy ? "healthy" : "unhealthy",
    method,
    httpStatus: response.status,
    statusText: response.statusText,
    errorCode: healthy ? null : "http_error",
    errorMessage: healthy ? null : `HTTP ${response.status} ${response.statusText}`.trim(),
  };

  return {
    ...baseResult,
    ...classifyHealthResult(baseResult),
  };
}

function errorResult(source: LiveSourceHealthInput, error: unknown): LiveSourceHealthResult {
  const baseResult: LiveSourceHealthBaseResult = {
    stateCode: source.stateCode,
    sourceId: source.id,
    label: source.label,
    url: source.baseUrl,
    sourceAuthority: source.sourceAuthority,
    trustStatus: source.trustStatus,
    status: "unhealthy",
    method: null,
    httpStatus: null,
    statusText: null,
    errorCode: "fetch_error",
    errorMessage: error instanceof Error ? error.message : String(error),
  };

  return {
    ...baseResult,
    ...classifyHealthResult(baseResult),
  };
}

async function checkOneSource(
  source: LiveSourceHealthInput,
  options: Required<Pick<LiveSourceHealthOptions, "fetchImpl" | "timeoutMs">>,
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
      method: null,
      httpStatus: null,
      statusText: null,
      errorCode: "missing_base_url",
      errorMessage: "Source has no base URL.",
    };

    return {
      ...baseResult,
      ...classifyHealthResult(baseResult),
    };
  }

  try {
    const headResponse = await fetchWithTimeout(options.fetchImpl, source.baseUrl, "HEAD", options.timeoutMs);
    if (![403, 405, 501].includes(headResponse.status)) {
      return resultFromResponse(source, "HEAD", headResponse);
    }

    const getResponse = await fetchWithTimeout(options.fetchImpl, source.baseUrl, "GET", options.timeoutMs);
    return resultFromResponse(source, "GET", getResponse);
  } catch (error) {
    return errorResult(source, error);
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
  const results = await Promise.all(
    sources.map((source) =>
      checkOneSource(source, {
        fetchImpl,
        timeoutMs,
      }),
    ),
  );
  const summary = summarize(results);

  return {
    ok: summary.unhealthy === 0,
    checkedAt: (options.now ?? new Date()).toISOString(),
    summary,
    results,
  };
}

export function formatLiveSourceHealthReport(report: LiveSourceHealthReport) {
  const lines = [
    `Source health ${report.ok ? "PASS" : "FAIL"} at ${report.checkedAt}`,
    `Summary: ${report.summary.healthy}/${report.summary.total} healthy, ${report.summary.unhealthy} unhealthy, ${report.summary.skipped} skipped`,
    ...report.results.map((result) => {
      const prefix = result.status === "healthy" ? "PASS" : result.status === "skipped" ? "SKIP" : "FAIL";
      const http = result.httpStatus ? ` HTTP ${result.httpStatus}` : "";
      const method = result.method ? ` ${result.method}` : "";
      const error = result.errorCode ? ` ${result.errorCode}: ${result.errorMessage}` : "";
      const action =
        result.recommendedAction && result.recommendedAction !== "none"
          ? ` action=${result.recommendedAction} severity=${result.operationalSeverity}`
          : "";
      return `${prefix} ${result.stateCode} ${result.sourceId}${method}${http} ${result.url ?? "no-url"} [${result.sourceAuthority}/${result.trustStatus}]${error}${action}`;
    }),
  ];

  return lines.join("\n");
}
