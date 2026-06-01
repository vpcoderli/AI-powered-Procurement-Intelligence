import { randomUUID } from "node:crypto";

export interface RequestContext {
  requestId: string;
  correlationId: string;
}

function cleanHeader(value: string | null) {
  const trimmed = value?.trim();
  return trimmed || null;
}

export function createRequestContext(request?: Request): RequestContext {
  const requestId = cleanHeader(request?.headers.get("x-request-id") ?? null) ?? `req_${randomUUID()}`;
  const correlationId =
    cleanHeader(request?.headers.get("x-correlation-id") ?? null) ??
    cleanHeader(request?.headers.get("x-request-id") ?? null) ??
    `corr_${randomUUID()}`;

  return { requestId, correlationId };
}
