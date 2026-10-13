import { riskCheckStatus, riskChecklistOutcome, type RiskCheckStatus } from "@/lib/risk-check-status";
import { STATE_CRAWLER_SOURCES } from "@/lib/state-crawler-sources";
import { bidDetailPath, bidIdFromRouteParam } from "@/lib/bid-routes";
import { getBidAttachmentDownload, getBidAttachmentDownloadFromMysql } from "@/server/bids/attachments";
import { getBidByIdFromRepository } from "@/server/bids/repository";
import { getBidByIdFromMysqlRuntime, queryBidsFromDatabase, queryBidsFromMysql } from "@/server/bids/service";
import type { Bid } from "@/server/bids/domain";
import type { AppDatabase } from "@/server/db/client";
import { mysqlSelectMany } from "@/server/db/mysql-runtime";
import { dataSources } from "@/server/db/schema";
import { featuresForUser, hasFeature } from "@/server/auth/entitlements";
import { validateBidSourceUrl, validateStateAttachmentUrl } from "@/server/source-validity/url-validity";
import {
  createStateDataQualityReport,
  stateDataQualityP0Details,
  type StateDataQualityReasonCode,
  type StateDataQualityReport,
} from "@/server/source-validity/state-data-quality";
import type { Pool } from "mysql2/promise";

export type { RiskCheckStatus };

/**
 * The ids of the checks a risk checklist is made of, in report order (the MySQL report leaves out
 * `state-data-quality-gate`). The admin console titles each check by its id, `riskCheckLabel_state_coverage` in the
 * dictionaries for `state-coverage`, and prints the `label` sent here only for an id it has no title for. So an id
 * added here needs an entry in both dictionaries: RiskCheckSection.test.ts fails until it has one.
 */
export const RISK_CHECK_IDS = [
  "state-coverage",
  "state-content",
  "bid-detail-routes",
  "attachment-downloads",
  "state-data-quality-gate",
  "account-tier-separation",
  "source-ingestion-governance",
  "source-validity-metadata",
  "state-url-validity",
  "global-url-validity",
] as const;

export type RiskCheckId = (typeof RISK_CHECK_IDS)[number];

// A stored snapshot can carry an id this build no longer builds, so the id stays a plain string on the wire.
export interface RiskChecklistCheck {
  id: string;
  label: string;
  /**
   * True only for a check that ran and passed. A check that did not run is not ok either, so a reader that ignores
   * `status` never counts it as a pass.
   */
  ok: boolean;
  /** What became of the check: passed, failed or not run. Absent from a report stored before it existed; `riskCheckStatus` then reads `ok`. */
  status?: RiskCheckStatus;
  summary: string;
  details?: string[];
}

export interface RiskChecklistReport {
  /**
   * True when every check ran and passed. A report with a check that did not run is not ok, and has not failed either:
   * `riskChecklistOutcome` tells the two apart, and `assertRiskChecklistReport` throws only for a failure.
   */
  ok: boolean;
  checkedAt: string;
  checks: RiskChecklistCheck[];
}

export interface RiskChecklistOptions {
  requireSourceApproval?: boolean;
  /**
   * The database is seed (demo) data, so the 50-state results cannot be judged from it: which states have an active bid
   * is a property of the business database, not of the code. The state coverage check, and the missing-bid reason of the
   * state data quality gate, are then reported as NOT RUN, with their real numbers, instead of failed. Defaults to
   * RISK_CHECK_SEED_DATA=true. Never honoured when NODE_ENV is production, where all 50 states are always required.
   */
  seedData?: boolean;
}

type RiskDataSourceRow = typeof dataSources.$inferSelect;

function check(id: RiskCheckId, label: string, ok: boolean, summary: string, details: string[] = []): RiskChecklistCheck {
  return {
    id,
    label,
    ok,
    status: ok ? "pass" : "fail",
    summary,
    ...(details.length > 0 ? { details } : {}),
  };
}

/** A check that was not evaluated: neither a pass nor a failure, and `ok` is false so that no reader counts it as a pass. */
function notRunCheck(id: RiskCheckId, label: string, summary: string, details: string[] = []): RiskChecklistCheck {
  return {
    id,
    label,
    ok: false,
    status: "not_run",
    summary,
    ...(details.length > 0 ? { details } : {}),
  };
}

