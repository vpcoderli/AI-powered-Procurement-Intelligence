import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { expandMysqlInClause, mysqlExecute, mysqlSelectMany } from "@/server/db/mysql-runtime";
import { dataSources } from "@/server/db/schema";
import type { MysqlDataSourcesStore } from "./data-sources-repository";
import { precheckBaseUrlFromNotes } from "./source-precheck";

/** Spec 2026-09-24 §7.3 check 2: a precheck older than this cannot back a batch approval. */
export const PRECHECK_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const LOCAL_JURISDICTION_LEVELS: readonly string[] = ["county", "city", "township", "special_district"];
export const MAX_REQUESTED_IDS = 500;
const FAMILY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export class PrecheckRequestInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrecheckRequestInputError";
  }
}

export interface RequestPrechecksInput {
  sourceIds?: string[];
  providerFamily?: string | null;
  pending?: boolean;
}

export function normalizeRequestPrechecksInput(raw: unknown): RequestPrechecksInput {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sourceIds = Array.isArray(body.sourceIds)
    ? Array.from(new Set(body.sourceIds.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean)))
    : [];
  const providerFamily = typeof body.providerFamily === "string" ? body.providerFamily.trim().toLowerCase() : null;
  const pending = body.pending === true;

  if (sourceIds.length > MAX_REQUESTED_IDS) throw new PrecheckRequestInputError(`at most ${MAX_REQUESTED_IDS} sourceIds per request`);
  if (providerFamily !== null && !FAMILY_PATTERN.test(providerFamily)) throw new PrecheckRequestInputError("providerFamily must be a lowercase slug");
  if (sourceIds.length === 0 && !(providerFamily && pending)) {
    throw new PrecheckRequestInputError("pass sourceIds, or providerFamily together with pending: true");
  }
  return { sourceIds, providerFamily, pending };
}

export function isPrecheckFresh(liveHealthReviewedAt: string | null, now: Date): boolean {
  if (!liveHealthReviewedAt) return false;
  const at = Date.parse(liveHealthReviewedAt);
  return Number.isFinite(at) && now.getTime() - at <= PRECHECK_MAX_AGE_MS;
}

export type PrecheckEvidence = "missing" | "base_url_changed" | "superseded" | "stale" | "needs_fix" | "usable";

export interface PrecheckEvidenceInput {
  baseUrl: string | null;
  liveHealthDisposition: string | null;
  liveHealthReviewedAt: string | null;
  liveHealthNotes: string | null;
  lastFailureAt: string | null;
  lastApprovalReviewedAt: string | null;
}

/**
 * True when `candidate` is set and strictly later than `reference` (compared with `Date.parse`). An unparsable
 * timestamp on either side counts as later: fail-closed, so a precheck is never taken to outrank a failure or a
 * governance change it cannot be ordered against.
 */
function isStrictlyLater(candidate: string | null, reference: string | null): boolean {
  if (candidate === null) return false;
  const candidateAt = Date.parse(candidate);
  const referenceAt = Date.parse(reference ?? "");
  if (Number.isNaN(candidateAt) || Number.isNaN(referenceAt)) return true;
  return candidateAt > referenceAt;
}

/**
 * Whether the stored precheck still describes this row as it is now. Checked in this order. One rule for the
 * ledgered batch approval (`evaluateLedgeredApproval`) and for the pending queue (`isPendingPrecheck`).
 *
 *   missing           no verdict or no time was recorded;
 *   base_url_changed  the precheck recorded another address, or none (pre-phase-3 / garbage notes): a precheck of
 *                     another address says nothing about this one, whatever its verdict;
 *   superseded        a failure (`last_failure_at`) or a governance change (`last_approval_reviewed_at`) came after it;
 *   stale             older than 14 days;
 *   needs_fix         a current, fresh verdict that is neither `ready` nor `empty`;
 *   usable            a fresh `ready`/`empty` precheck of the current address that nothing has overtaken.
 */
