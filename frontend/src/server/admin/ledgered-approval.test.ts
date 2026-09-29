import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDatabase } from "@/server/db/client";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import { recordSourceFailure } from "@/server/crawler/source-health-repository";
import { listAdminDataSources, recordSourcePrecheck, updateAdminDataSource, type AdminDataSource } from "./data-sources-repository";
import { PLATFORM_ACCESS_BOUNDARY, createPlatformReview, listPlatformReviews, validatePlatformReviewInput, type EffectivePlatformReview, type PlatformReview } from "./platform-reviews-repository";
import { isHeldByPerson } from "./precheck-queue";
import {
  approveSourcesWithLedger,
  evaluateLedgeredApproval,
  ledgeredApprovalInput,
  readinessBucket,
  summarizeApprovalReadiness,
  type ApprovalReadinessBucket,
  type LedgeredApprovalReason,
} from "./ledgered-approval";

const NOW = new Date("2026-09-29T08:00:00.000Z");
const FRESH = "2026-09-25T00:00:00.000Z";
const STALE = "2026-09-01T00:00:00.000Z";
const URL_A = "https://www.bidnetdirect.com/mitn/a/solicitations/open-bids";
// A row's life after its precheck at FRESH, all inside the 14-day window.
const OLD_APPROVAL = "2026-09-20T00:00:00.000Z"; // before the precheck
const APPROVED_AT = "2026-09-26T00:00:00.000Z";
const HELD_AT = "2026-09-26T12:00:00.000Z";
const FAILED_AT = "2026-09-27T00:00:00.000Z";
const REPRECHECKED = "2026-09-28T00:00:00.000Z";

function review(overrides: Partial<PlatformReview> = {}): PlatformReview {
  return { id: "prv_1", providerFamily: "bidnet", tosUrl: "https://www.bidnetdirect.com/tsandcs", tosReviewedAt: "2026-09-29", robotsUrl: "https://www.bidnetdirect.com/robots.txt", robotsCheckedAt: "2026-09-29T07:00:00.000Z", robotsSummary: "ok", accessBoundary: PLATFORM_ACCESS_BOUNDARY, reviewer: "apsi.lily@gmail.com", legalOpinionReference: "LEGAL-42", reviewedAt: "2026-09-29T08:00:00.000Z", nextReviewAt: "2027-09-29", notes: null, createdBy: null, createdAt: "2026-09-29T08:00:00.000Z", ...overrides };
}
const VALID: EffectivePlatformReview = { status: "valid", review: review() };
const EXPIRED: EffectivePlatformReview = { status: "expired", review: review({ nextReviewAt: "2026-01-01" }) };
const VALID_WITHOUT_LEGAL_REFERENCE: EffectivePlatformReview = { status: "valid", review: review({ legalOpinionReference: null }) };

function notes(baseUrl: string | null, verdict = "empty") {
  return JSON.stringify({ precheck: { baseUrl, verdict } });
}

function source(overrides: Partial<AdminDataSource> = {}): AdminDataSource {
  return {
    id: "bidnet_mi_a", label: "A", issuerType: "county", stateCode: "MI", baseUrl: URL_A, isEnabled: true, cadence: "daily", fetchConfig: {},
    jurisdictionLevel: "county", jurisdictionName: "A County", fipsCode: null, lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0,
    crawlerSourceId: null, crawlerAdapterKind: "none", crawlerMaturity: "none", crawlerCapabilities: [], crawlerBaseUrl: null,
    sourceAuthority: null, trustStatus: null, evidenceMode: null, validityNotes: null, providerFamily: "bidnet", accessMode: "public",
    sourceType: "portal", sourceConfidence: "unknown", activationStatus: "inactive", requiresBrowser: false, requiresManual: false,
    requiresLogin: false, supportsQuery: false, supportsPagination: false, supportsAttachmentMetadata: false, supportsDetailPageFetch: false,
    fallbackNotes: null, approvedForIngestion: false, approvalStatus: "needs_review", accessPattern: "public_http", legalReviewStatus: "not_reviewed",
    sourceOwner: "", approvalNotes: null, lastApprovalReviewedAt: null, liveHealthOwner: null, liveHealthDisposition: "empty",
    liveHealthNextReviewAt: null, liveHealthNotes: notes(URL_A), liveHealthReviewedAt: FRESH, precheckRequestedAt: null,
    robotsTxtStatus: "clear", robotsTxtCheckedAt: FRESH, robotsTxtHash: null, robotsTxtDisallowsCrawledPaths: false, robotsTxtFlagReason: null,
    tosReviewed: null, tosReviewedAt: null, tosUrl: null, complianceReviewer: null, legalOpinionReference: null, complianceReviewDueAt: null,
    complianceNotes: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), latestLog: null, latestLiveHealth: null,
    sourceHealthTrend: null, approvalHistory: [],
    ...overrides,
  };
}

