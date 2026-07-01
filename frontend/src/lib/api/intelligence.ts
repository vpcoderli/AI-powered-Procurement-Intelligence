import type {
  ProcurementIntelligenceResponse,
  ProcurementIntelligenceSummary,
} from "@/server/intelligence/types";

export class ProcurementIntelligenceApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ProcurementIntelligenceApiError";
    this.status = status;
  }
}

function errorMessageFromBody(body: unknown) {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as { error?: { message?: unknown } }).error?.message === "string"
  ) {
    return (body as { error: { message: string } }).error.message;
  }

  return "Unable to load procurement intelligence";
}

export async function fetchProcurementIntelligence(): Promise<ProcurementIntelligenceSummary> {
  const response = await fetch("/api/dashboard/intelligence");
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new ProcurementIntelligenceApiError(response.status, "Unable to load procurement intelligence");
  }

  if (!response.ok) {
    throw new ProcurementIntelligenceApiError(response.status, errorMessageFromBody(body));
  }

  return (body as ProcurementIntelligenceResponse).intelligence;
}