export function precheckEvidence(row: PrecheckEvidenceInput, now: Date): PrecheckEvidence {
  if (!row.liveHealthDisposition || !row.liveHealthReviewedAt) return "missing";
  const precheckedUrl = precheckBaseUrlFromNotes(row.liveHealthNotes);
  if (!precheckedUrl || precheckedUrl !== row.baseUrl) return "base_url_changed";
  if (
    isStrictlyLater(row.lastFailureAt, row.liveHealthReviewedAt) ||
    isStrictlyLater(row.lastApprovalReviewedAt, row.liveHealthReviewedAt)
  ) {
    return "superseded";
  }
  if (!isPrecheckFresh(row.liveHealthReviewedAt, now)) return "stale";
  if (row.liveHealthDisposition !== "ready" && row.liveHealthDisposition !== "empty") return "needs_fix";
  return "usable";
}

/**
 * A person's hold: `needs_review` written by a governance change (per-row Hold, batch hold) that no later
 * failure explains. A health demotion leaves `last_failure_at` later than `last_approval_reviewed_at`.
 *
 * The console reads a registered local row whose governance columns are NULL as `needs_review` with a null
 * `last_approval_reviewed_at`: such a row was never reviewed, so it is not held.
 */
export function isHeldByPerson(row: { approvalStatus: string | null; lastApprovalReviewedAt: string | null; lastFailureAt: string | null }): boolean {
  return (
    row.approvalStatus === "needs_review" &&
    row.lastApprovalReviewedAt !== null &&
    !isStrictlyLater(row.lastFailureAt, row.lastApprovalReviewedAt)
  );
}

export interface PendingCandidateRow {
  id: string;
  providerFamily: string | null;
  jurisdictionLevel: string | null;
  approvalStatus: string | null;
  isEnabled: boolean;
  baseUrl: string | null;
  liveHealthDisposition: string | null;
  liveHealthReviewedAt: string | null;
  liveHealthNotes: string | null;
  lastFailureAt: string | null;
  lastApprovalReviewedAt: string | null;
  precheckRequestedAt: string | null;
}

/** The evidence states a new precheck can resolve; `needs_fix` of the current address waits for a person's fix. */
const PENDING_EVIDENCE: ReadonlySet<PrecheckEvidence> = new Set<PrecheckEvidence>(["missing", "base_url_changed", "superseded", "stale"]);

/**
 * "Awaiting precheck and not already queued" — the rows the approval readiness puts in `awaiting_precheck`
 * (`ledgered-approval.ts`) that nobody has queued yet: local, enabled, not approved or blocked, not held by a
 * person, not queued, and whose stored precheck is missing, of another address, overtaken by a later failure or
 * governance change, or older than 14 days (`precheckEvidence`). A fresh `needs_fix` of the current address is
 * not pending: the source needs a person's fix, and prechecking it again would say the same.
 *
 * A NULL `approval_status` is read the way the console reads it for a local row (`needs_review`), so a governance
 * change recorded on such a row counts as the same hold the readiness shows.
 */
export function isPendingPrecheck(row: PendingCandidateRow, now: Date): boolean {
  return (
    LOCAL_JURISDICTION_LEVELS.includes(row.jurisdictionLevel ?? "") &&
    row.isEnabled &&
    (row.approvalStatus === null || row.approvalStatus === "needs_review") &&
    !isHeldByPerson({ ...row, approvalStatus: row.approvalStatus ?? "needs_review" }) &&
    row.precheckRequestedAt === null &&
    PENDING_EVIDENCE.has(precheckEvidence(row, now))
  );
}

function candidateFromDrizzle(row: typeof dataSources.$inferSelect): PendingCandidateRow {
  return {
    id: row.id,
    providerFamily: row.providerFamily ?? null,
    jurisdictionLevel: row.jurisdictionLevel ?? null,
    approvalStatus: row.approvalStatus ?? null,
    isEnabled: row.isEnabled === 1,
    baseUrl: row.baseUrl ?? null,
    liveHealthDisposition: row.liveHealthDisposition ?? null,
    liveHealthReviewedAt: row.liveHealthReviewedAt ?? null,
    liveHealthNotes: row.liveHealthNotes ?? null,
    lastFailureAt: row.lastFailureAt ?? null,
    lastApprovalReviewedAt: row.lastApprovalReviewedAt ?? null,
    precheckRequestedAt: row.precheckRequestedAt ?? null,
  };
}