describe("evaluateLedgeredApproval", () => {
  it.each([
    ["eligible", {}, VALID, true, null],
    ["state source", { jurisdictionLevel: "state" }, VALID, false, "not_local"],
    ["already approved", { approvalStatus: "approved" }, VALID, false, "already_approved"],
    ["blocked", { approvalStatus: "blocked" }, VALID, false, "blocked"],
    ["no review", {}, undefined, false, "missing_platform_review"],
    ["expired review", {}, EXPIRED, false, "platform_review_expired"],
    ["never prechecked", { liveHealthDisposition: null, liveHealthReviewedAt: null }, VALID, false, "precheck_missing"],
    ["needs_fix", { liveHealthDisposition: "needs_fix" }, VALID, false, "precheck_needs_fix"],
    ["stale", { liveHealthReviewedAt: STALE }, VALID, false, "precheck_stale"],
    ["base_url moved", { baseUrl: "https://www.bidnetdirect.com/mitn/a2/solicitations/open-bids" }, VALID, false, "base_url_changed"],
    ["pre-phase-3 notes", { liveHealthNotes: JSON.stringify({ precheck: { verdict: "empty" } }) }, VALID, false, "base_url_changed"],
  ])("%s", (_label, overrides, effective, eligible, reason) => {
    const evaluation = evaluateLedgeredApproval(source(overrides as Partial<AdminDataSource>), effective, NOW);
    expect(evaluation.eligible).toBe(eligible);
    expect(evaluation.reason).toBe(reason);
  });
});

describe("evaluateLedgeredApproval: holds, demotions, the queue, disabled and login-gated rows (final review I1, M3, M8)", () => {
  const OLD_ADDRESS = "https://www.bidnetdirect.com/mitn/a-old/solicitations/open-bids";

  it.each<[string, Partial<AdminDataSource>, EffectivePlatformReview, LedgeredApprovalReason | null, ApprovalReadinessBucket]>([
    ["held: needs_review written by a governance change after the precheck", { lastApprovalReviewedAt: HELD_AT }, VALID, "held", "blocked"],
    ["held: a precheck newer than the hold does not lift it", { lastApprovalReviewedAt: HELD_AT, liveHealthReviewedAt: REPRECHECKED }, VALID, "held", "blocked"],
    ["demoted: an old approval, then a failure after the precheck", { lastApprovalReviewedAt: OLD_APPROVAL, lastFailureAt: FAILED_AT }, VALID, "precheck_superseded", "awaiting_precheck"],
    ["demoted: approved on this precheck, then a failure", { lastApprovalReviewedAt: APPROVED_AT, lastFailureAt: FAILED_AT }, VALID, "precheck_superseded", "awaiting_precheck"],
    ["demoted, then prechecked again after the failure", { lastApprovalReviewedAt: APPROVED_AT, lastFailureAt: FAILED_AT, liveHealthReviewedAt: REPRECHECKED }, VALID, null, "approvable"],
    ["registered row: NULL governance shown as needs_review with no review time, fresh ready precheck", { liveHealthDisposition: "ready", liveHealthNotes: notes(URL_A, "ready") }, VALID, null, "approvable"],
    ["re-queued: someone asked for a new precheck", { precheckRequestedAt: "2026-09-29T07:00:00.000Z" }, VALID, "precheck_queued", "awaiting_precheck"],
    ["disabled", { isEnabled: false }, VALID, "disabled", "blocked"],
    ["login-gated, under a review without a legal opinion reference", { requiresLogin: true }, VALID_WITHOUT_LEGAL_REFERENCE, "login_requirements_unmet", "blocked"],
    ["login-gated, under a review with a legal opinion reference", { requiresLogin: true }, VALID, null, "approvable"],
    ["a fresh needs_fix of the current address", { liveHealthDisposition: "needs_fix", liveHealthNotes: notes(URL_A, "needs_fix") }, VALID, "precheck_needs_fix", "needs_fix"],
    ["a fresh needs_fix of the old address, after a person fixed base_url", { liveHealthDisposition: "needs_fix", liveHealthNotes: notes(OLD_ADDRESS, "needs_fix"), baseUrl: URL_A }, VALID, "base_url_changed", "awaiting_precheck"],
    ["a stale needs_fix", { liveHealthDisposition: "needs_fix", liveHealthNotes: notes(URL_A, "needs_fix"), liveHealthReviewedAt: STALE }, VALID, "precheck_stale", "awaiting_precheck"],
  ])("%s", (_label, overrides, effective, reason, bucket) => {
    const evaluation = evaluateLedgeredApproval(source(overrides), effective, NOW);
    expect(evaluation.reason).toBe(reason);
    expect(evaluation.eligible).toBe(reason === null);
    expect(readinessBucket(evaluation)).toBe(bucket);
  });

  it("checks in order: blocked, held, disabled, the review, login requirements, the queue, then the precheck evidence", () => {
    const reasonOf = (overrides: Partial<AdminDataSource>, effective: EffectivePlatformReview | undefined) =>
      evaluateLedgeredApproval(source(overrides), effective, NOW).reason;
    const queued = "2026-09-29T07:00:00.000Z";

    expect(reasonOf({ approvalStatus: "blocked", lastApprovalReviewedAt: HELD_AT }, VALID)).toBe("blocked");
    expect(reasonOf({ lastApprovalReviewedAt: HELD_AT, isEnabled: false }, undefined)).toBe("held");
    expect(reasonOf({ isEnabled: false }, undefined)).toBe("disabled");
    expect(reasonOf({ requiresLogin: true, precheckRequestedAt: queued }, undefined)).toBe("missing_platform_review");
    expect(reasonOf({ requiresLogin: true, precheckRequestedAt: queued }, VALID_WITHOUT_LEGAL_REFERENCE)).toBe("login_requirements_unmet");
    expect(reasonOf({ precheckRequestedAt: queued, liveHealthDisposition: null, liveHealthReviewedAt: null }, VALID)).toBe("precheck_queued");
    expect(reasonOf({ precheckRequestedAt: queued, lastApprovalReviewedAt: OLD_APPROVAL, lastFailureAt: FAILED_AT }, VALID)).toBe("precheck_queued");
  });

  it("maps every reason to a console bucket", () => {
    const expected: Record<LedgeredApprovalReason, ApprovalReadinessBucket> = {
      not_local: "awaiting_precheck", // never bucketed in practice: the summary skips non-local sources
      already_approved: "approved",
      blocked: "blocked",
      held: "blocked",
      disabled: "blocked",
      login_requirements_unmet: "blocked",
      missing_platform_review: "missing_platform_review",
      platform_review_expired: "missing_platform_review",
      precheck_needs_fix: "needs_fix",
      precheck_queued: "awaiting_precheck",
      precheck_superseded: "awaiting_precheck",
      precheck_missing: "awaiting_precheck",
      precheck_stale: "awaiting_precheck",
      base_url_changed: "awaiting_precheck",
    };
    for (const [reason, bucket] of Object.entries(expected)) {
      expect(readinessBucket({ eligible: false, reason: reason as LedgeredApprovalReason, review: null }), reason).toBe(bucket);
    }
  });
});

