import type { KnowledgeItem, KnowledgeListResponse } from "@/server/knowledge/types";

export type KnowledgeApiErrorCode =
  | "FEATURE_NOT_AVAILABLE"
  | "INVALID_REQUEST"
  | "INTERNAL_ERROR"
  | "AUTH_REQUIRED"
  | "UNAUTHENTICATED";

interface KnowledgeApiErrorResponse {
  error: {
    code: KnowledgeApiErrorCode;
    message: string;
  };
}

interface CreateKnowledgeItemResponse {
  item: KnowledgeItem;
}

export class KnowledgeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: KnowledgeApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeApiError";
  }
}

export interface FetchKnowledgeItemsParams {
  intentId?: string;
  bidId?: string;
  q?: string;
  type?: string;
  limit?: number;
}

export interface CreateKnowledgeItemApiInput {
  title: string;
  body: string;
  type: string;
  tags?: string[];
  sourceKind: string;
  sourceIntentId?: string;
  sourceBidId?: string;
  sourceUrl?: string;
}

function isKnowledgeApiErrorResponse(body: unknown): body is KnowledgeApiErrorResponse {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return false;
  }

  const error = (body as { error: unknown }).error;

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const { code, message } = error as { code?: unknown; message?: unknown };

  return (
    (code === "FEATURE_NOT_AVAILABLE" ||
      code === "INVALID_REQUEST" ||
      code === "INTERNAL_ERROR" ||
      code === "AUTH_REQUIRED" ||
      code === "UNAUTHENTICATED") &&
    typeof message === "string"
  );
}

async function parseResponse<T>(response: Response): Promise<T> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    throw new KnowledgeApiError(response.status, "INTERNAL_ERROR", "Request failed");
  }

  if (!response.ok) {
    if (isKnowledgeApiErrorResponse(body)) {
      throw new KnowledgeApiError(response.status, body.error.code, body.error.message);
    }

    throw new KnowledgeApiError(response.status, "INTERNAL_ERROR", "Request failed");
  }

  return body as T;
}

function buildKnowledgeUrl(params: FetchKnowledgeItemsParams = {}) {
  const searchParams = new URLSearchParams();

  if (params.intentId) searchParams.set("intentId", params.intentId);
  if (params.bidId) searchParams.set("bidId", params.bidId);
  if (params.q) searchParams.set("q", params.q);
  if (params.type) searchParams.set("type", params.type);
  if (typeof params.limit === "number") searchParams.set("limit", String(params.limit));

  const query = searchParams.toString();

  return query ? `/api/knowledge?${query}` : "/api/knowledge";
}

export async function fetchKnowledgeItems(params: FetchKnowledgeItemsParams = {}) {
  const response = await fetch(buildKnowledgeUrl(params));

  return parseResponse<KnowledgeListResponse>(response);
}

export async function createKnowledgeItem(input: CreateKnowledgeItemApiInput) {
  const response = await fetch("/api/knowledge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return parseResponse<CreateKnowledgeItemResponse>(response);
}