export function selectPrecheckTargets(db: AppDatabase, input: RequestPrechecksInput, now: Date): string[] {
  if (input.sourceIds && input.sourceIds.length > 0) {
    return db
      .select({ id: dataSources.id })
      .from(dataSources)
      .where(and(inArray(dataSources.id, input.sourceIds), isNull(dataSources.precheckRequestedAt)))
      .orderBy(asc(dataSources.id))
      .all()
      .map((row) => row.id);
  }
  const rows = db
    .select()
    .from(dataSources)
    .where(
      and(
        eq(dataSources.providerFamily, input.providerFamily ?? ""),
        inArray(dataSources.jurisdictionLevel, [...LOCAL_JURISDICTION_LEVELS]),
        eq(dataSources.isEnabled, 1),
        or(isNull(dataSources.approvalStatus), eq(dataSources.approvalStatus, "needs_review")),
        isNull(dataSources.precheckRequestedAt),
      ),
    )
    .orderBy(asc(dataSources.id))
    .all();
  return rows.map(candidateFromDrizzle).filter((row) => isPendingPrecheck(row, now)).map((row) => row.id);
}

export interface RequestPrechecksResult {
  requestedCount: number;
  sourceIds: string[];
}

export function requestPrechecks(db: AppDatabase, input: RequestPrechecksInput, now: Date): RequestPrechecksResult {
  const ids = selectPrecheckTargets(db, input, now);
  if (ids.length > 0) {
    db.update(dataSources)
      .set({ precheckRequestedAt: now.toISOString(), updatedAt: now.toISOString() })
      .where(and(inArray(dataSources.id, ids), isNull(dataSources.precheckRequestedAt)))
      .run();
  }
  return { requestedCount: ids.length, sourceIds: ids };
}

interface MysqlCandidateRow {
  id: string;
  provider_family: string | null;
  jurisdiction_level: string | null;
  approval_status: string | null;
  is_enabled: number;
  base_url: string | null;
  live_health_disposition: string | null;
  live_health_reviewed_at: string | null;
  live_health_notes: string | null;
  last_failure_at: string | null;
  last_approval_reviewed_at: string | null;
  precheck_requested_at: string | null;
}

const MYSQL_CANDIDATE_COLUMNS = [
  "id", "provider_family", "jurisdiction_level", "approval_status", "is_enabled", "base_url", "live_health_disposition",
  "live_health_reviewed_at", "live_health_notes", "last_failure_at", "last_approval_reviewed_at", "precheck_requested_at",
].join(", ");

function candidateFromMysql(row: MysqlCandidateRow): PendingCandidateRow {
  return {
    id: row.id,
    providerFamily: row.provider_family ?? null,
    jurisdictionLevel: row.jurisdiction_level ?? null,
    approvalStatus: row.approval_status ?? null,
    isEnabled: row.is_enabled === 1,
    baseUrl: row.base_url ?? null,
    liveHealthDisposition: row.live_health_disposition ?? null,
    liveHealthReviewedAt: row.live_health_reviewed_at ?? null,
    liveHealthNotes: row.live_health_notes ?? null,
    lastFailureAt: row.last_failure_at ?? null,
    lastApprovalReviewedAt: row.last_approval_reviewed_at ?? null,
    precheckRequestedAt: row.precheck_requested_at ?? null,
  };
}

