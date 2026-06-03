import { desc, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";
import { notificationOutbox, searchAlertDigestRuns } from "@/server/db/schema";

export interface DashboardNotificationInsights {
  failedNotifications: number;
  pendingNotifications: number;
  failedDigestRuns: number;
  recentDigestMatches: number;
}

interface MysqlDashboardNotificationReader {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
}

export function listDashboardNotificationInsights(
  db: AppDatabase,
  userId: string,
  options: { digestLimit?: number } = {},
): DashboardNotificationInsights {
  if (isMysqlDatabaseUrlConfigured()) {
    throw new Error("Use listDashboardNotificationInsightsFromMysql in MySQL runtime.");
  }

  const digestLimit = Math.max(1, Math.min(options.digestLimit ?? 10, 50));
  const notifications = db
    .select()
    .from(notificationOutbox)
    .where(eq(notificationOutbox.userId, userId))
    .all();
  const digestRuns = db
    .select()
    .from(searchAlertDigestRuns)
    .where(eq(searchAlertDigestRuns.userId, userId))
    .orderBy(desc(searchAlertDigestRuns.createdAt), desc(searchAlertDigestRuns.id))
    .limit(digestLimit)
    .all();

  return {
    failedNotifications: notifications.filter((row) => row.status === "failed").length,
    pendingNotifications: notifications.filter((row) => row.status === "pending").length,
    failedDigestRuns: digestRuns.filter((row) => row.status === "failed").length,
    recentDigestMatches: digestRuns
      .filter((row) => row.status === "sent")
      .reduce((total, row) => total + row.matchCount, 0),
  };
}

export async function listDashboardNotificationInsightsFromMysql(
  mysql: MysqlDashboardNotificationReader,
  userId: string,
  options: { digestLimit?: number } = {},
): Promise<DashboardNotificationInsights> {
  const digestLimit = Math.max(1, Math.min(options.digestLimit ?? 10, 50));
  const counts = await mysqlSelectOne<{
    failedNotifications: number | string;
    pendingNotifications: number | string;
  }>(
    mysql,
    `
      SELECT
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failedNotifications,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingNotifications
      FROM notification_outbox
      WHERE user_id = ?
    `,
    [userId],
  );
  const digestRuns = await mysqlSelectMany<{ status: string; matchCount: number | string }>(
    mysql,
    `
      SELECT status, match_count AS matchCount
      FROM search_alert_digest_runs
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    [userId, digestLimit],
  );

  return {
    failedNotifications: Number(counts?.failedNotifications ?? 0),
    pendingNotifications: Number(counts?.pendingNotifications ?? 0),
    failedDigestRuns: digestRuns.filter((row) => row.status === "failed").length,
    recentDigestMatches: digestRuns
      .filter((row) => row.status === "sent")
      .reduce((total, row) => total + Number(row.matchCount), 0),
  };
}

export async function listDashboardNotificationInsightsForRuntime(
  db: AppDatabase,
  userId: string,
): Promise<DashboardNotificationInsights> {
  if (isMysqlDatabaseUrlConfigured()) {
    return listDashboardNotificationInsightsFromMysql(resolveMysqlPool(), userId);
  }

  return listDashboardNotificationInsights(db, userId);
}