describe("ledgeredApprovalInput / readinessBucket", () => {
  it("copies the ledger from the platform review and writes the spec's note", () => {
    expect(ledgeredApprovalInput(source(), review())).toEqual({
      approvalStatus: "approved", approvedForIngestion: true, isEnabled: true, legalReviewStatus: "approved_public",
      complianceReviewer: "apsi.lily@gmail.com", tosUrl: "https://www.bidnetdirect.com/tsandcs", tosReviewed: true, tosReviewedAt: "2026-09-29",
      legalOpinionReference: "LEGAL-42", complianceReviewDueAt: "2027-09-29",
      approvalNotes: `依据平台审查 #prv_1；预检 empty @${FRESH}`,
    });
  });

  it("maps reasons to console buckets", () => {
    expect(readinessBucket({ eligible: true, reason: null, review: review() })).toBe("approvable");
    expect(readinessBucket({ eligible: false, reason: "precheck_stale", review: review() })).toBe("awaiting_precheck");
    expect(readinessBucket({ eligible: false, reason: "base_url_changed", review: review() })).toBe("awaiting_precheck");
    expect(readinessBucket({ eligible: false, reason: "precheck_needs_fix", review: review() })).toBe("needs_fix");
    expect(readinessBucket({ eligible: false, reason: "platform_review_expired", review: review() })).toBe("missing_platform_review");
    expect(readinessBucket({ eligible: false, reason: "already_approved", review: null })).toBe("approved");
  });

  it("summarizes local sources of one family", () => {
    const summary = summarizeApprovalReadiness(
      [source(), source({ id: "b", liveHealthDisposition: "needs_fix" }), source({ id: "c", providerFamily: "bonfire" }), source({ id: "s", jurisdictionLevel: "state" })],
      [review()], NOW, "bidnet",
    );
    expect(summary.counts).toEqual({ approvable: 1, awaiting_precheck: 0, needs_fix: 1, missing_platform_review: 0, approved: 0, blocked: 0 });
    expect(summary.sources.map((entry) => entry.id)).toEqual(["bidnet_mi_a", "b"]);
    expect(summary.platformReview?.status).toBe("valid");
  });
});

describe("summarizeApprovalReadiness (all platforms)", () => {
  it("counts approved and blocked sources, keeps every platform when none is named, and reports no platform review", () => {
    const summary = summarizeApprovalReadiness(
      [
        source({ id: "ok" }),
        source({ id: "done", approvalStatus: "approved" }),
        source({ id: "held", approvalStatus: "blocked" }),
        source({ id: "other", providerFamily: "bonfire" }),
        source({ id: "expired_family", providerFamily: "periscope" }),
      ],
      [review(), review({ id: "prv_2", providerFamily: "periscope", nextReviewAt: "2026-01-01" })],
      NOW,
      null,
    );

    expect(summary.providerFamily).toBeNull();
    expect(summary.platformReview).toBeNull();
    expect(summary.counts).toEqual({ approvable: 1, awaiting_precheck: 0, needs_fix: 0, missing_platform_review: 2, approved: 1, blocked: 1 });
    expect(summary.sources.map((entry) => [entry.id, entry.bucket, entry.reason])).toEqual([
      ["ok", "approvable", null],
      ["done", "approved", "already_approved"],
      ["held", "blocked", "blocked"],
      ["other", "missing_platform_review", "missing_platform_review"],
      ["expired_family", "missing_platform_review", "platform_review_expired"],
    ]);
  });

  it("reports the named platform as missing when it has no review at all, and an empty list for a platform without sources", () => {
    const summary = summarizeApprovalReadiness([source()], [review()], NOW, "granicus");

    expect(summary.platformReview).toEqual({ status: "missing", review: null });
    expect(summary.sources).toEqual([]);
    expect(summary.counts).toEqual({ approvable: 0, awaiting_precheck: 0, needs_fix: 0, missing_platform_review: 0, approved: 0, blocked: 0 });
  });
});

