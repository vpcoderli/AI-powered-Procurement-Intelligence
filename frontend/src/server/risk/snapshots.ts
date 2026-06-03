import { randomUUID } from "node:crypto";
import { desc } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { riskCheckSnapshots } from "@/server/db/schema";
import type { RiskChecklistReport } from "./checklist";

export interface RiskChecklistSnapshot {
  id: string;
  ok: boolean;
  checkedAt: string;
  createdAt: string;
  report: RiskChecklistReport;
}

export interface RiskChecklistTrend {
  snapshotCount: number;
  globalUrlAllPassing: boolean | null;
  stateCoverageDeclined: boolean | null;
  attachmentDownloadCountChanged: boolean | null;
  latestGlobalUrlSummary: string | null;
  latestStateCoverageSummary: string | null;
  latestAttachmentSummary: string | null;
}

function checkById(report: RiskChecklistReport, id: string) {
  return report.checks.find((check) => check.id === id) ?? null;
}

function leadingCount(value: string | undefined) {
  if (!value) return null;
  const match = value.match(/^(\d+)/);
  return match ? Number(match[1]) : null;
}

function parseReport(value: string): RiskChecklistReport {
  const parsed = JSON.parse(value) as RiskChecklistReport;
  return parsed;
}

function hydrateSnapshot(row: typeof riskCheckSnapshots.$inferSelect): RiskChecklistSnapshot {
  return {
    id: row.id,
    ok: row.ok === 1,
    checkedAt: row.checkedAt,
    createdAt: row.createdAt,
    report: parseReport(row.reportJson),
  };
}

export function recordRiskChecklistSnapshot(
  db: AppDatabase,
  report: RiskChecklistReport,
  createdAt = new Date().toISOString(),
) {
  const row = {
    id: `risk_snapshot_${randomUUID()}`,
    ok: report.ok ? 1 : 0,
    checkedAt: report.checkedAt,
    reportJson: JSON.stringify(report),
    createdAt,
  } satisfies typeof riskCheckSnapshots.$inferInsert;

  db.insert(riskCheckSnapshots).values(row).run();

  return hydrateSnapshot(row);
}

export function listRiskChecklistSnapshots(db: AppDatabase, limit = 5) {
  return db.select()
    .from(riskCheckSnapshots)
    .orderBy(desc(riskCheckSnapshots.checkedAt), desc(riskCheckSnapshots.createdAt))
    .limit(limit)
    .all()
    .map(hydrateSnapshot);
}

export function summarizeRiskChecklistTrend(history: RiskChecklistSnapshot[]): RiskChecklistTrend {
  const latest = history[0] ?? null;
  const oldest = history.at(-1) ?? null;
  const latestGlobalUrl = latest ? checkById(latest.report, "global-url-validity") : null;
  const latestStateCoverage = latest ? checkById(latest.report, "state-coverage") : null;
  const latestAttachment = latest ? checkById(latest.report, "attachment-downloads") : null;
  const oldestStateCoverage = oldest ? checkById(oldest.report, "state-coverage") : null;
  const oldestAttachment = oldest ? checkById(oldest.report, "attachment-downloads") : null;
  const latestStateCount = leadingCount(latestStateCoverage?.summary);
  const oldestStateCount = leadingCount(oldestStateCoverage?.summary);
  const latestAttachmentCount = leadingCount(latestAttachment?.summary);
  const oldestAttachmentCount = leadingCount(oldestAttachment?.summary);

  return {
    snapshotCount: history.length,
    globalUrlAllPassing: history.length > 0
      ? history.every((snapshot) => checkById(snapshot.report, "global-url-validity")?.ok === true)
      : null,
    stateCoverageDeclined: latestStateCount !== null && oldestStateCount !== null
      ? latestStateCount < oldestStateCount
      : null,
    attachmentDownloadCountChanged: latestAttachmentCount !== null && oldestAttachmentCount !== null
      ? latestAttachmentCount !== oldestAttachmentCount
      : null,
    latestGlobalUrlSummary: latestGlobalUrl?.summary ?? null,
    latestStateCoverageSummary: latestStateCoverage?.summary ?? null,
    latestAttachmentSummary: latestAttachment?.summary ?? null,
  };
}
