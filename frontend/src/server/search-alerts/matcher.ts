import { eq } from "drizzle-orm";
import type { Bid } from "@/server/bids/domain";
import { queryBidsFromDatabase } from "@/server/bids/service";
import type { BidQuery } from "@/server/bids/types";
import type { AppDatabase } from "@/server/db/client";
import { alerts } from "@/server/db/schema";
import type { MatchedAlertNotification } from "@/server/notifications/types";
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

function toNotificationBidSummary(bid: Bid) {
  return {
    id: bid.id,
    title: bid.title,
    issuerName: bid.issuerName,
    sourceUrl: bid.sourceUrl,
    deadlineDate: bid.deadlineDate,
  };
}

function notificationFrequency(value: string) {
  return value === "weekly" ? "weekly" : "daily";
}

function notificationChannel(value: string) {
  return value === "email" ? "email" : "email";
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