describe("summarizeApprovalReadiness (base_url and the tenant probe's suggestion)", () => {
  const SUGGESTION = "https://www.bidnetdirect.com/colorado/laramiecountywyominggovernment";
  const OLD_URL = "https://www.bidnetdirect.com/wyoming/laramie-county/solicitations/open-bids";

  function entriesById(sources: AdminDataSource[]) {
    const summary = summarizeApprovalReadiness(sources, [review()], NOW, "bidnet");
    return Object.fromEntries(summary.sources.map((entry) => [entry.id, entry]));
  }

  it("lists the row's current base_url and the suggestion the stored precheck notes carry for a needs_fix source", () => {
    const entries = entriesById([
      source({
        id: "fix",
        baseUrl: OLD_URL,
        liveHealthDisposition: "needs_fix",
        liveHealthNotes: JSON.stringify({ precheck: { baseUrl: OLD_URL, verdict: "needs_fix", suggestedBaseUrl: SUGGESTION } }),
      }),
    ]);

    expect(entries.fix).toMatchObject({
      bucket: "needs_fix",
      reason: "precheck_needs_fix",
      baseUrl: OLD_URL,
      suggestedBaseUrl: SUGGESTION,
    });
  });

  it("has no suggestion for a source whose precheck recorded none, for legacy or garbage notes, or for no notes at all", () => {
    const entries = entriesById([
      source({ id: "ok" }),
      source({ id: "explicit_null", liveHealthDisposition: "needs_fix", liveHealthNotes: JSON.stringify({ precheck: { baseUrl: URL_A, verdict: "needs_fix", suggestedBaseUrl: null } }) }),
      source({ id: "legacy", liveHealthDisposition: "needs_fix", liveHealthNotes: JSON.stringify({ precheck: { verdict: "needs_fix" } }) }),
      source({ id: "garbage", liveHealthDisposition: "needs_fix", liveHealthNotes: "operator note, not json" }),
      source({ id: "never", baseUrl: null, liveHealthDisposition: null, liveHealthNotes: null, liveHealthReviewedAt: null }),
    ]);

    expect(Object.values(entries).map((entry) => [entry.id, entry.baseUrl, entry.suggestedBaseUrl])).toEqual([
      ["ok", URL_A, null],
      ["explicit_null", URL_A, null],
      ["legacy", URL_A, null],
      ["garbage", URL_A, null],
      ["never", null, null],
    ]);
  });

  it("only reports the suggestion: the entry keeps the row's own address and the bucket is unaffected", () => {
    const entries = entriesById([
      source({ id: "fix", liveHealthDisposition: "needs_fix", liveHealthNotes: JSON.stringify({ precheck: { baseUrl: URL_A, verdict: "needs_fix", suggestedBaseUrl: SUGGESTION } }) }),
    ]);

    expect(entries.fix.baseUrl).toBe(URL_A);
    expect(entries.fix.baseUrl).not.toBe(entries.fix.suggestedBaseUrl);
    expect(entries.fix.bucket).toBe("needs_fix");
  });
});

