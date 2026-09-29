import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/server/db/client";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import type { AdminDataSource } from "./data-sources-repository";
import { PLATFORM_ACCESS_BOUNDARY, createPlatformReview, validatePlatformReviewInput, type EffectivePlatformReview, type PlatformReview } from "./platform-reviews-repository";
import { approveSourcesWithLedger, evaluateLedgeredApproval, ledgeredApprovalInput, readinessBucket, summarizeApprovalReadiness } from "./ledgered-approval";

const NOW = new Date("2026-09-29T08:00:00.000Z");
const FRESH = "2026-09-25T00:00:00.000Z";
const STALE = "2026-09-01T00:00:00.000Z";
const URL_A = "https://www.bidnetdirect.com/mitn/a/solicitations/open-bids";

function review(overrides: Partial<PlatformReview> = {}): PlatformReview {
  return { id: "prv_1", providerFamily: "bidnet", tosUrl: "https://www.bidnetdirect.com/tsandcs", tosReviewedAt: "2026-09-29", robotsUrl: "https://www.bidnetdirect.com/robots.txt", robotsCheckedAt: "2026-09-29T07:00:00.000Z", robotsSummary: "ok", accessBoundary: PLATFORM_ACCESS_BOUNDARY, reviewer: "apsi.lily@gmail.com", legalOpinionReference: "LEGAL-42", reviewedAt: "2026-09-29T08:00:00.000Z", nextReviewAt: "2027-09-29", notes: null, createdBy: null, createdAt: "2026-09-29T08:00:00.000Z", ...overrides };
}
const VALID: EffectivePlatformReview = { status: "valid", review: review() };
const EXPIRED: EffectivePlatformReview = { status: "expired", review: review({ nextReviewAt: "2026-01-01" }) };

function notes(baseUrl: string | null) {
  return JSON.stringify({ precheck: { baseUrl, verdict: "empty" } });
}

function source(overrides: Partial<AdminDataSource> = {}): AdminDataSource {
  return {
    id: "bidnet_mi_a", label: "A", issuerType: "county", stateCode: "MI", baseUrl: URL_A, isEnabled: true, cadence: "daily", fetchConfig: {},
    jurisdictionLevel: "county", jurisdictionName: "A County", lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0,
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
});
