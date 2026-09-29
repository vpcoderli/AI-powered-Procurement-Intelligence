import { and, asc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { expandMysqlInClause, mysqlExecute, mysqlSelectMany } from "@/server/db/mysql-runtime";
import { dataSources } from "@/server/db/schema";
import type { MysqlDataSourcesStore } from "./data-sources-repository";

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

export interface PendingCandidateRow {
  id: string;
  providerFamily: string | null;
  jurisdictionLevel: string | null;
  approvalStatus: string | null;
  isEnabled: boolean;
  liveHealthReviewedAt: string | null;
  precheckRequestedAt: string | null;
}

/** "Awaiting precheck" (plan Global Constraints): local, enabled, not approved/blocked, not queued, no fresh precheck. */
export function isPendingPrecheck(row: PendingCandidateRow, now: Date): boolean {
  return (
    LOCAL_JURISDICTION_LEVELS.includes(row.jurisdictionLevel ?? "") &&
    row.isEnabled &&
    (row.approvalStatus === null || row.approvalStatus === "needs_review") &&
    row.precheckRequestedAt === null &&
    !isPrecheckFresh(row.liveHealthReviewedAt, now)
  );
}

function candidateFromDrizzle(row: typeof dataSources.$inferSelect): PendingCandidateRow {
  return {
    id: row.id,
    providerFamily: row.providerFamily ?? null,
    jurisdictionLevel: row.jurisdictionLevel ?? null,
    approvalStatus: row.approvalStatus ?? null,
    isEnabled: row.isEnabled === 1,
    liveHealthReviewedAt: row.liveHealthReviewedAt ?? null,
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
  live_health_reviewed_at: string | null;
  precheck_requested_at: string | null;
}

const MYSQL_CANDIDATE_COLUMNS = "id, provider_family, jurisdiction_level, approval_status, is_enabled, live_health_reviewed_at, precheck_requested_at";

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
    .map((row) => ({
      id: row.id,
      providerFamily: row.provider_family,
      jurisdictionLevel: row.jurisdiction_level,
      approvalStatus: row.approval_status,
      isEnabled: row.is_enabled === 1,
      liveHealthReviewedAt: row.live_health_reviewed_at,
      precheckRequestedAt: row.precheck_requested_at,
    }))
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
