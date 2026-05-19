import { eq } from "drizzle-orm";
import { queryBidsFromDatabase } from "@/server/bids/service";
import type { AppDatabase } from "@/server/db/client";
import { alerts } from "@/server/db/schema";
import { toSearchAlert } from "./service";

export interface SearchAlertMatchOptions {
  referenceDate?: Date;
  matchedAt?: string;
}

export interface SearchAlertMatchResult {
  evaluatedAlerts: number;
  matchedAlerts: number;
  updatedAlerts: number;
}

export async function matchEnabledSearchAlerts(
  db: AppDatabase,
  options: SearchAlertMatchOptions = {},
): Promise<SearchAlertMatchResult> {
  const matchedAt = options.matchedAt ?? new Date().toISOString();
  const rows = db.select().from(alerts).where(eq(alerts.isEnabled, 1)).all();
  let matchedAlerts = 0;
  let updatedAlerts = 0;

  for (const row of rows) {
    const alert = toSearchAlert(row);
    const result = await queryBidsFromDatabase(db, alert.query, {
      referenceDate: options.referenceDate,
    });

    if (result.total > 0) {
      matchedAlerts += 1;
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
  };
}