function requiredStateCodes() {
  return [...new Set(STATE_CRAWLER_SOURCES.map((source) => source.stateCode))].sort();
}

function statesWithBids(bids: Bid[]) {
  return [...new Set(bids.map((bid) => bid.stateCode).filter(Boolean))].sort();
}

function hasRequiredContent(bid: Bid) {
  return Boolean(
    bid.title.trim() &&
    bid.issuerName.trim() &&
    bid.sourceUrl.trim() &&
    bid.stateCode.trim() &&
    (bid.description.trim() || bid.fullDescription.trim()),
  );
}

function routeParamFromPath(path: string) {
  const prefix = "/bids/";
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function attachmentIdFromDownloadUrl(url: string) {
  const marker = "/attachments/";
  const index = url.indexOf(marker);
  if (index === -1) return null;

  try {
    return decodeURIComponent(url.slice(index + marker.length));
  } catch {
    return null;
  }
}

function routeRoundTripFailures(bids: Bid[]) {
  return bids
    .map((bid) => {
      const routeParam = routeParamFromPath(bidDetailPath(bid.id));
      return bidIdFromRouteParam(routeParam) === bid.id ? null : bid.id;
    })
    .filter((value): value is string => value !== null);
}

async function detailLookupFailures(db: AppDatabase, bids: Bid[]) {
  const failures: string[] = [];

  for (const bid of bids) {
    const detail = await getBidByIdFromRepository(db, bid.id);
    if (!detail) failures.push(bid.id);
  }

  return failures;
}

async function detailLookupFailuresFromMysql(mysql: Pool, bids: Bid[]) {
  const failures: string[] = [];

  for (const bid of bids) {
    const detail = await getBidByIdFromMysqlRuntime(mysql, bid.id);
    if (!detail) failures.push(bid.id);
  }

  return failures;
}

async function attachmentFailures(db: AppDatabase, bids: Bid[]) {
  const failures: string[] = [];

  for (const bid of bids) {
    for (const attachment of bid.attachments) {
      if (!attachment.url.startsWith("/api/bids/")) {
        failures.push(`${bid.id}: attachment ${attachment.name} does not use safe download route`);
        continue;
      }

      const attachmentId = attachmentIdFromDownloadUrl(attachment.url);
      if (!attachmentId) {
        failures.push(`${bid.id}: attachment ${attachment.name} has an unreadable route id`);
        continue;
      }

      const download = await getBidAttachmentDownload(db, bid.id, attachmentId);
      if (!download) {
        failures.push(`${bid.id}: attachment ${attachment.name} would return 404`);
      }
    }
  }

  return failures;
}

async function attachmentFailuresFromMysql(mysql: Pool, bids: Bid[]) {
  const failures: string[] = [];

  for (const bid of bids) {
    for (const attachment of bid.attachments) {
      if (!attachment.url.startsWith("/api/bids/")) {
        failures.push(`${bid.id}: attachment ${attachment.name} does not use safe download route`);
        continue;
      }

      const attachmentId = attachmentIdFromDownloadUrl(attachment.url);
      if (!attachmentId) {
        failures.push(`${bid.id}: attachment ${attachment.name} has an unreadable route id`);
        continue;
      }

      const download = await getBidAttachmentDownloadFromMysql(mysql, bid.id, attachmentId);
      if (!download) {
        failures.push(`${bid.id}: attachment ${attachment.name} would return 404`);
      }
    }
  }

  return failures;
}

function accountFeatureMatrixCheck() {
  const freeUserFeatures = featuresForUser({ role: "user", tier: "free" });
  const proUserFeatures = featuresForUser({ role: "user", tier: "pro" });
  const businessUserFeatures = featuresForUser({ role: "user", tier: "business" });
  const adminFeatures = featuresForUser({ role: "admin", tier: "free" });
  const failures: string[] = [];

  if (freeUserFeatures.includes("admin_console")) failures.push("free user unexpectedly has admin_console");
  if (freeUserFeatures.includes("submission_guidance")) failures.push("free user unexpectedly has submission_guidance");
  if (!proUserFeatures.includes("submission_guidance")) failures.push("pro user is missing submission_guidance");
  if (!businessUserFeatures.includes("compliance_manifest")) failures.push("business user is missing compliance_manifest");
  if (!adminFeatures.includes("admin_console")) failures.push("admin user is missing admin_console");
  if (hasFeature({ role: "user", tier: "business" }, "admin_console")) {
    failures.push("business user unexpectedly has admin_console");
  }

  return failures;
}

/**
 * Whether this run is on seed data, so that the 50-state results are set aside instead of judged. Like
 * shouldRequireSourceApproval it takes an explicit option first and RISK_CHECK_SEED_DATA=true after it, except that
 * production wins over both: neither is read there, so a production run can never skip the 50-state requirement.
 */
function isSeedDataRun(options: RiskChecklistOptions) {
  if (process.env.NODE_ENV === "production") return false;
  if (typeof options.seedData === "boolean") return options.seedData;
  return process.env.RISK_CHECK_SEED_DATA === "true";
}

/** The first detail of a check set aside on seed data: why it was not run, and how to run it. */
const SEED_DATA_NOT_RUN_REASON =
  "run on seed data: which states have an active bid is a property of the business database, so it is not verified here; " +
  "run the checklist against that database without RISK_CHECK_SEED_DATA to verify it";

/**
 * The 50-state coverage check. On seed data a state with no bid is not a failure of anything the run can judge, so it is
 * NOT RUN with its real numbers; every other outcome is as it always was. A registry that does not list 50 states is
 * the code's problem, not the data's, and fails whatever the data.
 */
export function stateCoverageCheck(input: {
  requiredStates: string[];
  availableStates: string[];
  seedData: boolean;
}): RiskChecklistCheck {
  const { requiredStates, availableStates, seedData } = input;
  const missingStates = requiredStates.filter((stateCode) => !availableStates.includes(stateCode));
  const missingDetails = missingStates.map((stateCode) => `missing state ${stateCode}`);
  const summary = `${availableStates.length}/${requiredStates.length} required states have at least one active bid`;
  const registryComplete = requiredStates.length === 50;

  if (seedData && registryComplete && missingStates.length > 0) {
    return notRunCheck("state-coverage", "50 state data coverage", `not evaluated on seed data: ${summary}`, [
      SEED_DATA_NOT_RUN_REASON,
      ...missingDetails,
    ]);
  }

  return check("state-coverage", "50 state data coverage", registryComplete && missingStates.length === 0, summary, missingDetails);
}

/**
 * The state data quality P0 gate. On seed data the one P0 reason that is a fact about the business database, a state with
 * no active bid (`missing_state_bid`), is set aside, and every other P0 reason is still judged. So the gate fails for any
 * other blocker, is NOT RUN while states are set aside, and passes only when nothing was.
 */
function stateDataQualityGateCheck(report: StateDataQualityReport, seedData: boolean): RiskChecklistCheck {
  const id = "state-data-quality-gate";
  const label = "50-state data quality P0 gate";
  const summary = `${report.rows.length} state quality rows checked for P0 blocker reason codes`;

  if (!seedData) {
    const failures = stateDataQualityP0Details(report);
    return check(id, label, failures.length === 0, summary, failures);
  }

  const setAside: StateDataQualityReasonCode = "missing_state_bid";
  const judged: StateDataQualityReport = {
    ...report,
    rows: report.rows.map((row) => ({ ...row, reasons: row.reasons.filter((reason) => reason.code !== setAside) })),
  };
  const failures = stateDataQualityP0Details(judged);
  const statesSetAside = report.rows.filter((row) => row.reasons.some((reason) => reason.code === setAside)).length;
  const setAsideSummary =
    statesSetAside > 0
      ? `${summary}, except ${setAside}, which is not evaluated on seed data: ${statesSetAside}/${report.rows.length} states have no active bid`
      : summary;

  if (failures.length > 0) return check(id, label, false, setAsideSummary, failures);
  if (statesSetAside === 0) return check(id, label, true, summary);
  return notRunCheck(id, label, setAsideSummary, [SEED_DATA_NOT_RUN_REASON]);
}

function reportOf(checks: RiskChecklistCheck[], now: Date): RiskChecklistReport {
  return {
    ok: checks.every((entry) => entry.ok),
    checkedAt: now.toISOString(),
    checks,
  };
}

function shouldRequireSourceApproval(options: RiskChecklistOptions) {
  if (typeof options.requireSourceApproval === "boolean") return options.requireSourceApproval;
  if (process.env.RISK_CHECK_REQUIRE_SOURCE_APPROVAL === "true") return true;
  return process.env.NODE_ENV === "production";
}

function sourceGovernanceFailuresForRows(rows: RiskDataSourceRow[], options: { requireSourceApproval: boolean }) {
  const rowsByState = new Map(rows.filter((row) => row.issuerType === "state").map((row) => [row.stateCode, row]));
  const failures: string[] = [];

  for (const source of STATE_CRAWLER_SOURCES) {
    if (!source.approvalStatus || !source.accessPattern || !source.legalReviewStatus || !source.sourceOwner) {
      failures.push(`${source.stateCode} ${source.id} is missing registry governance metadata`);
      continue;
    }

    const row = rowsByState.get(source.stateCode);
    const isEnabled = row ? row.isEnabled === 1 : true;
    const approvalStatus = row?.approvalStatus ?? source.approvalStatus;
    const accessPattern = row?.accessPattern ?? source.accessPattern;
    const legalReviewStatus = row?.legalReviewStatus ?? source.legalReviewStatus;
    const approvedForIngestion = row?.approvedForIngestion === undefined || row.approvedForIngestion === null
      ? source.approvedForIngestion
      : row.approvedForIngestion === 1;

    if (!isEnabled) continue;

    if (approvalStatus === "blocked") {
      failures.push(`${source.stateCode} ${source.id} is enabled but blocked for ingestion`);
    }

    if (accessPattern === "login_required" || accessPattern === "restricted" || legalReviewStatus === "restricted") {
      failures.push(`${source.stateCode} ${source.id} is enabled with restricted access governance`);
    }

    if (
      options.requireSourceApproval &&
      (!approvedForIngestion || approvalStatus !== "approved" || legalReviewStatus !== "approved_public")
    ) {
      failures.push(`${source.stateCode} ${source.id} is enabled but not approved for production ingestion`);
    }
  }

  return failures;
}

function sourceGovernanceFailures(db: AppDatabase, options: { requireSourceApproval: boolean }) {
  return sourceGovernanceFailuresForRows(db.select().from(dataSources).all(), options);
}

function mysqlDataSourceRow(row: Record<string, unknown>): RiskDataSourceRow {
  return {
    id: String(row.id ?? ""),
    label: String(row.label ?? ""),
    issuerType: String(row.issuerType ?? ""),
    stateCode: String(row.stateCode ?? ""),
    baseUrl: row.baseUrl === null || row.baseUrl === undefined ? null : String(row.baseUrl),
    isEnabled: Number(row.isEnabled ?? 1),
    cadence: String(row.cadence ?? "daily"),
    providerFamily: row.providerFamily === null || row.providerFamily === undefined ? null : String(row.providerFamily),
    accessMode: row.accessMode === null || row.accessMode === undefined ? null : String(row.accessMode),
    sourceType: row.sourceType === null || row.sourceType === undefined ? null : String(row.sourceType),
    sourceConfidence: row.sourceConfidence === null || row.sourceConfidence === undefined ? null : String(row.sourceConfidence),
    activationStatus: row.activationStatus === null || row.activationStatus === undefined ? null : String(row.activationStatus),
    requiresBrowser: row.requiresBrowser === null || row.requiresBrowser === undefined ? null : Number(row.requiresBrowser),
    requiresManual: row.requiresManual === null || row.requiresManual === undefined ? null : Number(row.requiresManual),
    requiresLogin: row.requiresLogin === null || row.requiresLogin === undefined ? null : Number(row.requiresLogin),
    supportsQuery: row.supportsQuery === null || row.supportsQuery === undefined ? null : Number(row.supportsQuery),
    supportsPagination: row.supportsPagination === null || row.supportsPagination === undefined ? null : Number(row.supportsPagination),
    supportsAttachmentMetadata: row.supportsAttachmentMetadata === null || row.supportsAttachmentMetadata === undefined
      ? null
      : Number(row.supportsAttachmentMetadata),
    supportsDetailPageFetch: row.supportsDetailPageFetch === null || row.supportsDetailPageFetch === undefined
      ? null
      : Number(row.supportsDetailPageFetch),
    fallbackNotes: row.fallbackNotes === null || row.fallbackNotes === undefined ? null : String(row.fallbackNotes),
    approvedForIngestion: row.approvedForIngestion === null || row.approvedForIngestion === undefined
      ? null
      : Number(row.approvedForIngestion),
    approvalStatus: row.approvalStatus === null || row.approvalStatus === undefined ? null : String(row.approvalStatus),
    accessPattern: row.accessPattern === null || row.accessPattern === undefined ? null : String(row.accessPattern),
    legalReviewStatus: row.legalReviewStatus === null || row.legalReviewStatus === undefined
      ? null
      : String(row.legalReviewStatus),
    sourceOwner: row.sourceOwner === null || row.sourceOwner === undefined ? null : String(row.sourceOwner),
    approvalNotes: row.approvalNotes === null || row.approvalNotes === undefined ? null : String(row.approvalNotes),
    lastApprovalReviewedAt: row.lastApprovalReviewedAt === null || row.lastApprovalReviewedAt === undefined
      ? null
      : String(row.lastApprovalReviewedAt),
    liveHealthOwner: row.liveHealthOwner === null || row.liveHealthOwner === undefined ? null : String(row.liveHealthOwner),
    liveHealthDisposition: row.liveHealthDisposition === null || row.liveHealthDisposition === undefined
      ? null
      : String(row.liveHealthDisposition),
    liveHealthNextReviewAt: row.liveHealthNextReviewAt === null || row.liveHealthNextReviewAt === undefined
      ? null
      : String(row.liveHealthNextReviewAt),
    liveHealthNotes: row.liveHealthNotes === null || row.liveHealthNotes === undefined ? null : String(row.liveHealthNotes),
    liveHealthReviewedAt: row.liveHealthReviewedAt === null || row.liveHealthReviewedAt === undefined
      ? null
      : String(row.liveHealthReviewedAt),
    precheckRequestedAt: row.precheckRequestedAt === null || row.precheckRequestedAt === undefined ? null : String(row.precheckRequestedAt),
    lastSuccessAt: row.lastSuccessAt === null || row.lastSuccessAt === undefined ? null : String(row.lastSuccessAt),
    lastFailureAt: row.lastFailureAt === null || row.lastFailureAt === undefined ? null : String(row.lastFailureAt),
    consecutiveFailures: Number(row.consecutiveFailures ?? 0),
    consecutiveEmptyRuns: Number(row.consecutiveEmptyRuns ?? 0),
    robotsTxtStatus: row.robotsTxtStatus === null || row.robotsTxtStatus === undefined ? null : String(row.robotsTxtStatus),
    robotsTxtCheckedAt: row.robotsTxtCheckedAt === null || row.robotsTxtCheckedAt === undefined ? null : String(row.robotsTxtCheckedAt),
    robotsTxtHash: row.robotsTxtHash === null || row.robotsTxtHash === undefined ? null : String(row.robotsTxtHash),
    robotsTxtDisallowsCrawledPaths: row.robotsTxtDisallowsCrawledPaths === null || row.robotsTxtDisallowsCrawledPaths === undefined ? null : Number(row.robotsTxtDisallowsCrawledPaths),
    robotsTxtFlagReason: row.robotsTxtFlagReason === null || row.robotsTxtFlagReason === undefined ? null : String(row.robotsTxtFlagReason),
    tosReviewed: row.tosReviewed === null || row.tosReviewed === undefined ? null : Number(row.tosReviewed),
    tosReviewedAt: row.tosReviewedAt === null || row.tosReviewedAt === undefined ? null : String(row.tosReviewedAt),
    tosUrl: row.tosUrl === null || row.tosUrl === undefined ? null : String(row.tosUrl),
    complianceReviewer: row.complianceReviewer === null || row.complianceReviewer === undefined ? null : String(row.complianceReviewer),
    legalOpinionReference: row.legalOpinionReference === null || row.legalOpinionReference === undefined ? null : String(row.legalOpinionReference),
    complianceReviewDueAt: row.complianceReviewDueAt === null || row.complianceReviewDueAt === undefined ? null : String(row.complianceReviewDueAt),
    complianceNotes: row.complianceNotes === null || row.complianceNotes === undefined ? null : String(row.complianceNotes),
    jurisdictionLevel: row.jurisdictionLevel === null || row.jurisdictionLevel === undefined ? null : String(row.jurisdictionLevel),
    jurisdictionName: row.jurisdictionName === null || row.jurisdictionName === undefined ? null : String(row.jurisdictionName),
    fipsCode: row.fipsCode === null || row.fipsCode === undefined ? null : String(row.fipsCode),
    fetchConfig: row.fetchConfig === null || row.fetchConfig === undefined ? null : String(row.fetchConfig),
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

async function sourceGovernanceFailuresFromMysql(mysql: Pool, options: { requireSourceApproval: boolean }) {
  const rows = await mysqlSelectMany<Record<string, unknown>>(
    mysql,
    `
      SELECT
        id,
        label,
        issuer_type AS issuerType,
        state_code AS stateCode,
        base_url AS baseUrl,
        is_enabled AS isEnabled,
        cadence,
        provider_family AS providerFamily,
        access_mode AS accessMode,
        source_type AS sourceType,
        source_confidence AS sourceConfidence,
        activation_status AS activationStatus,
        requires_browser AS requiresBrowser,
        requires_manual AS requiresManual,
        requires_login AS requiresLogin,
        supports_query AS supportsQuery,
        supports_pagination AS supportsPagination,
        supports_attachment_metadata AS supportsAttachmentMetadata,
        supports_detail_page_fetch AS supportsDetailPageFetch,
        fallback_notes AS fallbackNotes,
        approved_for_ingestion AS approvedForIngestion,
        approval_status AS approvalStatus,
        access_pattern AS accessPattern,
        legal_review_status AS legalReviewStatus,
        source_owner AS sourceOwner,
        approval_notes AS approvalNotes,
        last_approval_reviewed_at AS lastApprovalReviewedAt,
        live_health_owner AS liveHealthOwner,
        live_health_disposition AS liveHealthDisposition,
        live_health_next_review_at AS liveHealthNextReviewAt,
        live_health_notes AS liveHealthNotes,
        live_health_reviewed_at AS liveHealthReviewedAt,
        precheck_requested_at AS precheckRequestedAt,
        last_success_at AS lastSuccessAt,
        last_failure_at AS lastFailureAt,
        consecutive_failures AS consecutiveFailures,
        consecutive_empty_runs AS consecutiveEmptyRuns,
        jurisdiction_level AS jurisdictionLevel,
        jurisdiction_name AS jurisdictionName,
        fips_code AS fipsCode,
        fetch_config AS fetchConfig,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM data_sources
    `,
  );

  return sourceGovernanceFailuresForRows(rows.map(mysqlDataSourceRow), options);
}

function sourceValidityMetadataFailures() {
  return STATE_CRAWLER_SOURCES.flatMap((source) => {
    const missing = [
      source.sourceAuthority ? null : "sourceAuthority",
      source.trustStatus ? null : "trustStatus",
      source.evidenceMode ? null : "evidenceMode",
      source.validityNotes.trim() ? null : "validityNotes",
    ].filter((value): value is string => Boolean(value));

    return missing.length === 0 ? [] : [`${source.stateCode} ${source.id} missing ${missing.join(", ")}`];
  });
}

function bidUrlValidityFailures(bids: Bid[]) {
  return bids.flatMap((bid) => [
    ...validateBidSourceUrl(bid.sourceUrl).map(
      (finding) => `${bid.id}: sourceUrl ${finding.code} - ${finding.message}`,
    ),
    ...bid.attachments.flatMap((attachment) =>
      validateStateAttachmentUrl(attachment.url).map(
        (finding) => `${bid.id}: attachment ${attachment.name} ${finding.code} - ${finding.message}`,
      ),
    ),
  ]);
}

export async function createRiskChecklistReport(
  db: AppDatabase,
  now = new Date(),
  options: RiskChecklistOptions = {},
): Promise<RiskChecklistReport> {
  const allResponse = await queryBidsFromDatabase(db, {});
  const allBids = allResponse.bids;
  const stateResponse = await queryBidsFromDatabase(db, { issuerType: "state" });
  const stateBids = stateResponse.bids;
  const requiredStates = requiredStateCodes();
  const availableStates = statesWithBids(stateBids);
  const emptyContentBids = stateBids.filter((bid) => !hasRequiredContent(bid)).map((bid) => bid.id);
  const routeFailures = routeRoundTripFailures(stateBids);
  const lookupFailures = await detailLookupFailures(db, stateBids);
  const safeAttachmentFailures = await attachmentFailures(db, stateBids);
  const stateDataQualityReport = await createStateDataQualityReport(db, now);
  const seedData = isSeedDataRun(options);
  const accountFeatureFailures = accountFeatureMatrixCheck();
  const requireSourceApproval = shouldRequireSourceApproval(options);
  const governanceFailures = sourceGovernanceFailures(db, { requireSourceApproval });
  const validityMetadataFailures = sourceValidityMetadataFailures();
  const stateUrlFailures = bidUrlValidityFailures(stateBids);
  const globalUrlFailures = bidUrlValidityFailures(allBids);

  const checks = [
    stateCoverageCheck({ requiredStates, availableStates, seedData }),
    check(
      "state-content",
      "State bid content is non-empty",
      emptyContentBids.length === 0,
      `${stateBids.length} state bids checked for title, issuer, URL, state, and description`,
      emptyContentBids.map((bidId) => `${bidId} has empty required content`),
    ),
    check(
      "bid-detail-routes",
      "Bid detail route IDs round trip",
      routeFailures.length === 0 && lookupFailures.length === 0,
      `${stateBids.length} state bid IDs checked through route encoding and local lookup`,
      [
        ...routeFailures.map((bidId) => `${bidId} fails route encode/decode round trip`),
        ...lookupFailures.map((bidId) => `${bidId} cannot be found by detail lookup`),
      ],
    ),
    check(
      "attachment-downloads",
      "Attachments use safe non-404 download routes",
      safeAttachmentFailures.length === 0,
      `${stateBids.reduce((total, bid) => total + bid.attachments.length, 0)} state attachments checked`,
      safeAttachmentFailures,
    ),
    stateDataQualityGateCheck(stateDataQualityReport, seedData),
    check(
      "account-tier-separation",
      "Admin and paid feature separation",
      accountFeatureFailures.length === 0,
      "free, pro, business, and admin entitlement matrix checked",
      accountFeatureFailures,
    ),
    check(
      "source-ingestion-governance",
      "Source ingestion governance metadata",
      governanceFailures.length === 0,
      `${requiredStates.length} state crawler sources checked for approval metadata, restricted-source blocks, and ${
        requireSourceApproval ? "production approval readiness" : "local ingestion readiness"
      }`,
      governanceFailures,
    ),
    check(
      "source-validity-metadata",
      "50 state source validity metadata",
      validityMetadataFailures.length === 0,
      `${requiredStates.length} state crawler sources checked for authority, trust, evidence mode, and notes`,
      validityMetadataFailures,
    ),
    check(
      "state-url-validity",
      "State source and attachment URLs are production-like",
      stateUrlFailures.length === 0,
      `${stateBids.length} state bids checked for placeholder source URLs and unsafe attachment URLs`,
      stateUrlFailures,
    ),
    check(
      "global-url-validity",
      "All active bid source and attachment URLs are production-like",
      globalUrlFailures.length === 0,
      `${allBids.length} active bids checked for placeholder source URLs and unsafe attachment URLs`,
      globalUrlFailures,
    ),
  ];

  return reportOf(checks, now);
}

export async function createRiskChecklistReportFromMysql(
  mysql: Pool,
  now = new Date(),
  options: RiskChecklistOptions = {},
): Promise<RiskChecklistReport> {
  const allResponse = await queryBidsFromMysql(mysql, {}, { referenceDate: now });
  const allBids = allResponse.bids;
  const stateResponse = await queryBidsFromMysql(mysql, { issuerType: "state" }, { referenceDate: now });
  const stateBids = stateResponse.bids;
  const requiredStates = requiredStateCodes();
  const availableStates = statesWithBids(stateBids);
  const seedData = isSeedDataRun(options);
  const emptyContentBids = stateBids.filter((bid) => !hasRequiredContent(bid)).map((bid) => bid.id);
  const routeFailures = routeRoundTripFailures(stateBids);
  const lookupFailures = await detailLookupFailuresFromMysql(mysql, stateBids);
  const safeAttachmentFailures = await attachmentFailuresFromMysql(mysql, stateBids);
  const accountFeatureFailures = accountFeatureMatrixCheck();
  const requireSourceApproval = shouldRequireSourceApproval(options);
  const governanceFailures = await sourceGovernanceFailuresFromMysql(mysql, { requireSourceApproval });
  const validityMetadataFailures = sourceValidityMetadataFailures();
  const stateUrlFailures = bidUrlValidityFailures(stateBids);
  const globalUrlFailures = bidUrlValidityFailures(allBids);

  const checks = [
    stateCoverageCheck({ requiredStates, availableStates, seedData }),
    check(
      "state-content",
      "State bid content is non-empty",
      emptyContentBids.length === 0,
      `${stateBids.length} state bids checked for title, issuer, URL, state, and description`,
      emptyContentBids.map((bidId) => `${bidId} has empty required content`),
    ),
    check(
      "bid-detail-routes",
      "Bid detail route IDs round trip",
      routeFailures.length === 0 && lookupFailures.length === 0,
      `${stateBids.length} state bid IDs checked through route encoding and local lookup`,
      [
        ...routeFailures.map((bidId) => `${bidId} fails route encode/decode round trip`),
        ...lookupFailures.map((bidId) => `${bidId} cannot be found by detail lookup`),
      ],
    ),
    check(
      "attachment-downloads",
      "Attachments use safe non-404 download routes",
      safeAttachmentFailures.length === 0,
      `${stateBids.reduce((total, bid) => total + bid.attachments.length, 0)} state attachments checked`,
      safeAttachmentFailures,
    ),
    check(
      "account-tier-separation",
      "Admin and paid feature separation",
      accountFeatureFailures.length === 0,
      "free, pro, business, and admin entitlement matrix checked",
      accountFeatureFailures,
    ),
    check(
      "source-ingestion-governance",
      "Source ingestion governance metadata",
      governanceFailures.length === 0,
      `${requiredStates.length} state crawler sources checked for approval metadata, restricted-source blocks, and ${
        requireSourceApproval ? "production approval readiness" : "local ingestion readiness"
      }`,
      governanceFailures,
    ),
    check(
      "source-validity-metadata",
      "50 state source validity metadata",
      validityMetadataFailures.length === 0,
      `${requiredStates.length} state crawler sources checked for authority, trust, evidence mode, and notes`,
      validityMetadataFailures,
    ),
    check(
      "state-url-validity",
      "State source and attachment URLs are production-like",
      stateUrlFailures.length === 0,
      `${stateBids.length} state bids checked for placeholder source URLs and unsafe attachment URLs`,
      stateUrlFailures,
    ),
    check(
      "global-url-validity",
      "All active bid source and attachment URLs are production-like",
      globalUrlFailures.length === 0,
      `${allBids.length} active bids checked for placeholder source URLs and unsafe attachment URLs`,
      globalUrlFailures,
    ),
  ];

  return reportOf(checks, now);
}

const STATUS_WORDS: Record<RiskCheckStatus, string> = { pass: "PASS", fail: "FAIL", not_run: "NOT RUN" };
const OUTCOME_WORDS = { pass: "PASS", fail: "FAIL", incomplete: "INCOMPLETE" } as const;

/**
 * The report as text. A check that was not run reads NOT RUN on its line and is named on the headline, and a report
 * with one is INCOMPLETE rather than PASS, so a reader of the log never takes an unverified result for a verified one.
 */
export function formatRiskChecklistReport(report: RiskChecklistReport) {
  const notRun = report.checks.filter((entry) => riskCheckStatus(entry) === "not_run").map((entry) => entry.id);
  const lines = [
    `Risk checklist ${OUTCOME_WORDS[riskChecklistOutcome(report)]} at ${report.checkedAt}${
      notRun.length > 0 ? ` (NOT RUN: ${notRun.join(", ")})` : ""
    }`,
    ...report.checks.flatMap((entry) => [
      `${STATUS_WORDS[riskCheckStatus(entry)]} ${entry.id}: ${entry.summary}`,
      ...(entry.details ?? []).map((detail) => `  - ${detail}`),
    ]),
  ];

  return lines.join("\n");
}

/** Throws for a report with a failed check. A check that was not run is not a failure: it is reported, not thrown. */
export function assertRiskChecklistReport(report: RiskChecklistReport) {
  if (riskChecklistOutcome(report) === "fail") {
    throw new Error(formatRiskChecklistReport(report));
  }
}