describe("approveSourcesWithLedger (SQLite)", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    const base = { issuerType: "county", stateCode: "MI", providerFamily: "bidnet", jurisdictionLevel: "county", isEnabled: 1, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
    testDb.db.insert(dataSources).values([
      { ...base, id: "bidnet_mi_a", label: "A", baseUrl: URL_A, liveHealthDisposition: "empty", liveHealthReviewedAt: FRESH, liveHealthNotes: notes(URL_A) },
      { ...base, id: "bidnet_mi_b", label: "B", baseUrl: "https://x/b", liveHealthDisposition: "needs_fix", liveHealthReviewedAt: FRESH, liveHealthNotes: notes("https://x/b") },
      { ...base, id: "state_mi", label: "MI", issuerType: "state", jurisdictionLevel: "state", providerFamily: null },
    ]).run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("approves eligible local sources with the ledger, skips the rest with reasons, keeps the generic path for state sources", async () => {
    createPlatformReview(testDb.db, validatePlatformReviewInput({ providerFamily: "bidnet", tosUrl: "https://www.bidnetdirect.com/tsandcs", tosReviewedAt: "2026-09-29", robotsUrl: "https://www.bidnetdirect.com/robots.txt", robotsCheckedAt: "2026-09-29T07:00:00.000Z", robotsSummary: "ok", reviewer: "apsi.lily@gmail.com", nextReviewAt: "2027-09-29" }, NOW), { now: NOW });
    const generic = { approvedForIngestion: true, approvalStatus: "approved", legalReviewStatus: "approved_public", approvalNotes: "generic" } as const;

    const outcomes = await approveSourcesWithLedger({ database: testDb.db }, ["bidnet_mi_a", "bidnet_mi_b", "state_mi", "ghost"], { actorUserId: null, now: NOW, genericInput: generic });

    expect(outcomes.map((entry) => [entry.sourceId, entry.outcome, entry.reason])).toEqual([
      ["bidnet_mi_a", "approved", null], ["bidnet_mi_b", "skipped", "precheck_needs_fix"], ["state_mi", "approved", null], ["ghost", "not_found", null],
    ]);
    const a = testDb.db.select().from(dataSources).all().find((row) => row.id === "bidnet_mi_a");
    expect(a).toMatchObject({ approvalStatus: "approved", approvedForIngestion: 1, isEnabled: 1, legalReviewStatus: "approved_public", complianceReviewer: "apsi.lily@gmail.com", tosUrl: "https://www.bidnetdirect.com/tsandcs", tosReviewed: 1, complianceReviewDueAt: "2027-09-29" });
    expect(a?.approvalNotes).toMatch(/^依据平台审查 #prv_/);
    const b = testDb.db.select().from(dataSources).all().find((row) => row.id === "bidnet_mi_b");
    expect(b?.approvalStatus).toBeNull();
    const events = testDb.db.$client.prepare("SELECT source_id FROM source_approval_events ORDER BY source_id").all() as { source_id: string }[];
    expect(events.map((event) => event.source_id)).toEqual(["bidnet_mi_a", "state_mi"]);
  });

  it("never repoints a needs_fix source to the tenant probe's suggestion: it stays unapproved and keeps its base_url", async () => {
    const suggestion = "https://www.bidnetdirect.com/mitn/b-county/solicitations/open-bids";
    testDb.db.$client
      .prepare("UPDATE data_sources SET live_health_notes = ? WHERE id = 'bidnet_mi_b'")
      .run(JSON.stringify({ precheck: { baseUrl: "https://x/b", verdict: "needs_fix", suggestedBaseUrl: suggestion } }));
    createPlatformReview(testDb.db, validatePlatformReviewInput({ providerFamily: "bidnet", tosUrl: "https://www.bidnetdirect.com/tsandcs", tosReviewedAt: "2026-09-29", robotsUrl: "https://www.bidnetdirect.com/robots.txt", robotsCheckedAt: "2026-09-29T07:00:00.000Z", robotsSummary: "ok", reviewer: "apsi.lily@gmail.com", nextReviewAt: "2027-09-29" }, NOW), { now: NOW });
    const generic = { approvedForIngestion: true, approvalStatus: "approved", legalReviewStatus: "approved_public", approvalNotes: "generic" } as const;

    const rowB = () => testDb.db.select().from(dataSources).all().find((row) => row.id === "bidnet_mi_b");
    const before = rowB();

    const outcomes = await approveSourcesWithLedger({ database: testDb.db }, ["bidnet_mi_b"], { actorUserId: null, now: NOW, genericInput: generic });

    expect(outcomes.map((entry) => [entry.outcome, entry.reason])).toEqual([["skipped", "precheck_needs_fix"]]);
    // Nothing at all was written for it: base_url, fetch_config, approval columns and updated_at are as they were.
    expect(rowB()).toEqual(before);
    expect(rowB()).toMatchObject({ baseUrl: "https://x/b", approvalStatus: null });
    expect(testDb.db.$client.prepare("SELECT COUNT(*) AS n FROM source_approval_events").get()).toEqual({ n: 0 });
  });
});

describe("approveSourcesWithLedger (SQLite): holds, demotions and login-gated rows through the real write paths", () => {
  let testDb: TestDatabase;
  const generic = { approvedForIngestion: true, approvalStatus: "approved", legalReviewStatus: "approved_public", approvalNotes: "generic" } as const;
  // What the per-row Hold and the batch `hold` action write (batch/route.ts inputForBatchAction).
  const HOLD = { approvedForIngestion: false, approvalStatus: "needs_review", legalReviewStatus: "not_reviewed", approvalNotes: "Held from Admin batch source approval workflow." } as const;

  function urlOf(id: string) {
    return `https://www.bidnetdirect.com/mitn/${id}/solicitations/open-bids`;
  }

  /** A registered local row: NULL governance columns, as `npm run source:register` leaves it. */
  function insertLocal(id: string, overrides: Partial<typeof dataSources.$inferInsert> = {}) {
    testDb.db.insert(dataSources).values({
      id, label: id, issuerType: "county", stateCode: "MI", providerFamily: "bidnet", jurisdictionLevel: "county", isEnabled: 1,
      baseUrl: urlOf(id), createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...overrides,
    }).run();
  }

  /** The precheck write-back (`recordSourcePrecheck`): live_health_* only, never an approval column. */
  function precheck(id: string, at: string, verdict = "ready") {
    recordSourcePrecheck(testDb.db, id, {
      liveHealth: { disposition: verdict, reviewedAt: at, notes: JSON.stringify({ precheck: { baseUrl: urlOf(id), checkedAt: at, verdict } }) },
    });
  }

  function rawRow(id: string) {
    return testDb.db.select().from(dataSources).all().find((row) => row.id === id);
  }

  function seedReview(overrides: Record<string, unknown> = {}) {
    createPlatformReview(
      testDb.db,
      validatePlatformReviewInput({ providerFamily: "bidnet", tosUrl: "https://www.bidnetdirect.com/tsandcs", tosReviewedAt: "2026-09-29", robotsUrl: "https://www.bidnetdirect.com/robots.txt", robotsCheckedAt: "2026-09-29T07:00:00.000Z", robotsSummary: "ok", reviewer: "apsi.lily@gmail.com", nextReviewAt: "2027-09-29", ...overrides }, NOW),
      { now: NOW },
    );
  }

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await testDb.cleanup();
  });

  it("reads a registered row's NULL governance as needs_review with no review time: not held, and approvable on a fresh ready precheck", async () => {
    insertLocal("bidnet_mi_registered");
    precheck("bidnet_mi_registered", FRESH);
    seedReview();

    const dto = (await listAdminDataSources(testDb.db)).sources.find((entry) => entry.id === "bidnet_mi_registered") as AdminDataSource;
    expect(dto).toMatchObject({ approvalStatus: "needs_review", approvedForIngestion: false, lastApprovalReviewedAt: null });
    expect(isHeldByPerson(dto)).toBe(false);
    expect(summarizeApprovalReadiness([dto], listPlatformReviews(testDb.db), NOW, "bidnet").sources.map((entry) => [entry.bucket, entry.reason])).toEqual([["approvable", null]]);

    const outcomes = await approveSourcesWithLedger({ database: testDb.db }, ["bidnet_mi_registered"], { actorUserId: null, now: NOW, genericInput: generic });
    expect(outcomes.map((entry) => [entry.outcome, entry.reason])).toEqual([["approved", null]]);
  });

  it("never re-approves a person's hold, and takes a demoted row back only on a precheck newer than its failure", async () => {
    insertLocal("bidnet_mi_held");
    insertLocal("bidnet_mi_demoted");
    seedReview();
    const approveBoth = (now: Date) =>
      approveSourcesWithLedger({ database: testDb.db }, ["bidnet_mi_held", "bidnet_mi_demoted"], { actorUserId: null, now, genericInput: generic });

    // Both are prechecked ready and approved from the ledger on that precheck.
    precheck("bidnet_mi_held", FRESH);
    precheck("bidnet_mi_demoted", FRESH);
    vi.setSystemTime(new Date(APPROVED_AT));
    expect((await approveBoth(new Date(APPROVED_AT))).map((entry) => entry.outcome)).toEqual(["approved", "approved"]);

    // A person holds one; a parse failure makes source health demote the other.
    vi.setSystemTime(new Date(HELD_AT));
    await updateAdminDataSource(testDb.db, "bidnet_mi_held", HOLD, { actorUserId: "admin_1" });
    recordSourceFailure(testDb.db, { sourceId: "bidnet_mi_demoted", at: FAILED_AT, kind: "parse" });
    expect(rawRow("bidnet_mi_held")).toMatchObject({ approvalStatus: "needs_review", lastApprovalReviewedAt: HELD_AT, lastFailureAt: null });
    expect(rawRow("bidnet_mi_demoted")).toMatchObject({ approvalStatus: "needs_review", lastApprovalReviewedAt: APPROVED_AT, lastFailureAt: FAILED_AT });

    // Both still carry the fresh ready precheck they were approved on: neither is taken back on it.
    vi.setSystemTime(NOW);
    expect((await approveBoth(NOW)).map((entry) => [entry.sourceId, entry.outcome, entry.reason])).toEqual([
      ["bidnet_mi_held", "skipped", "held"],
      ["bidnet_mi_demoted", "skipped", "precheck_superseded"],
    ]);

    // A new precheck of each, newer than the hold and the failure: the demoted row comes back, the hold stands.
    precheck("bidnet_mi_held", REPRECHECKED);
    precheck("bidnet_mi_demoted", REPRECHECKED);
    expect((await approveBoth(NOW)).map((entry) => [entry.sourceId, entry.outcome, entry.reason])).toEqual([
      ["bidnet_mi_held", "skipped", "held"],
      ["bidnet_mi_demoted", "approved", null],
    ]);
    expect(rawRow("bidnet_mi_held")).toMatchObject({ approvalStatus: "needs_review", approvedForIngestion: 0 });
    expect(rawRow("bidnet_mi_demoted")).toMatchObject({ approvalStatus: "approved", approvedForIngestion: 1 });
  });

  it("skips a login-gated row the review's ledger cannot cover without throwing, and approves the other ids of the same call", async () => {
    insertLocal("bidnet_mi_login", { requiresLogin: 1 });
    insertLocal("bidnet_mi_open");
    testDb.db.insert(dataSources).values({ id: "state_mi", label: "MI", issuerType: "state", stateCode: "MI", jurisdictionLevel: "state", isEnabled: 1, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }).run();
    precheck("bidnet_mi_login", FRESH);
    precheck("bidnet_mi_open", FRESH);
    seedReview(); // no legalOpinionReference
    const loginBefore = rawRow("bidnet_mi_login");

    const outcomes = await approveSourcesWithLedger({ database: testDb.db }, ["bidnet_mi_login", "bidnet_mi_open", "state_mi"], { actorUserId: null, now: NOW, genericInput: generic });

    expect(outcomes.map((entry) => [entry.sourceId, entry.outcome, entry.reason])).toEqual([
      ["bidnet_mi_login", "skipped", "login_requirements_unmet"],
      ["bidnet_mi_open", "approved", null],
      ["state_mi", "approved", null],
    ]);
    expect(rawRow("bidnet_mi_login")).toEqual(loginBefore);
    expect(rawRow("bidnet_mi_open")?.approvalStatus).toBe("approved");
  });

  it("does not re-enable a row someone switched off", async () => {
    insertLocal("bidnet_mi_off", { isEnabled: 0 });
    precheck("bidnet_mi_off", FRESH);
    seedReview();

    const outcomes = await approveSourcesWithLedger({ database: testDb.db }, ["bidnet_mi_off"], { actorUserId: null, now: NOW, genericInput: generic });

    expect(outcomes.map((entry) => [entry.outcome, entry.reason])).toEqual([["skipped", "disabled"]]);
    expect(rawRow("bidnet_mi_off")).toMatchObject({ isEnabled: 0, approvalStatus: null });
  });
});

