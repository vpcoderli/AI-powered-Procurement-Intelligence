import { STATE_CRAWLER_SOURCES } from "@/lib/state-crawler-sources";
import type { AppDatabase } from "@/server/db/client";
import type { AccountTier, UserRole } from "@/server/auth/entitlements";
import type { BidQuery, BidQueryOptions, BidListResponse, SavedBidsResponse } from "@/server/bids/types";
import { getSavedBids, queryBidsFromDatabase } from "@/server/bids/service";
import {
  listDashboardNotificationInsightsForRuntime,
  type DashboardNotificationInsights,
} from "@/server/dashboard/notifications";
import {
  listDashboardPipelineInsightsForRuntime,
  type DashboardPipelineInsights,
} from "@/server/dashboard/pipeline";
import { listUserIntents } from "@/server/intents/service";
import type { IntentSummary } from "@/server/intents/types";
import { createRiskChecklistReport, type RiskChecklistReport } from "@/server/risk/checklist";

export type DashboardNotificationLevel = "critical" | "warning" | "info";
export type DashboardNotificationTitleKey =
  | "notification_delivery_failed"
  | "notification_delivery_pending"
  | "search_digest_failed"
  | "search_digest_matches"
  | "evidence_refresh_required"
  | "deadlines_due_soon"
  | "new_matches_available"
  | "source_health_clear";

export interface DashboardBriefItem {
  value: number;
}

export interface DashboardSummary {
  generatedAt: string;
  briefs: {
    newMatches: DashboardBriefItem;
    dueSoon: DashboardBriefItem;
    evidenceRisks: DashboardBriefItem;
    readyPackages: DashboardBriefItem;
  };
  notifications: Array<{
    id: string;
    level: DashboardNotificationLevel;
    titleKey: DashboardNotificationTitleKey;
    count: number;
  }>;
  pipeline: {
    saved: number;
    intent: number;
    qualifying: number;
    ready: number;
    blocked: number;
    open: number;
    missingArtifacts: number;
    exported: number;
  };
  dataTrust: {
    stateCoverage: {
      value: string;
      ok: boolean;
      summary: string;
    };
    emptyRuns: {
      value: number;
      ok: boolean;
      summary: string;
    };
    evidence404: {
      value: number;
      ok: boolean;
      summary: string;
    };
    requiredStateSources: number;
  };
  account: {
    tier: AccountTier;
    role: UserRole;
  };
}

export interface DashboardSummarySubject {
  userId: string;
  role: UserRole;
  tier: AccountTier;
}

export interface DashboardSummaryDependencies {
  queryBids?: (query: BidQuery, options?: BidQueryOptions) => Promise<BidListResponse>;
  listIntents?: () => Promise<IntentSummary[]>;
  getSavedBids?: () => Promise<SavedBidsResponse>;
  createRiskReport?: () => Promise<RiskChecklistReport>;
  listNotificationInsights?: () => Promise<DashboardNotificationInsights>;
  listPipelineInsights?: () => Promise<DashboardPipelineInsights>;
}

function checkById(report: RiskChecklistReport, id: string) {
  return report.checks.find((check) => check.id === id) ?? null;
}

function detailCount(report: RiskChecklistReport, ids: string[]) {
  return ids.reduce((total, id) => total + (checkById(report, id)?.details?.length ?? 0), 0);
}

function firstRatio(summary: string) {
  const match = summary.match(/\b(\d+\/\d+)\b/);
  return match?.[1] ?? "0/0";
}

function leadingNumber(summary: string) {
  const match = summary.match(/^(\d+)/);
  return match ? Number(match[1]) : 0;
}

function qualifyingIntentCount(intents: IntentSummary[]) {
  return intents.filter((intent) =>
    intent.status === "needs_review" ||
    intent.status === "questions_needed" ||
    intent.status === "sourcing_needed"
  ).length;
}

