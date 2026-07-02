import { NextResponse } from "next/server";
import { db, type AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { resolveNotificationProviderConfig, NotificationProviderConfigError } from "@/server/notifications/provider";
import { logger } from "@/lib/observability/logger";
import { isSentryConfigured } from "@/lib/observability/sentry";

const healthLogger = logger.child({ service: "api:health" });

export interface HealthCheckResult {
  ok: boolean;
  status: "up" | "down";
  detail?: string;
}

export interface HealthResponseBody {
  status: "ok" | "degraded";
  uptimeSeconds: number;
  timestamp: string;
  checks: {
    database: HealthCheckResult & { engine: "mysql" | "sqlite" };
    notifications: HealthCheckResult & { provider?: string };
    errorTracking: { configured: boolean };
  };
}

interface MysqlPingable {
  query: (sql: string) => Promise<unknown>;
}

async function checkDatabase(dependencies?: {
  database?: AppDatabase;
  mysql?: MysqlPingable;
}): Promise<HealthResponseBody["checks"]["database"]> {
  const engine = isMysqlDatabaseUrlConfigured() ? "mysql" : "sqlite";

  try {
    if (engine === "mysql") {
      const mysql = dependencies?.mysql ?? resolveMysqlPool();
      await mysql.query("SELECT 1");
    } else {
      const database = dependencies?.database ?? db;
      database.$client.prepare("SELECT 1").get();
    }

    return { ok: true, status: "up", engine };
  } catch (error) {
    healthLogger.error("database_health_check_failed", { error, engine });
    return {
      ok: false,
      status: "down",
      engine,
      detail: error instanceof Error ? error.message : "Unknown database error",
    };
  }
}

function checkNotifications(): HealthResponseBody["checks"]["notifications"] {
  try {
    const config = resolveNotificationProviderConfig();
    return { ok: true, status: "up", provider: config.provider };
  } catch (error) {
    const detail =
      error instanceof NotificationProviderConfigError ? error.message : "Notification provider misconfigured";
    healthLogger.warn("notification_provider_health_check_failed", { detail });
    return { ok: false, status: "down", detail };
  }
}

export interface HealthDependencies {
  database?: AppDatabase;
  mysql?: MysqlPingable;
}

export function createHealthGet(dependencies?: HealthDependencies) {
  return async function GET() {
    const [databaseCheck, notificationsCheck] = await Promise.all([
      checkDatabase(dependencies),
      Promise.resolve(checkNotifications()),
    ]);

    const errorTracking = { configured: isSentryConfigured() };
    const allOk = databaseCheck.ok && notificationsCheck.ok;

    const body: HealthResponseBody = {
      status: allOk ? "ok" : "degraded",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      checks: {
        database: databaseCheck,
        notifications: notificationsCheck,
        errorTracking,
      },
    };

    if (!allOk) {
      healthLogger.warn("health_check_degraded", { body });
    }

    return NextResponse.json(body, { status: allOk ? 200 : 503 });
  };
}

export const GET = createHealthGet();
