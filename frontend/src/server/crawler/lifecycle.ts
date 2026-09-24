import { bidLifecycleStatusOf, type BidLifecycleStatus } from "@/lib/bid-lifecycle";
import type { CrawlerJsonRunPayload } from "./mysql-json-importer";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function activeFlag(value: unknown) {
  return !(value === false || value === 0 || value === "0");
}

/**
 * Lifecycle status, activity and the three lifecycle columns of a merged bid (spec 2026-09-24
 * §5.1). `is_active` always equals an open lifecycle; an awarded bid is never downgraded to
 * closed; a missing deadline / award date / number never erases a known one.
 */
export function mergeLifecycleFields(incoming: JsonRecord, existing: JsonRecord = {}): JsonRecord {
  const incomingStatus: BidLifecycleStatus =
    bidLifecycleStatusOf(incoming.lifecycle_status) ?? (activeFlag(incoming.is_active) ? "open" : "closed");
  const status: BidLifecycleStatus =
    incomingStatus === "closed" && bidLifecycleStatusOf(existing.lifecycle_status) === "awarded" ? "awarded" : incomingStatus;
  return {
    lifecycle_status: status,
    is_active: status === "open" ? 1 : 0,
    awarded_date: text(incoming.awarded_date) || text(existing.awarded_date) || null,
    deadline_date: text(incoming.deadline_date) || text(existing.deadline_date) || null,
    solicitation_number: text(incoming.solicitation_number) || text(existing.solicitation_number) || null,
  };
}

export function readListPagination(metadata: unknown): { listKind: string; complete: boolean; requestsMade: number | null } | null {
  const pagination = record(record(metadata).pagination);
  if (Object.keys(pagination).length === 0) return null;
  const requests = Number(pagination.requests_made);
  return {
    listKind: typeof pagination.list_kind === "string" ? pagination.list_kind : "open",
    complete: pagination.complete === true,
    requestsMade: pagination.requests_made !== undefined && Number.isFinite(requests) && requests >= 0 ? requests : null,
  };
}

/** True only when this run proves which of the source's open bids are still listed. */
export function delistingApplies(payload: CrawlerJsonRunPayload): boolean {
  if (payload.status !== "success") return false;
  const pagination = readListPagination(payload.metadata);
  return pagination !== null && pagination.listKind === "open" && pagination.complete;
}

/** `LIKE ? ESCAPE '!'` pattern for every bid id of one source (`<source_id>:<source_bid_id>`). */
export function sourceBidIdLikePattern(sourceId: string): string {
  return `${sourceId.replace(/[!%_]/g, (character) => `!${character}`)}:%`;
}

export function delistedRawPayload(raw: unknown, at: string): string {
  const parsed = record(raw);
  return JSON.stringify({
    ...parsed,
    lifecycle: { ...record(parsed.lifecycle), closed_reason: "delisted", closed_observed_at: at },
  });
}

export function withLifecycleMetadata(payload: CrawlerJsonRunPayload, delisted: number): CrawlerJsonRunPayload {
  return { ...payload, metadata: { ...(payload.metadata ?? {}), lifecycle: { delisted } } };
}
