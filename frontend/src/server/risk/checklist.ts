import { STATE_CRAWLER_SOURCES } from "@/lib/state-crawler-sources";
import { bidDetailPath, bidIdFromRouteParam } from "@/lib/bid-routes";
import { getBidAttachmentDownload } from "@/server/bids/attachments";
import { getBidByIdFromRepository } from "@/server/bids/repository";
import { queryBidsFromDatabase } from "@/server/bids/service";
import type { Bid } from "@/server/bids/domain";
import type { AppDatabase } from "@/server/db/client";
import { featuresForUser, hasFeature } from "@/server/auth/entitlements";

export interface RiskChecklistCheck {
  id: string;
  label: string;
  ok: boolean;
  summary: string;
  details?: string[];
}

export interface RiskChecklistReport {
  ok: boolean;
  checkedAt: string;
  checks: RiskChecklistCheck[];
}

function check(id: string, label: string, ok: boolean, summary: string, details: string[] = []): RiskChecklistCheck {
  return {
    id,
    label,
    ok,
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

export async function createRiskChecklistReport(db: AppDatabase, now = new Date()): Promise<RiskChecklistReport> {
  const stateResponse = await queryBidsFromDatabase(db, { issuerType: "state" });
  const stateBids = stateResponse.bids;
  const requiredStates = requiredStateCodes();
  const availableStates = statesWithBids(stateBids);
  const missingStates = requiredStates.filter((stateCode) => !availableStates.includes(stateCode));
  const emptyContentBids = stateBids.filter((bid) => !hasRequiredContent(bid)).map((bid) => bid.id);
  const routeFailures = routeRoundTripFailures(stateBids);
  const lookupFailures = await detailLookupFailures(db, stateBids);
  const safeAttachmentFailures = await attachmentFailures(db, stateBids);
  const accountFeatureFailures = accountFeatureMatrixCheck();

  const checks = [
    check(
      "state-coverage",
      "50 state data coverage",
      requiredStates.length === 50 && missingStates.length === 0,
      `${availableStates.length}/${requiredStates.length} required states have at least one active bid`,
      missingStates.map((stateCode) => `missing state ${stateCode}`),
    ),
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
  ];

  return {
    ok: checks.every((entry) => entry.ok),
    checkedAt: now.toISOString(),
    checks,
  };
}

export function formatRiskChecklistReport(report: RiskChecklistReport) {
  const lines = [
    `Risk checklist ${report.ok ? "PASS" : "FAIL"} at ${report.checkedAt}`,
    ...report.checks.flatMap((entry) => [
      `${entry.ok ? "PASS" : "FAIL"} ${entry.id}: ${entry.summary}`,
      ...(entry.details ?? []).map((detail) => `  - ${detail}`),
    ]),
  ];

  return lines.join("\n");
}

export function assertRiskChecklistReport(report: RiskChecklistReport) {
  if (!report.ok) {
    throw new Error(formatRiskChecklistReport(report));
  }
}
