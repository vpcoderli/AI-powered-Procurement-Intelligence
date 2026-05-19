import type {
  AdminCrawlerLog,
  AdminDataSource,
  AdminDataSourcesResponse,
} from "@/server/admin/data-sources-repository";

export type { AdminCrawlerLog, AdminDataSource, AdminDataSourcesResponse };

type AdminApiErrorCode =
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "DATA_SOURCE_NOT_FOUND"
  | "INTERNAL_ERROR";

export interface AdminCrawlerLogsResponse {
  logs: AdminCrawlerLog[];
}

export interface UpdateAdminDataSourceResponse {
  source: AdminDataSource;
}

export class AdminApiError extends Error {
  status: number;
  code: AdminApiErrorCode;

  constructor(status: number, code: AdminApiErrorCode, message: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
  }
}

function isAdminErrorResponse(body: unknown): body is { error: { code: AdminApiErrorCode; message: string } } {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return false;
  }

  const error = (body as { error: unknown }).error;
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const { code, message } = error as { code?: unknown; message?: unknown };

  return (
    (code === "FORBIDDEN" ||
      code === "INVALID_REQUEST" ||
      code === "DATA_SOURCE_NOT_FOUND" ||
      code === "INTERNAL_ERROR") &&
    typeof message === "string"
  );
}

async function parseResponse<T>(response: Response): Promise<T> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new AdminApiError(response.status, "INTERNAL_ERROR", "Request failed");
  }

  if (!response.ok) {
    if (isAdminErrorResponse(body)) {
      throw new AdminApiError(response.status, body.error.code, body.error.message);
    }

    throw new AdminApiError(response.status, "INTERNAL_ERROR", "Request failed");
  }

  return body as T;
}

export async function listAdminDataSources() {
  const response = await fetch("/api/admin/data-sources");

  return parseResponse<AdminDataSourcesResponse>(response);
}

export async function updateAdminDataSource(id: string, input: { isEnabled: boolean }) {
  const response = await fetch(`/api/admin/data-sources/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<UpdateAdminDataSourceResponse>(response);
}

export async function listAdminCrawlerLogs() {
  const response = await fetch("/api/admin/crawler-logs");

  return parseResponse<AdminCrawlerLogsResponse>(response);
}

export async function runSamGovCrawlerNow() {
  const response = await fetch("/api/crawler/sam-gov/run", { method: "POST" });

  return parseResponse<unknown>(response);
}

export async function runStateCrawlersNow() {
  const response = await fetch("/api/crawler/state/run", { method: "POST" });

  return parseResponse<unknown>(response);
}
