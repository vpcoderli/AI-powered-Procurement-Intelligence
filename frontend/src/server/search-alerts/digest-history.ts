import { and, desc, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { searchAlertDigestRuns } from "@/server/db/schema";
import type {
  SearchAlertDigestRun,
  SearchAlertDigestRunInput,
  SearchAlertDigestSkippedReason,
} from "./types";

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