/**
 * A MySQL store fake that keeps the rows in memory: it answers the list/select queries from them and
 * applies each `UPDATE data_sources SET col = ?, ... WHERE id = ?` back onto the row, so the re-select
 * after an update shows the write the way a real server would.
 */
function createFakeMysqlLedgerStore(rows: Record<string, unknown>[], reviewRows: Record<string, unknown>[]) {
  const executed: Array<{ sql: string; values: unknown[] }> = [];
  const camel = (column: string) => column.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  return {
    rows,
    executed,
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes("FROM data_sources") && sql.includes("ORDER BY label ASC")) return [rows];
      if (sql.includes("FROM data_sources") && sql.includes("WHERE id = ?")) return [rows.filter((row) => row.id === values[0])];
      if (sql.includes("FROM platform_reviews")) return [reviewRows];
      return [[]];
    },
    async execute(sql: string, values: unknown[] = []) {
      executed.push({ sql, values });
      if (sql.startsWith("UPDATE data_sources SET")) {
        const row = rows.find((candidate) => candidate.id === values.at(-1));
        const assignments = sql.match(/SET ([\s\S]*?) WHERE id = \?/i)?.[1].split(",").map((item) => item.trim()) ?? [];
        assignments.forEach((assignment, index) => {
          if (row) row[camel(assignment.split("=")[0].trim())] = values[index];
        });
      }
      return [{ affectedRows: 1 }];
    },
  };
}

function mysqlSourceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bidnet_mi_a", label: "A", issuerType: "county", stateCode: "MI", baseUrl: URL_A, isEnabled: 1, cadence: "daily", fetchConfig: null,
    jurisdictionLevel: "county", jurisdictionName: "A County", providerFamily: "bidnet", accessMode: null, sourceType: null, sourceConfidence: null,
    activationStatus: null, requiresBrowser: null, requiresManual: null, requiresLogin: null, supportsQuery: null, supportsPagination: null,
    supportsAttachmentMetadata: null, supportsDetailPageFetch: null, fallbackNotes: null, approvedForIngestion: null, approvalStatus: null,
    accessPattern: null, legalReviewStatus: null, sourceOwner: null, approvalNotes: null, lastApprovalReviewedAt: null, liveHealthOwner: null,
    liveHealthDisposition: "empty", liveHealthNextReviewAt: null, liveHealthNotes: notes(URL_A), liveHealthReviewedAt: FRESH, precheckRequestedAt: null,
    robotsTxtStatus: null, robotsTxtCheckedAt: null, robotsTxtHash: null, robotsTxtDisallowsCrawledPaths: null, robotsTxtFlagReason: null,
    tosReviewed: null, tosReviewedAt: null, tosUrl: null, complianceReviewer: null, legalOpinionReference: null, complianceReviewDueAt: null,
    complianceNotes: null, lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function mysqlReviewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "prv_mysql_1", provider_family: "bidnet", tos_url: "https://www.bidnetdirect.com/tsandcs", tos_reviewed_at: "2026-09-29",
    robots_url: "https://www.bidnetdirect.com/robots.txt", robots_checked_at: "2026-09-29T07:00:00.000Z", robots_summary: "ok",
    access_boundary: PLATFORM_ACCESS_BOUNDARY, reviewer: "apsi.lily@gmail.com", legal_opinion_reference: "LEGAL-42",
    reviewed_at: "2026-09-29T08:00:00.000Z", next_review_at: "2027-09-29", notes: null, created_by: null, created_at: "2026-09-29T08:00:00.000Z",
    ...overrides,
  };
}

