import { and, desc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { expandMysqlInClause, mysqlExecute, mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";
import { searchAlertDigestRuns } from "@/server/db/schema";
import type {
  SearchAlertDigestRun,
  SearchAlertDigestRunInput,
  SearchAlertDigestSkippedReason,
} from "./types";

interface MysqlDigestHistoryStore {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute?: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

function parseBidIds(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function parseSkippedReason(value: string | null): SearchAlertDigestSkippedReason | null {
  if (
    value === "unsupported_channel" ||
    value === "missing_recipient" ||
    value === "notifications_disabled" ||
    value === "duplicate_digest"
  ) {
    return value;
  }

  return null;
}

function toDigestRun(row: typeof searchAlertDigestRuns.$inferSelect): SearchAlertDigestRun {
  return {
    id: row.id,
    alertId: row.alertId,
    userId: row.userId,
    frequency: row.frequency,
    status: row.status,
    matchCount: row.matchCount,
    notificationId: row.notificationId,
    skippedReason: parseSkippedReason(row.skippedReason),
    failureReason: row.failureReason,
    matchedBidIds: parseBidIds(row.matchedBidIdsJson),
    createdAt: row.createdAt,
  };
}

function toDigestRunFromMysql(row: {
  id: string;
  alertId: string;
  userId: string;
  frequency: string;
  status: string;
  matchCount: number | string;
  notificationId: string | null;
  skippedReason: string | null;
  failureReason: string | null;
  matchedBidIdsJson: string;
  createdAt: string;
}): SearchAlertDigestRun {
  return {
    id: row.id,
    alertId: row.alertId,
    userId: row.userId,
    frequency: row.frequency === "weekly" ? "weekly" : "daily",
    status:
      row.status === "sent" || row.status === "failed" || row.status === "skipped"
        ? row.status
        : "queued",
    matchCount: Number(row.matchCount),
    notificationId: row.notificationId,
    skippedReason: parseSkippedReason(row.skippedReason),
    failureReason: row.failureReason,
    matchedBidIds: parseBidIds(row.matchedBidIdsJson),
    createdAt: row.createdAt,
  };
}

export function recordSearchAlertDigestRun(
  db: AppDatabase,
  input: SearchAlertDigestRunInput,
): SearchAlertDigestRun {
  db.insert(searchAlertDigestRuns)
    .values({
      id: input.id,
      alertId: input.alertId,
      userId: input.userId,
      frequency: input.frequency,
      status: input.status,
      matchCount: input.matchCount,
      notificationId: input.notificationId ?? null,
      skippedReason: input.skippedReason ?? null,
      failureReason: input.failureReason ?? null,
      matchedBidIdsJson: JSON.stringify(input.matchedBidIds ?? []),
      createdAt: input.createdAt,
    })
    .run();

  return toDigestRun(
    db.select()
      .from(searchAlertDigestRuns)
      .where(eq(searchAlertDigestRuns.id, input.id))
      .get()!,
  );
}

export async function recordSearchAlertDigestRunFromMysql(
  mysql: MysqlDigestHistoryStore,
  input: SearchAlertDigestRunInput,
): Promise<SearchAlertDigestRun> {
  await mysqlExecute(
    mysql as Required<Pick<MysqlDigestHistoryStore, "execute">>,
    `
      INSERT INTO search_alert_digest_runs (
        id,
        alert_id,
        user_id,
        frequency,
        status,
        match_count,
        notification_id,
        skipped_reason,
        failure_reason,
        matched_bid_ids_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.id,
      input.alertId,
      input.userId,
      input.frequency,
      input.status,
      input.matchCount,
      input.notificationId ?? null,
      input.skippedReason ?? null,
      input.failureReason ?? null,
      JSON.stringify(input.matchedBidIds ?? []),
      input.createdAt,
    ],
  );

  const row = await mysqlSelectOne<Parameters<typeof toDigestRunFromMysql>[0]>(
    mysql,
    `
      SELECT
        id,
        alert_id AS alertId,
        user_id AS userId,
        frequency,
        status,
        match_count AS matchCount,
        notification_id AS notificationId,
        skipped_reason AS skippedReason,
        failure_reason AS failureReason,
        matched_bid_ids_json AS matchedBidIdsJson,
        created_at AS createdAt
      FROM search_alert_digest_runs
      WHERE id = ?
      LIMIT 1
    `,
    [input.id],
  );

  if (!row) {
    throw new Error("Failed to record search alert digest run");
  }

  return toDigestRunFromMysql(row);
}

export function listSearchAlertDigestRunsForUser(
  db: AppDatabase,
  userId: string,
  alertIds: string[],
  limitPerAlert = 3,
): Record<string, SearchAlertDigestRun[]> {
  if (alertIds.length === 0) return {};

  const limited = Math.max(1, Math.min(limitPerAlert, 10));
  const result: Record<string, SearchAlertDigestRun[]> = {};
  const rows = db.select()
    .from(searchAlertDigestRuns)
    .where(and(eq(searchAlertDigestRuns.userId, userId), inArray(searchAlertDigestRuns.alertId, alertIds)))
    .orderBy(desc(searchAlertDigestRuns.createdAt), desc(searchAlertDigestRuns.id))
    .all();

  for (const row of rows) {
    const current = result[row.alertId] ?? [];
    if (current.length >= limited) continue;
    result[row.alertId] = [...current, toDigestRun(row)];
  }

  return result;
}

export async function listSearchAlertDigestRunsForUserFromMysql(
  mysql: Pick<MysqlDigestHistoryStore, "query">,
  userId: string,
  alertIds: string[],
  limitPerAlert = 3,
): Promise<Record<string, SearchAlertDigestRun[]>> {
  if (alertIds.length === 0) return {};

  const limited = Math.max(1, Math.min(limitPerAlert, 10));
  const { placeholders, values } = expandMysqlInClause(alertIds);
  const rows = await mysqlSelectMany<Parameters<typeof toDigestRunFromMysql>[0]>(
    mysql,
    `
      SELECT
        id,
        alert_id AS alertId,
        user_id AS userId,
        frequency,
        status,
        match_count AS matchCount,
        notification_id AS notificationId,
        skipped_reason AS skippedReason,
        failure_reason AS failureReason,
        matched_bid_ids_json AS matchedBidIdsJson,
        created_at AS createdAt
      FROM search_alert_digest_runs
      WHERE user_id = ? AND alert_id IN (${placeholders})
      ORDER BY created_at DESC, id DESC
    `,
    [userId, ...values],
  );
  const result: Record<string, SearchAlertDigestRun[]> = {};

  for (const row of rows) {
    const current = result[row.alertId] ?? [];
    if (current.length >= limited) continue;
    result[row.alertId] = [...current, toDigestRunFromMysql(row)];
  }

  return result;
}
