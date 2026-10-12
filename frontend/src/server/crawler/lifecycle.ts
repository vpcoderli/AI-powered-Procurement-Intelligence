import { bidDeadlinePassed } from "@/lib/bid-deadline";
import { bidLifecycleStatusOf, type BidLifecycleStatus } from "@/lib/bid-lifecycle";
import type { CrawlerJsonRunPayload } from "./mysql-json-importer";

type JsonRecord = Record<string, unknown>;

/** A JSON object, or an object given as JSON text; null for anything else (including text that is not JSON). */
function jsonObject(value: unknown): JsonRecord | null {
  if (typeof value === "string") {
    try { return jsonObject(JSON.parse(value)); } catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function record(value: unknown): JsonRecord {
  return jsonObject(value) ?? {};
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function activeFlag(value: unknown) {
  return !(value === false || value === 0 || value === "0");
}

export interface LifecycleMergeOptions {
  /** ISO instant at which the import observes the bid. When given, an open bid whose deadline has passed by then closes. */
  now?: string;
}

/** A zoned ISO date-time, the way `toISOString()` and Python's `isoformat()` write one. */
const ZONED_ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

function isoInstantMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const instant = value.trim();
  if (!ZONED_ISO_INSTANT.test(instant)) return null;
  const ms = Date.parse(instant);
  return Number.isFinite(ms) ? ms : null;
}

/** The status the import states for the bid; an awarded bid is never downgraded to closed. */
function importedStatus(incoming: JsonRecord, existing: JsonRecord): BidLifecycleStatus {
  const incomingStatus: BidLifecycleStatus =
    bidLifecycleStatusOf(incoming.lifecycle_status) ?? (activeFlag(incoming.is_active) ? "open" : "closed");
  return incomingStatus === "closed" && bidLifecycleStatusOf(existing.lifecycle_status) === "awarded" ? "awarded" : incomingStatus;
}

interface LifecycleDecision {
  status: BidLifecycleStatus;
  /** The deadline the bid is judged by: the incoming one, else the stored one. */
  deadline: string;
  /** True when the deadline-passed rule is what closed an otherwise open bid. */
  closedByDeadline: boolean;
}

function decideLifecycle(incoming: JsonRecord, existing: JsonRecord, now: string | undefined): LifecycleDecision {
  const deadline = text(incoming.deadline_date) || text(existing.deadline_date);
  const status = importedStatus(incoming, existing);
  const nowMs = isoInstantMs(now);
  if (status !== "open" || nowMs === null || !bidDeadlinePassed(deadline, nowMs)) return { status, deadline, closedByDeadline: false };
  // A deadline closes an open bid; like every other close, it never downgrades an award.
  return bidLifecycleStatusOf(existing.lifecycle_status) === "awarded"
    ? { status: "awarded", deadline, closedByDeadline: false }
    : { status: "closed", deadline, closedByDeadline: true };
}

/**
 * Lifecycle status, activity and the three lifecycle columns of a merged bid (spec 2026-09-24
 * §5.1). `is_active` always equals an open lifecycle; an awarded bid is never downgraded to
 * closed; a missing deadline / award date / number never erases a known one.
 *
 * With `options.now`, an open bid whose deadline (the incoming one, else the stored one) has passed
 * by then comes back closed: delisting only follows a complete BidNet open-list walk, so on its own
 * a bid of any other source would stay open for good. Without `now` the status is exactly what the
 * import states. An unreadable or missing deadline never closes a bid.
 */
export function mergeLifecycleFields(incoming: JsonRecord, existing: JsonRecord = {}, options: LifecycleMergeOptions = {}): JsonRecord {
  const { status, deadline } = decideLifecycle(incoming, existing, options.now);
  return {
    lifecycle_status: status,
    is_active: status === "open" ? 1 : 0,
    awarded_date: text(incoming.awarded_date) || text(existing.awarded_date) || null,
    deadline_date: deadline || null,
    solicitation_number: text(incoming.solicitation_number) || text(existing.solicitation_number) || null,
  };
}

/** The deadline that made the deadline-passed rule close this bid at `options.now`, or null when it did not. */
export function deadlineClosureOf(incoming: JsonRecord, existing: JsonRecord = {}, options: LifecycleMergeOptions = {}): string | null {
  const { closedByDeadline, deadline } = decideLifecycle(incoming, existing, options.now);
  return closedByDeadline ? deadline : null;
}

export function readListPagination(metadata: unknown): { listKind: string | null; complete: boolean; requestsMade: number | null } | null {
  const pagination = record(record(metadata).pagination);
  if (Object.keys(pagination).length === 0) return null;
  const requests = Number(pagination.requests_made);
  return {
    // No default: a walk that never declared its list kind must not read as an open-list walk,
    // or delistingApplies would close the source's open bids on it.
    listKind: typeof pagination.list_kind === "string" ? pagination.list_kind : null,
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

export type LifecycleCloseReason = "delisted" | "deadline_passed";

/**
 * `raw` with the close recorded under `lifecycle` (`closed_reason`, `closed_observed_at`, plus `extra`), keeping
 * every other key and any earlier `lifecycle` keys. Null when `raw` is not a JSON object (an object, or text
 * that parses to one): a caller then leaves the stored payload as it is instead of destroying it.
 */
export function closedPayload(raw: unknown, reason: LifecycleCloseReason, at: string, extra: JsonRecord = {}): JsonRecord | null {
  const parsed = jsonObject(raw);
  if (!parsed) return null;
  return { ...parsed, lifecycle: { ...record(parsed.lifecycle), closed_reason: reason, closed_observed_at: at, ...extra } };
}

/** `closedPayload` as the JSON text a `raw_payload` column holds; null when `raw` is not a JSON object. */
export function closedRawPayload(raw: unknown, reason: LifecycleCloseReason, at: string, extra: JsonRecord = {}): string | null {
  const payload = closedPayload(raw, reason, at, extra);
  return payload === null ? null : JSON.stringify(payload);
}

/** The payload of a bid the open list stopped showing. Unlike the deadline close, it rewrites a payload that is not a JSON object. */
export function delistedRawPayload(raw: unknown, at: string): string {
  return closedRawPayload(raw, "delisted", at)
    ?? JSON.stringify({ lifecycle: { closed_reason: "delisted", closed_observed_at: at } });
}

export function withLifecycleMetadata(payload: CrawlerJsonRunPayload, delisted: number): CrawlerJsonRunPayload {
  return { ...payload, metadata: { ...(payload.metadata ?? {}), lifecycle: { delisted } } };
}