describe("approveSourcesWithLedger (MySQL)", () => {
  const generic = { approvedForIngestion: true, approvalStatus: "approved", legalReviewStatus: "approved_public", approvalNotes: "generic" } as const;
  // Any touch of the SQLite handle would throw: the MySQL branch must never fall back to Drizzle.
  const untouchedDatabase = new Proxy({}, { get: () => { throw new Error("SQLite handle used on the MySQL path"); } }) as AppDatabase;

  it("approves through the review ledger, skips with reasons and never touches SQLite", async () => {
    const store = createFakeMysqlLedgerStore(
      [
        mysqlSourceRow(),
        mysqlSourceRow({ id: "bidnet_mi_b", label: "B", baseUrl: "https://x/b", liveHealthDisposition: "needs_fix", liveHealthNotes: notes("https://x/b") }),
        mysqlSourceRow({ id: "bidnet_mi_c", label: "C", baseUrl: "https://www.bidnetdirect.com/mitn/c2/solicitations/open-bids", liveHealthNotes: notes(URL_A) }),
        mysqlSourceRow({ id: "state_mi", label: "MI", issuerType: "state", jurisdictionLevel: "state", providerFamily: null, baseUrl: null }),
      ],
      [mysqlReviewRow()],
    );

    const outcomes = await approveSourcesWithLedger(
      { database: untouchedDatabase, mysql: store as never },
      ["bidnet_mi_a", "bidnet_mi_b", "bidnet_mi_c", "state_mi", "ghost"],
      { actorUserId: "admin_1", now: NOW, genericInput: generic },
    );

    expect(outcomes.map((entry) => [entry.sourceId, entry.outcome, entry.reason])).toEqual([
      ["bidnet_mi_a", "approved", null],
      ["bidnet_mi_b", "skipped", "precheck_needs_fix"],
      ["bidnet_mi_c", "skipped", "base_url_changed"],
      ["state_mi", "approved", null],
      ["ghost", "not_found", null],
    ]);

    // Only the two approved rows were written, and the ledger came from the review row.
    const updates = store.executed.filter((call) => call.sql.startsWith("UPDATE data_sources SET"));
    expect(updates.map((call) => call.values.at(-1))).toEqual(["bidnet_mi_a", "state_mi"]);
    const ledgerUpdate = updates[0];
    for (const column of ["approval_status = ?", "approved_for_ingestion = ?", "is_enabled = ?", "legal_review_status = ?", "compliance_reviewer = ?", "tos_url = ?", "tos_reviewed = ?", "tos_reviewed_at = ?", "legal_opinion_reference = ?", "compliance_review_due_at = ?", "approval_notes = ?"]) {
      expect(ledgerUpdate.sql).toContain(column);
    }
    expect(ledgerUpdate.values).toEqual(expect.arrayContaining(["approved", "apsi.lily@gmail.com", "https://www.bidnetdirect.com/tsandcs", "LEGAL-42", "2027-09-29", `依据平台审查 #prv_mysql_1；预检 empty @${FRESH}`]));
    expect(updates[1].values).toContain("generic");

    // One approval event per written row, recording the held -> approved transition.
    const events = store.executed.filter((call) => call.sql.includes("INSERT INTO source_approval_events"));
    expect(events.map((call) => call.values[1])).toEqual(["bidnet_mi_a", "state_mi"]);
    expect(events[0].values[2]).toBe("admin_1");
    expect(events[0].values[4]).toBe("needs_review");
    expect(outcomes[0].source).toMatchObject({ id: "bidnet_mi_a", approvalStatus: "approved", complianceReviewer: "apsi.lily@gmail.com", complianceReviewDueAt: "2027-09-29" });
    expect(store.rows.find((row) => row.id === "bidnet_mi_b")?.approvalStatus).toBeNull();
  });

  it("skips every local source as missing_platform_review when the ledger has no review, and writes nothing", async () => {
    const store = createFakeMysqlLedgerStore([mysqlSourceRow()], []);

    const outcomes = await approveSourcesWithLedger({ database: untouchedDatabase, mysql: store as never }, ["bidnet_mi_a"], { actorUserId: null, now: NOW, genericInput: generic });

    expect(outcomes.map((entry) => [entry.outcome, entry.reason])).toEqual([["skipped", "missing_platform_review"]]);
    expect(store.executed).toEqual([]);
  });

  it("skips held, demoted, disabled, queued and login-gated rows without throwing, and writes only the approvable one", async () => {
    const store = createFakeMysqlLedgerStore(
      [
        mysqlSourceRow({ id: "bidnet_mi_ok" }),
        mysqlSourceRow({ id: "bidnet_mi_held", approvalStatus: "needs_review", lastApprovalReviewedAt: HELD_AT }),
        mysqlSourceRow({ id: "bidnet_mi_demoted", approvalStatus: "needs_review", lastApprovalReviewedAt: APPROVED_AT, lastFailureAt: FAILED_AT }),
        mysqlSourceRow({ id: "bidnet_mi_off", isEnabled: 0 }),
        mysqlSourceRow({ id: "bidnet_mi_queued", precheckRequestedAt: "2026-09-29T07:00:00.000Z" }),
        mysqlSourceRow({ id: "bidnet_mi_login", requiresLogin: 1 }),
      ],
      [mysqlReviewRow({ legal_opinion_reference: null })],
    );
    const ids = ["bidnet_mi_ok", "bidnet_mi_held", "bidnet_mi_demoted", "bidnet_mi_off", "bidnet_mi_queued", "bidnet_mi_login"];

    const outcomes = await approveSourcesWithLedger({ database: untouchedDatabase, mysql: store as never }, ids, { actorUserId: "admin_1", now: NOW, genericInput: generic });

    expect(outcomes.map((entry) => [entry.sourceId, entry.outcome, entry.reason])).toEqual([
      ["bidnet_mi_ok", "approved", null],
      ["bidnet_mi_held", "skipped", "held"],
      ["bidnet_mi_demoted", "skipped", "precheck_superseded"],
      ["bidnet_mi_off", "skipped", "disabled"],
      ["bidnet_mi_queued", "skipped", "precheck_queued"],
      ["bidnet_mi_login", "skipped", "login_requirements_unmet"],
    ]);
    const updates = store.executed.filter((call) => call.sql.startsWith("UPDATE data_sources SET"));
    expect(updates.map((call) => call.values.at(-1))).toEqual(["bidnet_mi_ok"]);
    expect(store.rows.find((row) => row.id === "bidnet_mi_off")?.isEnabled).toBe(0);
  });
});
