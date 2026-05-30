import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { ensureUser } from "@/server/bids/repository";
import type { BidQuery } from "@/server/bids/types";
import type { AppDatabase } from "@/server/db/client";
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

export async function listSearchAlerts(db: AppDatabase, userId: string) {
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

export async function deleteSearchAlert(db: AppDatabase, userId: string, id: string) {
  await ensureUser(db, userId);

  if (!findOwnedAlert(db, userId, id)) {
    throw new SearchAlertNotFoundError();
  }

  db.delete(alerts)
    .where(and(eq(alerts.userId, userId), eq(alerts.id, id)))
    .run();
}
