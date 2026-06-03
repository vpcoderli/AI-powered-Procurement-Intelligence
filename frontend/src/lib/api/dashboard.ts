import type { DashboardSummary } from "@/server/dashboard/summary";

export interface DashboardSummaryResponse {
  summary: DashboardSummary;
}

export class DashboardApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DashboardApiError";
    this.status = status;
  }
}

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const response = await fetch("/api/dashboard/summary");
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new DashboardApiError(response.status, "Unable to load dashboard summary");
  }

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error?: { message?: unknown } }).error?.message === "string"
        ? (body as { error: { message: string } }).error.message
        : "Unable to load dashboard summary";

    throw new DashboardApiError(response.status, message);
  }

  return (body as DashboardSummaryResponse).summary;
}
