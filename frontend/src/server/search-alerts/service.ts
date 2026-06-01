import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { ensureUser } from "@/server/bids/repository";
import type { BidQuery } from "@/server/bids/types";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { alerts } from "@/server/db/schema";
import type {
  CreateSearchAlertInput,
  SearchAlert,
  UpdateSearchAlertInput,
} from "./types";
import { SearchAlertNotFoundError } from "./types";
import { listSearchAlertDigestRunsForUser } from "./digest-history";

function nowIso() {
  return new Date().toISOString();
}

function serializeQuery(query: BidQuery) {
  return JSON.stringify(query);
}

function serializeStates(states: string[] | undefined) {
  return JSON.stringify(states ?? []);
}

function parseStoredQuery(value: string | null): BidQuery {
  if (!value) return {};

  try {
    const parsed: unknown = JSON.parse(value);

    if (typeof parsed === "object" && parsed !== null) {
      const query = parsed as BidQuery;
      return {
        ...(typeof query.q === "string" ? { q: query.q } : {}),
        ...(Array.isArray(query.states) && query.states.every((item) => typeof item === "string")
          ? { states: query.states }
          : {}),
        ...(query.issuerType === "all" || query.issuerType === "federal" || query.issuerType === "state"
          ? { issuerType: query.issuerType }
          : {}),
        ...(query.deadline === "any" || query.deadline === "next7" || query.deadline === "next30"
          ? { deadline: query.deadline }
          : {}),
        ...(query.published === "any" || query.published === "last24" || query.published === "last7"
          ? { published: query.published }
          : {}),
        ...(query.sort === "relevance" || query.sort === "newest" || query.sort === "deadline"
          ? { sort: query.sort }
          : {}),
      };
    }
  } catch {
    return { q: value };
  }

  return { q: value };
}

function parseStates(value: string | null) {
  if (!value) return [];

  try {
    const parsed: unknown = JSON.parse(value);

    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    return [];
  }

  return [];
}

interface MysqlSearchAlertsReader {
  query: (sql: string, values?: unknown[]) => Promise<[MysqlSearchAlertRow[]] | [MysqlSearchAlertRow[], unknown]>;
}

