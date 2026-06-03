import { eq } from "drizzle-orm";
import type { Bid } from "@/server/bids/domain";
import type { MysqlBidsReader } from "@/server/bids/repository";
import { queryBidsFromDatabase, queryBidsFromMysql } from "@/server/bids/service";
import type { BidQuery } from "@/server/bids/types";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectMany } from "@/server/db/mysql-runtime";
import { alerts } from "@/server/db/schema";
import type {
  MatchedAlertNotification,
  NotificationChannel,
  NotificationFrequency,
} from "@/server/notifications/types";
import { toSearchAlert } from "./service";

export interface SearchAlertMatchOptions {
  referenceDate?: Date;
  matchedAt?: string;
}

export interface SearchAlertMatchResult {
  evaluatedAlerts: number;
  matchedAlerts: number;
  updatedAlerts: number;
  matches: MatchedAlertNotification[];
}

interface MysqlSearchAlertMatchStore {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

interface MysqlEnabledAlertRow {
  id: string;
  userId: string;
  name: string;
  query: string | null;
  states: string | null;
  issuerType: string | null;
  deadlinePreset: string | null;
  publishedPreset: string | null;
  frequency: string;
  notificationChannel: string;
}

function toNotificationBidSummary(bid: Bid) {
  return {
    id: bid.id,
    title: bid.title,
    issuerName: bid.issuerName,
    sourceUrl: bid.sourceUrl,
    deadlineDate: bid.deadlineDate,
  };
}

function notificationFrequency(value: string): NotificationFrequency {
  return value === "weekly" ? "weekly" : "daily";
}

function notificationChannel(value: string): NotificationChannel {
  return value === "email" ? "email" : "email";
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
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function queryFromMysqlAlert(row: MysqlEnabledAlertRow): BidQuery {
  const storedQuery = parseStoredQuery(row.query);

  return {
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
}

export async function matchEnabledSearchAlerts(
  db: AppDatabase,
  options: SearchAlertMatchOptions = {},
): Promise<SearchAlertMatchResult> {
  const matchedAt = options.matchedAt ?? new Date().toISOString();
  const rows = db.select().from(alerts).where(eq(alerts.isEnabled, 1)).all();
  let matchedAlerts = 0;
  let updatedAlerts = 0;
  const matches: MatchedAlertNotification[] = [];

  for (const row of rows) {
    const alert = toSearchAlert(row);
    const result = await queryBidsFromDatabase(db, alert.query, {
      referenceDate: options.referenceDate,
    });

    if (result.total > 0) {
      matchedAlerts += 1;
      matches.push({
        alertId: row.id,
        userId: row.userId,
        alertName: row.name,
        frequency: notificationFrequency(row.frequency),
        notificationChannel: notificationChannel(row.notificationChannel),
        bidIds: result.bids.map((bid) => bid.id),
        bids: result.bids.map(toNotificationBidSummary),
        query: alert.query as BidQuery,
      });
      db.update(alerts)
        .set({
          lastMatchedAt: matchedAt,
          updatedAt: matchedAt,
        })
        .where(eq(alerts.id, row.id))
        .run();
      updatedAlerts += 1;
    }
  }

  return {
    evaluatedAlerts: rows.length,
    matchedAlerts,
    updatedAlerts,
    matches,
  };
}

export async function matchEnabledSearchAlertsFromMysql(
  mysql: MysqlSearchAlertMatchStore,
  options: SearchAlertMatchOptions = {},
): Promise<SearchAlertMatchResult> {
  const matchedAt = options.matchedAt ?? new Date().toISOString();
  const rows = await mysqlSelectMany<MysqlEnabledAlertRow>(
    mysql,
    `
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
        notification_channel AS notificationChannel
      FROM alerts
      WHERE is_enabled = 1
      ORDER BY created_at ASC, id ASC
    `,
  );
  let matchedAlerts = 0;
  let updatedAlerts = 0;
  const matches: MatchedAlertNotification[] = [];

  for (const row of rows) {
    const query = queryFromMysqlAlert(row);
    const result = await queryBidsFromMysql(mysql as unknown as MysqlBidsReader, query, {
      referenceDate: options.referenceDate,
    });

    if (result.total > 0) {
      matchedAlerts += 1;
      matches.push({
        alertId: row.id,
        userId: row.userId,
        alertName: row.name,
        frequency: notificationFrequency(row.frequency),
        notificationChannel: notificationChannel(row.notificationChannel),
        bidIds: result.bids.map((bid) => bid.id),
        bids: result.bids.map(toNotificationBidSummary),
        query,
      });
      await mysqlExecute(
        mysql,
        "UPDATE alerts SET last_matched_at = ?, updated_at = ? WHERE id = ?",
        [matchedAt, matchedAt, row.id],
      );
      updatedAlerts += 1;
    }
  }

  return {
    evaluatedAlerts: rows.length,
    matchedAlerts,
    updatedAlerts,
    matches,
  };
}
