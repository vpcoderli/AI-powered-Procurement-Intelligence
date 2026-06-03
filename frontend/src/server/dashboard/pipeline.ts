import { desc, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { mysqlSelectMany } from "@/server/db/mysql-runtime";
import {
  responsePackageExports,
  responsePackageSnapshots,
  responseWorkspaceItems,
} from "@/server/db/schema";

export interface DashboardPipelineInsights {
  workspaceItems: number;
  blockedItems: number;
  openItems: number;
  missingArtifactLinks: number;
  readyPackages: number;
  exportedPackages: number;
}

interface MysqlDashboardPipelineReader {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
}

interface PipelineSnapshotRow {
  readinessJson: string;
}

interface PipelineExportRow {
  status: string;
}

interface PipelineWorkspaceItemRow {
  status: string;
}

function parseReadiness(readinessJson: string) {
  try {
    const value = JSON.parse(readinessJson) as Record<string, unknown>;
    return {
      ready: value.ready === true,
      blockedItems: Number(value.blockedItems ?? 0),
      openItems: Number(value.openItems ?? 0),
      missingArtifactLinks: Number(value.missingArtifactLinks ?? 0),
    };
  } catch {
    return {
      ready: false,
      blockedItems: 0,
      openItems: 0,
      missingArtifactLinks: 0,
    };
  }
}

function summarizePipelineRows(input: {
  workspaceItems: PipelineWorkspaceItemRow[];
  snapshots: PipelineSnapshotRow[];
  exports: PipelineExportRow[];
}): DashboardPipelineInsights {
  const snapshotReadiness = input.snapshots.map((snapshot) => parseReadiness(snapshot.readinessJson));
  const blockedWorkspaceItems = input.workspaceItems.filter((item) => item.status === "blocked").length;

  return {
    workspaceItems: input.workspaceItems.length,
    blockedItems: blockedWorkspaceItems + snapshotReadiness.reduce((total, readiness) => total + readiness.blockedItems, 0),
    openItems: snapshotReadiness.reduce((total, readiness) => total + readiness.openItems, 0),
    missingArtifactLinks: snapshotReadiness.reduce((total, readiness) => total + readiness.missingArtifactLinks, 0),
    readyPackages: snapshotReadiness.filter((readiness) => readiness.ready).length,
    exportedPackages: input.exports.filter((exportRow) => exportRow.status === "ready").length,
  };
}

export function listDashboardPipelineInsights(db: AppDatabase, userId: string): DashboardPipelineInsights {
  if (isMysqlDatabaseUrlConfigured()) {
    throw new Error("Use listDashboardPipelineInsightsFromMysql in MySQL runtime.");
  }

  const workspaceItems = db
    .select({ status: responseWorkspaceItems.status })
    .from(responseWorkspaceItems)
    .where(eq(responseWorkspaceItems.userId, userId))
    .all();
  const snapshots = db
    .select({ readinessJson: responsePackageSnapshots.readinessJson })
    .from(responsePackageSnapshots)
    .where(eq(responsePackageSnapshots.userId, userId))
    .orderBy(desc(responsePackageSnapshots.createdAt), desc(responsePackageSnapshots.id))
    .all();
  const exports = db
    .select({ status: responsePackageExports.status })
    .from(responsePackageExports)
    .where(eq(responsePackageExports.userId, userId))
    .all();

  return summarizePipelineRows({ workspaceItems, snapshots, exports });
}

export async function listDashboardPipelineInsightsFromMysql(
  mysql: MysqlDashboardPipelineReader,
  userId: string,
): Promise<DashboardPipelineInsights> {
  const [workspaceItems, snapshots, exports] = await Promise.all([
    mysqlSelectMany<PipelineWorkspaceItemRow>(
      mysql,
      "SELECT status FROM response_workspace_items WHERE user_id = ?",
      [userId],
    ),
    mysqlSelectMany<PipelineSnapshotRow>(
      mysql,
      `
        SELECT readiness_json AS readinessJson
        FROM response_package_snapshots
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
      `,
      [userId],
    ),
    mysqlSelectMany<PipelineExportRow>(
      mysql,
      "SELECT status FROM response_package_exports WHERE user_id = ?",
      [userId],
    ),
  ]);

  return summarizePipelineRows({ workspaceItems, snapshots, exports });
}

export async function listDashboardPipelineInsightsForRuntime(
  db: AppDatabase,
  userId: string,
): Promise<DashboardPipelineInsights> {
  if (isMysqlDatabaseUrlConfigured()) {
    return listDashboardPipelineInsightsFromMysql(resolveMysqlPool(), userId);
  }

  return listDashboardPipelineInsights(db, userId);
}
