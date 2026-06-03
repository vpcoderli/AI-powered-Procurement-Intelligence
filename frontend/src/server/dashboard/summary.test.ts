import { describe, expect, it } from "vitest";
import type { Bid } from "@/server/bids/domain";
import type { BidListResponse, BidQuery, BidQueryOptions, SavedBidsResponse } from "@/server/bids/types";
import type { IntentSummary } from "@/server/intents/types";
import type { RiskChecklistReport } from "@/server/risk/checklist";
import { createDashboardSummary } from "./summary";

const baseBid: Bid = {
  id: "bid_1",
  title: "Cloud migration",
  source: "California",
  sourceUrl: "https://caleprocure.ca.gov/event/1",
  issuerName: "State Agency",
  issuerType: "state",
  stateCode: "CA",
  originalCategory: "IT",
  description: "Cloud migration services",
  fullDescription: "Cloud migration services",
  amount: "$100,000",
  publishedDate: "2026-05-30",
  deadlineDate: "2026-06-05",
  contactName: "Buyer",
  contactEmail: "buyer@example.com",
  contactPhone: "",
  attachments: [],
  tags: ["cloud"],
  sourceConfidence: "high",
  qualityFlags: [],
  adminReviewStatus: "approved",
  detailArchiveStatus: "available",
  detailArchivePath: "",
  detailFetchedAt: "",
  detailChecksumSha256: "",
  detailArchiveError: "",
  saved: false,
  isActive: true,
};

const intent = (id: string, status: IntentSummary["status"]): IntentSummary => ({
  id,
  userId: "user_1",
  bid: baseBid,
  status,
  generated: {
    aiBidBrief: "Brief",
    keyDates: {
      publishedDate: baseBid.publishedDate,
      deadlineDate: baseBid.deadlineDate,
    },
    initialChecklist: [],
    riskFlags: [],
  },
  match: {
    score: 88,
    verdict: "strong",
    reasons: [],
    gaps: [],
    scoring: {
      naics: 20,
      setAside: 15,
      location: 10,
      pastPerformance: 18,
      certifications: 10,
      capacity: 15,
    },
  },
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
});

function bidResponse(total: number): BidListResponse {
  return {
    bids: Array.from({ length: total }, (_, index) => ({ ...baseBid, id: `bid_${index + 1}` })),
    total,
    filters: {
      q: "",
      states: [],
      issuerType: "all",
      deadline: "any",
      published: "any",
      sort: "relevance",
    },
  };
}

const riskReport: RiskChecklistReport = {
  ok: false,
  checkedAt: "2026-06-02T00:00:00.000Z",
  checks: [
    {
      id: "state-coverage",
      label: "50 state data coverage",
      ok: true,
      summary: "50/50 required states have at least one active bid",
    },
    {
      id: "state-content",
      label: "State bid content is non-empty",
      ok: true,
      summary: "120 state bids checked for title, issuer, URL, state, and description",
    },
    {
      id: "attachment-downloads",
      label: "Attachments use safe non-404 download routes",
      ok: false,
      summary: "80 state attachments checked",
      details: ["bid_1: attachment SOW would return 404", "bid_2: attachment Pricing would return 404"],
    },
    {
      id: "state-url-validity",
      label: "State source and attachment URLs are production-like",
      ok: false,
      summary: "120 state bids checked for placeholder source URLs and unsafe attachment URLs",
      details: ["bid_3: sourceUrl placeholder_url"],
    },
  ],
};

describe("dashboard summary", () => {
  it("aggregates command-center briefs, notifications, pipeline, and data trust from existing services", async () => {
    const queryBids = async (query: BidQuery, _options?: BidQueryOptions) => {
      void _options;
      if (query.deadline === "next7") return bidResponse(4);
      if (query.published === "last7") return bidResponse(18);
      return bidResponse(42);
    };
    const listIntents = async () => [
      intent("intent_1", "intent_added"),
      intent("intent_2", "needs_review"),
      intent("intent_3", "questions_needed"),
      intent("intent_4", "pursuit_decision_needed"),
    ];
    const getSavedBids = async (): Promise<SavedBidsResponse> => ({
      savedBidIds: ["bid_1", "bid_2"],
      bids: [baseBid, { ...baseBid, id: "bid_2" }],
    });

    const summary = await createDashboardSummary(
      {},
      {
        userId: "user_1",
        role: "user",
        tier: "pro",
      },
      new Date("2026-06-02T00:00:00.000Z"),
      {
        queryBids,
        listIntents,
        getSavedBids,
        createRiskReport: async () => riskReport,
        listNotificationInsights: async () => ({
          failedNotifications: 0,
          pendingNotifications: 0,
          failedDigestRuns: 0,
          recentDigestMatches: 0,
        }),
        listPipelineInsights: async () => ({
          workspaceItems: 7,
          blockedItems: 2,
          openItems: 5,
          missingArtifactLinks: 3,
          readyPackages: 6,
          exportedPackages: 4,
        }),
      },
    );

    expect(summary.briefs).toMatchObject({
      newMatches: { value: 18 },
      dueSoon: { value: 4 },
      evidenceRisks: { value: 3 },
      readyPackages: { value: 6 },
    });
    expect(summary.pipeline).toEqual({
      saved: 2,
      intent: 4,
      qualifying: 2,
      ready: 6,
      blocked: 2,
      open: 5,
      missingArtifacts: 3,
      exported: 4,
    });
    expect(summary.dataTrust.stateCoverage.value).toBe("50/50");
    expect(summary.dataTrust.emptyRuns.value).toBe(0);
    expect(summary.dataTrust.evidence404.value).toBe(2);
    expect(summary.notifications[0]).toMatchObject({
      level: "critical",
      titleKey: "evidence_refresh_required",
      count: 3,
    });
    expect(summary.account).toMatchObject({ tier: "pro", role: "user" });
  });

  it("prioritizes real notification outbox and digest signals in the command-center inbox", async () => {
    const summary = await createDashboardSummary(
      {},
      {
        userId: "user_1",
        role: "user",
        tier: "business",
      },
      new Date("2026-06-02T00:00:00.000Z"),
      {
        queryBids: async () => bidResponse(0),
        listIntents: async () => [],
        getSavedBids: async () => ({ savedBidIds: [], bids: [] }),
        createRiskReport: async () => ({
          ok: true,
          checkedAt: "2026-06-02T00:00:00.000Z",
          checks: [
            {
              id: "state-coverage",
              label: "50 state data coverage",
              ok: true,
              summary: "50/50 required states have at least one active bid",
            },
            {
              id: "state-content",
              label: "State bid content is non-empty",
              ok: true,
              summary: "120 state bids checked for title, issuer, URL, state, and description",
            },
            {
              id: "attachment-downloads",
              label: "Attachments use safe non-404 download routes",
              ok: true,
              summary: "80 state attachments checked",
            },
          ],
        }),
        listNotificationInsights: async () => ({
          failedNotifications: 2,
          pendingNotifications: 3,
          failedDigestRuns: 1,
          recentDigestMatches: 9,
        }),
        listPipelineInsights: async () => ({
          workspaceItems: 0,
          blockedItems: 0,
          openItems: 0,
          missingArtifactLinks: 0,
          readyPackages: 0,
          exportedPackages: 0,
        }),
      },
    );

    expect(summary.notifications.map((notification) => notification.titleKey)).toEqual([
      "notification_delivery_failed",
      "notification_delivery_pending",
      "search_digest_failed",
      "search_digest_matches",
    ]);
    expect(summary.notifications.map((notification) => notification.count)).toEqual([2, 3, 1, 9]);
  });
});
