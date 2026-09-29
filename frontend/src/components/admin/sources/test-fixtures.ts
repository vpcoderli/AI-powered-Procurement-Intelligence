import type { AdminDataSource, AdminDataSourceDetail } from "@/lib/api/admin";

/** A county row of the source registry with every optional field empty; tests override what they read. */
export function adminSourceFixture(overrides: Partial<AdminDataSource> = {}): AdminDataSource {
  return {
    id: "bidnet_co_denver", label: "City and County of Denver", issuerType: "county", stateCode: "CO", baseUrl: "https://www.bidnetdirect.com/colorado/denver",
    isEnabled: true, cadence: "daily", fetchConfig: {}, jurisdictionLevel: "county", jurisdictionName: "Denver County", fipsCode: "08031",
    lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0, crawlerSourceId: null, crawlerAdapterKind: "none", crawlerMaturity: "none",
    crawlerCapabilities: [], crawlerBaseUrl: null, sourceAuthority: null, trustStatus: null, evidenceMode: null, validityNotes: null,
    providerFamily: "bidnet", accessMode: "public", sourceType: "portal", sourceConfidence: "unknown", activationStatus: "inactive",
    requiresBrowser: false, requiresManual: false, requiresLogin: false, supportsQuery: false, supportsPagination: false,
    supportsAttachmentMetadata: false, supportsDetailPageFetch: false, fallbackNotes: null, approvedForIngestion: false,
    approvalStatus: "needs_review", accessPattern: "public_http", legalReviewStatus: "not_reviewed", sourceOwner: "", approvalNotes: null,
    lastApprovalReviewedAt: null, liveHealthOwner: null, liveHealthDisposition: null, liveHealthNextReviewAt: null, liveHealthNotes: null,
    liveHealthReviewedAt: null, precheckRequestedAt: null, robotsTxtStatus: null, robotsTxtCheckedAt: null, robotsTxtHash: null,
    robotsTxtDisallowsCrawledPaths: null, robotsTxtFlagReason: null, tosReviewed: null, tosReviewedAt: null, tosUrl: null,
    complianceReviewer: null, legalOpinionReference: null, complianceReviewDueAt: null, complianceNotes: null,
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", latestLog: null, latestLiveHealth: null,
    sourceHealthTrend: null, approvalHistory: [],
    ...overrides,
  };
}

export function adminSourceDetailFixture(
  source: AdminDataSource = adminSourceFixture(),
  overrides: Partial<Omit<AdminDataSourceDetail, "source">> = {},
): AdminDataSourceDetail {
  return {
    source,
    logSourceKeys: [source.id, source.label],
    states: { level: "county", platform: "bidnet", approval: "awaiting", health: "never_run" },
    readiness: null,
    bids: { counts: { open: 0, closed: 0, awarded: 0, total: 0 }, latest: [] },
    ...overrides,
  };
}