function buildNotifications(input: {
  insights: DashboardNotificationInsights;
  evidenceRiskCount: number;
  dueSoonCount: number;
  newMatchCount: number;
}) {
  const notifications: DashboardSummary["notifications"] = [];

  if (input.insights.failedNotifications > 0) {
    notifications.push({
      id: "notification-delivery-failed",
      level: "critical",
      titleKey: "notification_delivery_failed",
      count: input.insights.failedNotifications,
    });
  }

  if (input.insights.pendingNotifications > 0) {
    notifications.push({
      id: "notification-delivery-pending",
      level: "warning",
      titleKey: "notification_delivery_pending",
      count: input.insights.pendingNotifications,
    });
  }

  if (input.insights.failedDigestRuns > 0) {
    notifications.push({
      id: "search-digest-failed",
      level: "warning",
      titleKey: "search_digest_failed",
      count: input.insights.failedDigestRuns,
    });
  }

  if (input.insights.recentDigestMatches > 0) {
    notifications.push({
      id: "search-digest-matches",
      level: "info",
      titleKey: "search_digest_matches",
      count: input.insights.recentDigestMatches,
    });
  }

  if (input.evidenceRiskCount > 0) {
    notifications.push({
      id: "evidence-risks",
      level: "critical",
      titleKey: "evidence_refresh_required",
      count: input.evidenceRiskCount,
    });
  }

  if (input.dueSoonCount > 0) {
    notifications.push({
      id: "due-soon",
      level: "warning",
      titleKey: "deadlines_due_soon",
      count: input.dueSoonCount,
    });
  }

  if (input.newMatchCount > 0) {
    notifications.push({
      id: "new-matches",
      level: "info",
      titleKey: "new_matches_available",
      count: input.newMatchCount,
    });
  }

  if (notifications.length === 0) {
    notifications.push({
      id: "source-health-clear",
      level: "info",
      titleKey: "source_health_clear",
      count: 0,
    });
  }

  return notifications;
}

export async function createDashboardSummary(
  database: AppDatabase | unknown,
  subject: DashboardSummarySubject,
  now = new Date(),
  dependencies: DashboardSummaryDependencies = {},
): Promise<DashboardSummary> {
  const appDb = database as AppDatabase;
  const queryBids = dependencies.queryBids ?? ((query, options) => queryBidsFromDatabase(appDb, query, options));
  const listIntents = dependencies.listIntents ?? (() => listUserIntents(appDb, subject.userId));
  const savedBids = dependencies.getSavedBids ?? (() => getSavedBids(subject.userId));
  const createRiskReport = dependencies.createRiskReport ?? (() => createRiskChecklistReport(appDb, now));
  const listNotificationInsights = dependencies.listNotificationInsights
    ?? (() => listDashboardNotificationInsightsForRuntime(appDb, subject.userId));
  const listPipelineInsights = dependencies.listPipelineInsights
    ?? (() => listDashboardPipelineInsightsForRuntime(appDb, subject.userId));

  const [
    newMatchResponse,
    dueSoonResponse,
    intents,
    saved,
    riskReport,
    notificationInsights,
    pipelineInsights,
  ] = await Promise.all([
    queryBids({ published: "last7" }, { referenceDate: now }),
    queryBids({ deadline: "next7" }, { referenceDate: now }),
    listIntents(),
    savedBids(),
    createRiskReport(),
    listNotificationInsights(),
    listPipelineInsights(),
  ]);

  const attachment404Count = detailCount(riskReport, ["attachment-downloads"]);
  const evidenceRiskCount = detailCount(riskReport, [
    "attachment-downloads",
    "state-url-validity",
    "bid-detail-routes",
  ]);
  const stateCoverageCheck = checkById(riskReport, "state-coverage");
  const stateContentCheck = checkById(riskReport, "state-content");
  const attachmentCheck = checkById(riskReport, "attachment-downloads");

  return {
    generatedAt: now.toISOString(),
    briefs: {
      newMatches: { value: newMatchResponse.total },
      dueSoon: { value: dueSoonResponse.total },
      evidenceRisks: { value: evidenceRiskCount },
      readyPackages: { value: pipelineInsights.readyPackages },
    },
    notifications: buildNotifications({
      insights: notificationInsights,
      evidenceRiskCount,
      dueSoonCount: dueSoonResponse.total,
      newMatchCount: newMatchResponse.total,
    }),
    pipeline: {
      saved: saved.savedBidIds.length,
      intent: intents.length,
      qualifying: qualifyingIntentCount(intents),
      ready: pipelineInsights.readyPackages,
      blocked: pipelineInsights.blockedItems,
      open: pipelineInsights.openItems,
      missingArtifacts: pipelineInsights.missingArtifactLinks,
      exported: pipelineInsights.exportedPackages,
    },
    dataTrust: {
      stateCoverage: {
        value: firstRatio(stateCoverageCheck?.summary ?? ""),
        ok: stateCoverageCheck?.ok ?? false,
        summary: stateCoverageCheck?.summary ?? "State coverage has not been checked.",
      },
      emptyRuns: {
        value: stateContentCheck?.ok ? 0 : leadingNumber(stateContentCheck?.summary ?? ""),
        ok: stateContentCheck?.ok ?? false,
        summary: stateContentCheck?.summary ?? "State content health has not been checked.",
      },
      evidence404: {
        value: attachment404Count,
        ok: attachmentCheck?.ok ?? false,
        summary: attachmentCheck?.summary ?? "Attachment download health has not been checked.",
      },
      requiredStateSources: new Set(STATE_CRAWLER_SOURCES.map((source) => source.stateCode)).size,
    },
    account: {
      role: subject.role,
      tier: subject.tier,
    },
  };
}