export async function selectPrecheckTargetsFromMysql(
  mysql: MysqlDataSourcesStore,
  input: RequestPrechecksInput,
  now: Date,
): Promise<string[]> {
  if (input.sourceIds && input.sourceIds.length > 0) {
    const ids = expandMysqlInClause(input.sourceIds);
    const rows = await mysqlSelectMany<{ id: string }>(
      mysql,
      `SELECT id FROM data_sources WHERE id IN (${ids.placeholders}) AND precheck_requested_at IS NULL ORDER BY id`,
      ids.values,
    );
    return rows.map((row) => row.id);
  }
  const levels = expandMysqlInClause(LOCAL_JURISDICTION_LEVELS);
  const rows = await mysqlSelectMany<MysqlCandidateRow>(
    mysql,
    `SELECT ${MYSQL_CANDIDATE_COLUMNS} FROM data_sources
      WHERE provider_family = ?
        AND jurisdiction_level IN (${levels.placeholders})
        AND is_enabled = 1
        AND (approval_status IS NULL OR approval_status = 'needs_review')
        AND precheck_requested_at IS NULL
      ORDER BY id`,
    [input.providerFamily ?? "", ...levels.values],
  );
  return rows
    .map(candidateFromMysql)
    .filter((row) => isPendingPrecheck(row, now))
    .map((row) => row.id);
}

export async function requestPrechecksFromMysql(
  mysql: MysqlDataSourcesStore,
  input: RequestPrechecksInput,
  now: Date,
): Promise<RequestPrechecksResult> {
  const ids = await selectPrecheckTargetsFromMysql(mysql, input, now);
  for (let start = 0; start < ids.length; start += 200) {
    const chunk = expandMysqlInClause(ids.slice(start, start + 200));
    await mysqlExecute(
      mysql,
      `UPDATE data_sources SET precheck_requested_at = ?, updated_at = ? WHERE id IN (${chunk.placeholders}) AND precheck_requested_at IS NULL`,
      [now.toISOString(), now.toISOString(), ...chunk.values],
    );
  }
  return { requestedCount: ids.length, sourceIds: ids };
}

export interface QueuedPrecheck {
  id: string;
  providerFamily: string | null;
  baseUrl: string | null;
  precheckRequestedAt: string;
}

export function listQueuedPrechecks(db: AppDatabase, limit = 200): QueuedPrecheck[] {
  return db
    .select({ id: dataSources.id, providerFamily: dataSources.providerFamily, baseUrl: dataSources.baseUrl, precheckRequestedAt: dataSources.precheckRequestedAt })
    .from(dataSources)
    .where(isNotNull(dataSources.precheckRequestedAt))
    .orderBy(asc(dataSources.precheckRequestedAt), asc(dataSources.id))
    .limit(limit)
    .all()
    .map((row) => ({ id: row.id, providerFamily: row.providerFamily ?? null, baseUrl: row.baseUrl ?? null, precheckRequestedAt: row.precheckRequestedAt as string }));
}

export async function listQueuedPrechecksFromMysql(mysql: MysqlDataSourcesStore, limit = 200): Promise<QueuedPrecheck[]> {
  const rows = await mysqlSelectMany<{ id: string; provider_family: string | null; base_url: string | null; precheck_requested_at: string }>(
    mysql,
    `SELECT id, provider_family, base_url, precheck_requested_at FROM data_sources
      WHERE precheck_requested_at IS NOT NULL ORDER BY precheck_requested_at ASC, id ASC LIMIT ${Math.max(1, Math.floor(limit))}`,
    [],
  );
  return rows.map((row) => ({ id: row.id, providerFamily: row.provider_family ?? null, baseUrl: row.base_url ?? null, precheckRequestedAt: row.precheck_requested_at }));
}

export function clearPrecheckRequest(db: AppDatabase, id: string, requestedAt: string): boolean {
  const result = db
    .update(dataSources)
    .set({ precheckRequestedAt: null })
    .where(and(eq(dataSources.id, id), eq(dataSources.precheckRequestedAt, requestedAt)))
    .run();
  return result.changes > 0;
}

export async function clearPrecheckRequestFromMysql(mysql: MysqlDataSourcesStore, id: string, requestedAt: string): Promise<boolean> {
  const result = await mysqlExecute(
    mysql,
    "UPDATE data_sources SET precheck_requested_at = NULL WHERE id = ? AND precheck_requested_at = ?",
    [id, requestedAt],
  );
  return result.affectedRows > 0;
}