interface MysqlSearchAlertRow {
  id: string;
  userId: string;
  name: string;
  query: string | null;
  states: string | null;
  issuerType: string | null;
  deadlinePreset: string | null;
  publishedPreset: string | null;
  frequency: string;
  isEnabled: number | string | boolean;
  lastMatchedAt: string | null;
  lastNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toSearchAlert(row: typeof alerts.$inferSelect): SearchAlert {
  const storedQuery = parseStoredQuery(row.query);
  const query: BidQuery = {
    q: storedQuery.q ?? "",
    states: storedQuery.states ?? parseStates(row.states),
    issuerType:
      storedQuery.issuerType ??
      (row.issuerType === "federal" || row.issuerType === "state" ? row.issuerType : "all"),
    deadline:
      storedQuery.deadline ??
      (row.deadlinePreset === "next7" || row.deadlinePreset === "next30"
        ? row.deadlinePreset
        : "any"),
    published:
      storedQuery.published ??
      (row.publishedPreset === "last24" || row.publishedPreset === "last7"
        ? row.publishedPreset
        : "any"),
    sort: storedQuery.sort ?? "relevance",
  };

  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    query,
    frequency: row.frequency === "weekly" ? "weekly" : "daily",
    isEnabled: row.isEnabled === 1,
    lastMatchedAt: row.lastMatchedAt,
    lastNotifiedAt: row.lastNotifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSearchAlertFromMysql(row: MysqlSearchAlertRow): SearchAlert {
  const storedQuery = parseStoredQuery(row.query);
  const query: BidQuery = {
    q: storedQuery.q ?? "",
    states: storedQuery.states ?? parseStates(row.states),
    issuerType:
      storedQuery.issuerType ??
      (row.issuerType === "federal" || row.issuerType === "state" ? row.issuerType : "all"),
    deadline:
      storedQuery.deadline ??
      (row.deadlinePreset === "next7" || row.deadlinePreset === "next30" ? row.deadlinePreset : "any"),
    published:
      storedQuery.published ??
      (row.publishedPreset === "last24" || row.publishedPreset === "last7" ? row.publishedPreset : "any"),
    sort: storedQuery.sort ?? "relevance",
  };

  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    query,
    frequency: row.frequency === "weekly" ? "weekly" : "daily",
    isEnabled: row.isEnabled === true || row.isEnabled === 1 || row.isEnabled === "1",
    lastMatchedAt: row.lastMatchedAt,
    lastNotifiedAt: row.lastNotifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function executeSearchAlertWrite(mysql: MysqlSearchAlertsReader, sql: string, values: unknown[]) {
  const executable = mysql as MysqlSearchAlertsReader & {
    execute?: (sql: string, values?: unknown[]) => Promise<unknown>;
  };

  if (executable.execute) {
    await executable.execute(sql, values);
    return;
  }

  await mysql.query(sql, values);
}

async function ensureSearchAlertMysqlUser(mysql: MysqlSearchAlertsReader, userId: string) {
  await executeSearchAlertWrite(
    mysql,
    `
      INSERT INTO users (id, role, account_tier, is_disabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE id = id
    `,
    [userId, "user", "free", 0, nowIso(), nowIso()],
  );
}

function mysqlAlertSelectSql(whereClause: string) {
  return `
    SELECT
      id,
      user_id AS userId,
      name,
      query,
      states,
      issuer_type AS issuerType,
      deadline_preset AS deadlinePreset,
      published_preset AS publishedPreset,
      frequency,
      is_enabled AS isEnabled,
      last_matched_at AS lastMatchedAt,
      last_notified_at AS lastNotifiedAt,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM alerts
    ${whereClause}
  `;
}

async function findOwnedAlertFromMysql(mysql: MysqlSearchAlertsReader, userId: string, id: string) {
  const [rows] = await mysql.query(
    `${mysqlAlertSelectSql("WHERE user_id = ? AND id = ?")}
     LIMIT 1`,
    [userId, id],
  );

  return rows[0];
}

function findOwnedAlert(db: AppDatabase, userId: string, id: string) {
  return db
    .select()
    .from(alerts)
    .where(and(eq(alerts.userId, userId), eq(alerts.id, id)))
    .limit(1)
    .get();
}

export async function createSearchAlert(
  db: AppDatabase,
  userId: string,
  input: CreateSearchAlertInput,
) {
  if (isMysqlDatabaseUrlConfigured()) {
    return createSearchAlertFromMysql(resolveMysqlPool(), userId, input);
  }

  await ensureUser(db, userId);

  const timestamp = nowIso();
  const id = `alert_${randomUUID()}`;

  db.insert(alerts)
    .values({
      id,
      userId,
      name: input.name,
      query: serializeQuery(input.query),
      states: serializeStates(input.query.states),
      issuerType: input.query.issuerType ?? "all",
      deadlinePreset: input.query.deadline ?? "any",
      publishedPreset: input.query.published ?? "any",
      frequency: input.frequency,
      isEnabled: input.isEnabled ? 1 : 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  const created = findOwnedAlert(db, userId, id);

  if (!created) {
    throw new SearchAlertNotFoundError();
  }

  return toSearchAlert(created);
}

export async function createSearchAlertFromMysql(
  mysql: MysqlSearchAlertsReader,
  userId: string,
  input: CreateSearchAlertInput,
) {
  await ensureSearchAlertMysqlUser(mysql, userId);

  const timestamp = nowIso();
  const id = `alert_${randomUUID()}`;
  await executeSearchAlertWrite(
    mysql,
    `
      INSERT INTO alerts (
        id,
        user_id,
        name,
        query,
        states,
        issuer_type,
        deadline_preset,
        published_preset,
        frequency,
        is_enabled,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      userId,
      input.name,
      serializeQuery(input.query),
      serializeStates(input.query.states),
      input.query.issuerType ?? "all",
      input.query.deadline ?? "any",
      input.query.published ?? "any",
      input.frequency,
      input.isEnabled ? 1 : 0,
      timestamp,
      timestamp,
    ],
  );

  const created = await findOwnedAlertFromMysql(mysql, userId, id);
  if (!created) {
    throw new SearchAlertNotFoundError();
  }

  return toSearchAlertFromMysql(created);
}

export async function listSearchAlerts(db: AppDatabase, userId: string) {
  if (isMysqlDatabaseUrlConfigured()) {
    return listSearchAlertsFromMysql(resolveMysqlPool(), userId);
  }

  await ensureUser(db, userId);

  const userAlerts = db
    .select()
    .from(alerts)
    .where(eq(alerts.userId, userId))
    .orderBy(asc(alerts.createdAt), asc(alerts.id))
    .all()
    .map(toSearchAlert);
  const historyByAlertId = listSearchAlertDigestRunsForUser(
    db,
    userId,
    userAlerts.map((alert) => alert.id),
    3,
  );

  return userAlerts.map((alert) => ({
    ...alert,
    digestHistory: historyByAlertId[alert.id] ?? [],
  }));
}

export async function listSearchAlertsFromMysql(mysql: MysqlSearchAlertsReader, userId: string) {
  await ensureSearchAlertMysqlUser(mysql, userId);

  const [rows] = await mysql.query(
    `${mysqlAlertSelectSql("WHERE user_id = ?")}
     ORDER BY created_at ASC, id ASC`,
    [userId],
  );

  return rows.map((row) => ({ ...toSearchAlertFromMysql(row), digestHistory: [] }));
}

function withDigestHistory(db: AppDatabase, userId: string, alert: SearchAlert) {
  const historyByAlertId = listSearchAlertDigestRunsForUser(db, userId, [alert.id], 3);

  return {
    ...alert,
    digestHistory: historyByAlertId[alert.id] ?? [],
  };
}

export async function updateSearchAlert(
  db: AppDatabase,
  userId: string,
  id: string,
  input: UpdateSearchAlertInput,
) {
  if (isMysqlDatabaseUrlConfigured()) {
    return updateSearchAlertFromMysql(resolveMysqlPool(), userId, id, input);
  }

  await ensureUser(db, userId);

  if (!findOwnedAlert(db, userId, id)) {
    throw new SearchAlertNotFoundError();
  }

  db.update(alerts)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.query !== undefined
        ? {
            query: serializeQuery(input.query),
            states: serializeStates(input.query.states),
            issuerType: input.query.issuerType ?? "all",
            deadlinePreset: input.query.deadline ?? "any",
            publishedPreset: input.query.published ?? "any",
          }
        : {}),
      ...(input.frequency !== undefined ? { frequency: input.frequency } : {}),
      ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled ? 1 : 0 } : {}),
      updatedAt: nowIso(),
    })
    .where(and(eq(alerts.userId, userId), eq(alerts.id, id)))
    .run();

  const updated = findOwnedAlert(db, userId, id);

  if (!updated) {
    throw new SearchAlertNotFoundError();
  }

  return withDigestHistory(db, userId, toSearchAlert(updated));
}

export async function updateSearchAlertFromMysql(
  mysql: MysqlSearchAlertsReader,
  userId: string,
  id: string,
  input: UpdateSearchAlertInput,
) {
  await ensureSearchAlertMysqlUser(mysql, userId);

  const existing = await findOwnedAlertFromMysql(mysql, userId, id);
  if (!existing) {
    throw new SearchAlertNotFoundError();
  }

  const existingAlert = toSearchAlertFromMysql(existing);
  const nextQuery = input.query ?? existingAlert.query;
  await executeSearchAlertWrite(
    mysql,
    `
      UPDATE alerts
      SET
        name = ?,
        query = ?,
        states = ?,
        issuer_type = ?,
        deadline_preset = ?,
        published_preset = ?,
        is_enabled = ?,
        updated_at = ?
      WHERE user_id = ? AND id = ?
    `,
    [
      input.name ?? existingAlert.name,
      serializeQuery(nextQuery),
      serializeStates(nextQuery.states),
      nextQuery.issuerType ?? "all",
      nextQuery.deadline ?? "any",
      nextQuery.published ?? "any",
      (input.isEnabled ?? existingAlert.isEnabled) ? 1 : 0,
      nowIso(),
      userId,
      id,
    ],
  );

  const updated = await findOwnedAlertFromMysql(mysql, userId, id);
  if (!updated) {
    throw new SearchAlertNotFoundError();
  }

  return { ...toSearchAlertFromMysql(updated), digestHistory: [] };
}

export async function deleteSearchAlert(db: AppDatabase, userId: string, id: string) {
  if (isMysqlDatabaseUrlConfigured()) {
    return deleteSearchAlertFromMysql(resolveMysqlPool(), userId, id);
  }

  await ensureUser(db, userId);

  if (!findOwnedAlert(db, userId, id)) {
    throw new SearchAlertNotFoundError();
  }

  db.delete(alerts)
    .where(and(eq(alerts.userId, userId), eq(alerts.id, id)))
    .run();
}

export async function deleteSearchAlertFromMysql(
  mysql: MysqlSearchAlertsReader,
  userId: string,
  id: string,
) {
  await ensureSearchAlertMysqlUser(mysql, userId);

  if (!(await findOwnedAlertFromMysql(mysql, userId, id))) {
    throw new SearchAlertNotFoundError();
  }

  await executeSearchAlertWrite(mysql, "DELETE FROM alerts WHERE user_id = ? AND id = ?", [userId, id]);
}
