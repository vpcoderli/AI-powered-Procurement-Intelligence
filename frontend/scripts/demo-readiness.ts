import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { STATE_CRAWLER_SOURCES } from "../src/lib/state-crawler-sources";
import { createDatabase, type AppDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { closeResolvedMysqlPool, isMysqlDatabaseUrlConfigured, resolveMysqlPool, runMysqlMigrations } from "../src/server/db/mysql";
import { mysqlSelectMany } from "../src/server/db/mysql-runtime";
import { seedDatabase } from "../src/server/db/seed";
import { bidAttachments, bids, dataSources } from "../src/server/db/schema";
import { attachmentDownloadUrl } from "../src/server/bids/attachments";
import { validateBidSourceUrl, validateStateAttachmentUrl, type SourceValidityFindingCode } from "../src/server/source-validity/url-validity";
import type { Pool } from "mysql2/promise";

const EXPECTED_STATE_CODES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
] as const;

export interface DemoReadinessDataSourceRow {
  id: string;
  label: string;
  issuerType: string;
  stateCode: string;
  baseUrl: string | null;
  isEnabled: number | boolean | string;
}

export interface DemoReadinessBidRow {
  id: string;
  title: string;
  source: string;
  issuerName: string;
  issuerType: string;
  stateCode: string;
  sourceUrl: string;
  description: string;
  fullDescription: string | null;
  isActive: number | boolean | string;
  displayStatus: string | null;
}

export interface DemoReadinessAttachmentRow {
  id: string;
  bidId: string;
  name: string;
  url: string;
}

export interface DemoReadinessDataset {
  dataSources: DemoReadinessDataSourceRow[];
  bids: DemoReadinessBidRow[];
  attachments: DemoReadinessAttachmentRow[];
}

interface UrlFinding {
  scope: "dataSources" | "bids" | "attachments";
  id: string;
  field: string;
  code: SourceValidityFindingCode;
}

export interface DemoReadinessReport {
  ok: boolean;
  runtime: "sqlite" | "mysql" | "unit";
  checkedAt: string;
  stateSources: {
    total: number;
    states: number;
    missingStates: string[];
  };
  dataSources: {
    total: number;
    stateSources: number;
    enabledStateSources: number;
    visibleStateCodes: number;
    missingStateCodes: string[];
  };
  bids: {
    total: number;
    activeStateBids: number;
    activeStateCodes: number;
    missingStateCodes: string[];
    emptyContentBidIds: string[];
  };
  attachments: {
    total: number;
    stateAttachments: number;
    safeLocalRoutes: number;
    invalidAttachmentIds: string[];
  };
  knownPlaceholderUrls: {
    count: number;
    findings: UrlFinding[];
  };
  blockers: string[];
}

interface CliOptions {
  mode: "prepare" | "check";
  json: boolean;
  sqlitePath: string;
}

function toStateCode(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

function truthyDatabaseFlag(value: number | boolean | string | null | undefined) {
  return value === true || value === 1 || value === "1";
}

function plural(count: number, singular: string, pluralText = `${singular}s`) {
  return count === 1 ? singular : pluralText;
}

function missingStates(present: Iterable<string>) {
  const presentSet = new Set([...present].map(toStateCode).filter(Boolean));
  return EXPECTED_STATE_CODES.filter((stateCode) => !presentSet.has(stateCode));
}

function isActiveDemoBid(bid: DemoReadinessBidRow) {
  return truthyDatabaseFlag(bid.isActive) && bid.displayStatus !== "suppressed";
}

function hasRequiredBidContent(bid: DemoReadinessBidRow) {
  return Boolean(
    bid.title.trim() &&
    bid.issuerName.trim() &&
    bid.sourceUrl.trim() &&
    bid.stateCode.trim() &&
    (bid.description.trim() || (bid.fullDescription ?? "").trim()),
  );
}

function safeAttachmentRoute(url: string) {
  return url.startsWith("/api/bids/") && url.includes("/attachments/");
}

export function stateAttachmentRouteUpdates(dataset: DemoReadinessDataset) {
  const activeStateBidIds = new Set(
    dataset.bids
      .filter((bid) => bid.issuerType === "state" && isActiveDemoBid(bid))
      .map((bid) => bid.id),
  );

  return dataset.attachments
    .filter((attachment) => activeStateBidIds.has(attachment.bidId) && !safeAttachmentRoute(attachment.url))
    .map((attachment) => ({
      id: attachment.id,
      bidId: attachment.bidId,
      previousUrl: attachment.url,
      nextUrl: attachmentDownloadUrl(attachment.bidId, attachment.id),
    }));
}

function appendUrlFindings(
  findings: UrlFinding[],
  scope: UrlFinding["scope"],
  id: string,
  field: string,
  codes: SourceValidityFindingCode[],
) {
  for (const code of codes) {
    findings.push({ scope, id, field, code });
  }
}

export function buildDemoReadinessReport(
  dataset: DemoReadinessDataset,
  now = new Date(),
  runtime: DemoReadinessReport["runtime"] = "unit",
): DemoReadinessReport {
  const registryStateCodes = new Set(STATE_CRAWLER_SOURCES.map((source) => source.stateCode));
  const stateSourceRows = dataset.dataSources.filter((source) => source.issuerType === "state");
  const enabledStateSourcesByState = new Map<string, number>();
  for (const source of stateSourceRows) {
    if (!truthyDatabaseFlag(source.isEnabled)) continue;
    const stateCode = toStateCode(source.stateCode);
    if (!stateCode) continue;
    enabledStateSourcesByState.set(stateCode, (enabledStateSourcesByState.get(stateCode) ?? 0) + 1);
  }
  const duplicateEnabledSourceStates = [...enabledStateSourcesByState]
    .filter(([, count]) => count > 1)
    .map(([stateCode]) => stateCode)
    .sort();
  const visibleStateCodes = new Set(stateSourceRows.map((source) => toStateCode(source.stateCode)).filter(Boolean));
  const activeStateBids = dataset.bids.filter(
    (bid) => bid.issuerType === "state" && isActiveDemoBid(bid),
  );
  const activeStateBidIds = new Set(activeStateBids.map((bid) => bid.id));
  const activeStateCodes = new Set(activeStateBids.map((bid) => toStateCode(bid.stateCode)).filter(Boolean));
  const stateAttachments = dataset.attachments.filter((attachment) => activeStateBidIds.has(attachment.bidId));
  const urlFindings: UrlFinding[] = [];

  for (const source of stateSourceRows) {
    appendUrlFindings(
      urlFindings,
      "dataSources",
      source.id,
      "baseUrl",
      validateBidSourceUrl(source.baseUrl ?? "").map((finding) => finding.code),
    );
  }

  for (const bid of dataset.bids.filter(isActiveDemoBid)) {
    appendUrlFindings(
      urlFindings,
      "bids",
      bid.id,
      "sourceUrl",
      validateBidSourceUrl(bid.sourceUrl).map((finding) => finding.code),
    );
  }

  for (const attachment of stateAttachments) {
    appendUrlFindings(
      urlFindings,
      "attachments",
      attachment.id,
      "url",
      validateStateAttachmentUrl(attachment.url).map((finding) => finding.code),
    );
  }

  const registryMissingStates = missingStates(registryStateCodes);
  const missingDataSourceStates = missingStates(visibleStateCodes);
  const missingBidStates = missingStates(activeStateCodes);
  const emptyContentBidIds = activeStateBids.filter((bid) => !hasRequiredBidContent(bid)).map((bid) => bid.id);
  const invalidAttachmentIds = stateAttachments
    .filter((attachment) => !safeAttachmentRoute(attachment.url))
    .map((attachment) => attachment.id);
  const placeholderFindings = urlFindings.filter((finding) => finding.code === "placeholder_url");
  const blockers: string[] = [];

  if (STATE_CRAWLER_SOURCES.length !== 50 || registryMissingStates.length > 0) {
    blockers.push(
      `state crawler registry has ${STATE_CRAWLER_SOURCES.length} sources and is missing ${registryMissingStates.length} ${plural(
        registryMissingStates.length,
        "state",
      )}: ${registryMissingStates.join(", ") || "none"}`,
    );
  }

  if (missingDataSourceStates.length > 0) {
    blockers.push(
      `data_sources is missing ${missingDataSourceStates.length} state source ${plural(
        missingDataSourceStates.length,
        "row",
      )}: ${missingDataSourceStates.join(", ")}`,
    );
  }

  if (duplicateEnabledSourceStates.length > 0) {
    blockers.push(
      `data_sources has duplicate enabled state source rows for ${duplicateEnabledSourceStates.length} ${plural(
        duplicateEnabledSourceStates.length,
        "state",
      )}: ${duplicateEnabledSourceStates.join(", ")}`,
    );
  }

  if (missingBidStates.length > 0) {
    blockers.push(
      `state bids are missing ${missingBidStates.length} ${plural(missingBidStates.length, "state")}: ${missingBidStates.join(
        ", ",
      )}`,
    );
  }

  if (emptyContentBidIds.length > 0) {
    blockers.push(`${emptyContentBidIds.length} state bids have empty required content: ${emptyContentBidIds.join(", ")}`);
  }

  if (stateAttachments.length === 0) {
    blockers.push("state attachments are empty");
  }

  if (invalidAttachmentIds.length > 0) {
    blockers.push(`${invalidAttachmentIds.length} state attachments do not use safe local routes: ${invalidAttachmentIds.join(", ")}`);
  }

  if (urlFindings.length > 0) {
    blockers.push(
      `${urlFindings.length} URL validity ${plural(urlFindings.length, "finding")}: ${urlFindings
        .map((finding) => `${finding.scope}.${finding.id}.${finding.field} ${finding.code}`)
        .join("; ")}`,
    );
  }

  return {
    ok: blockers.length === 0,
    runtime,
    checkedAt: now.toISOString(),
    stateSources: {
      total: STATE_CRAWLER_SOURCES.length,
      states: registryStateCodes.size,
      missingStates: registryMissingStates,
    },
    dataSources: {
      total: dataset.dataSources.length,
      stateSources: stateSourceRows.length,
      enabledStateSources: stateSourceRows.filter((source) => truthyDatabaseFlag(source.isEnabled)).length,
      visibleStateCodes: visibleStateCodes.size,
      missingStateCodes: missingDataSourceStates,
    },
    bids: {
      total: dataset.bids.length,
      activeStateBids: activeStateBids.length,
      activeStateCodes: activeStateCodes.size,
      missingStateCodes: missingBidStates,
      emptyContentBidIds,
    },
    attachments: {
      total: dataset.attachments.length,
      stateAttachments: stateAttachments.length,
      safeLocalRoutes: stateAttachments.filter((attachment) => safeAttachmentRoute(attachment.url)).length,
      invalidAttachmentIds,
    },
    knownPlaceholderUrls: {
      count: placeholderFindings.length,
      findings: placeholderFindings,
    },
    blockers,
  };
}

export function formatDemoReadinessReport(report: DemoReadinessReport) {
  return [
    `Demo readiness ${report.ok ? "PASS" : "FAIL"} at ${report.checkedAt}`,
    `runtime: ${report.runtime}`,
    `stateSources: ${report.stateSources.total} registry sources, ${report.stateSources.states}/50 states`,
    `dataSources: ${report.dataSources.total} total, ${report.dataSources.stateSources} state rows, ${report.dataSources.visibleStateCodes}/50 state rows visible, ${report.dataSources.enabledStateSources} enabled`,
    `bids: ${report.bids.total} total, ${report.bids.activeStateBids} active state bids, ${report.bids.activeStateCodes}/50 states`,
    `attachments: ${report.attachments.total} total, ${report.attachments.stateAttachments} state attachments, ${report.attachments.safeLocalRoutes} safe local routes`,
    `knownPlaceholderUrls: ${report.knownPlaceholderUrls.count}`,
    ...(report.knownPlaceholderUrls.findings.length > 0
      ? report.knownPlaceholderUrls.findings.map(
        (finding) => `  - ${finding.scope}.${finding.id}.${finding.field} ${finding.code}`,
      )
      : []),
    "blockers:",
    ...(report.blockers.length > 0 ? report.blockers.map((blocker) => `  - ${blocker}`) : ["  - none"]),
  ].join("\n");
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: "prepare",
    json: false,
    sqlitePath: path.resolve(process.env.DATABASE_PATH?.trim() || path.join("data", "apsi.sqlite")),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--check-only" || arg === "--check") {
      options.mode = "check";
    } else if (arg === "--prepare") {
      options.mode = "prepare";
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg.startsWith("--sqlite-path=")) {
      options.sqlitePath = path.resolve(arg.slice("--sqlite-path=".length));
    } else if (arg === "--sqlite-path") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--sqlite-path requires a path.");
      }
      options.sqlitePath = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function demoBidId(sourceId: string) {
  return `${sourceId}_demo_readiness`;
}

function demoAttachmentId(sourceId: string) {
  return `${demoBidId(sourceId)}_attachment`;
}

function demoSourceUrl(baseUrl: string, stateCode: string) {
  return `${baseUrl.replace(/\/$/, "")}/winbids-demo/${stateCode.toLowerCase()}`;
}

function demoAttachmentUrl(sourceId: string) {
  const bidId = demoBidId(sourceId);
  const attachmentId = demoAttachmentId(sourceId);
  return attachmentDownloadUrl(bidId, attachmentId);
}

async function prepareSqliteDemoData(db: AppDatabase, now: string) {
  await seedDatabase(db);

  for (const source of STATE_CRAWLER_SOURCES) {
    const sourceValues = {
      id: source.id,
      label: source.label,
      issuerType: "state",
      stateCode: source.stateCode,
      baseUrl: source.baseUrl,
      isEnabled: 1,
      cadence: "daily",
      providerFamily: "state_portal",
      accessMode: source.accessPattern,
      sourceType: "state_procurement_portal",
      sourceConfidence: source.trustStatus,
      activationStatus: "active",
      requiresBrowser: source.accessPattern === "browser_required" ? 1 : 0,
      requiresManual: source.accessPattern === "login_required" || source.accessPattern === "restricted" ? 1 : 0,
      requiresLogin: source.accessPattern === "login_required" ? 1 : 0,
      supportsQuery: source.capabilities.includes("query") ? 1 : 0,
      supportsPagination: source.capabilities.includes("pagination") ? 1 : 0,
      supportsAttachmentMetadata: source.capabilities.includes("attachments") ? 1 : 0,
      supportsDetailPageFetch: source.capabilities.includes("detail_pages") ? 1 : 0,
      fallbackNotes: source.validityNotes,
      approvedForIngestion: source.approvedForIngestion ? 1 : 0,
      approvalStatus: source.approvalStatus,
      accessPattern: source.accessPattern,
      legalReviewStatus: source.legalReviewStatus,
      sourceOwner: source.sourceOwner,
      approvalNotes: source.approvalNotes,
      lastApprovalReviewedAt: source.lastApprovalReviewedAt,
      updatedAt: now,
      createdAt: now,
    };

    db.insert(dataSources)
      .values(sourceValues)
      .onConflictDoUpdate({
        target: dataSources.id,
        set: {
          label: sourceValues.label,
          issuerType: sourceValues.issuerType,
          stateCode: sourceValues.stateCode,
          baseUrl: sourceValues.baseUrl,
          isEnabled: sourceValues.isEnabled,
          cadence: sourceValues.cadence,
          providerFamily: sourceValues.providerFamily,
          accessMode: sourceValues.accessMode,
          sourceType: sourceValues.sourceType,
          sourceConfidence: sourceValues.sourceConfidence,
          activationStatus: sourceValues.activationStatus,
          requiresBrowser: sourceValues.requiresBrowser,
          requiresManual: sourceValues.requiresManual,
          requiresLogin: sourceValues.requiresLogin,
          supportsQuery: sourceValues.supportsQuery,
          supportsPagination: sourceValues.supportsPagination,
          supportsAttachmentMetadata: sourceValues.supportsAttachmentMetadata,
          supportsDetailPageFetch: sourceValues.supportsDetailPageFetch,
          fallbackNotes: sourceValues.fallbackNotes,
          approvedForIngestion: sourceValues.approvedForIngestion,
          approvalStatus: sourceValues.approvalStatus,
          accessPattern: sourceValues.accessPattern,
          legalReviewStatus: sourceValues.legalReviewStatus,
          sourceOwner: sourceValues.sourceOwner,
          approvalNotes: sourceValues.approvalNotes,
          lastApprovalReviewedAt: sourceValues.lastApprovalReviewedAt,
          updatedAt: sourceValues.updatedAt,
        },
      })
      .run();

    const bidId = demoBidId(source.id);
    const bidValues = {
      id: bidId,
      source: source.label,
      sourceBidId: `demo:${source.id}`,
      dedupeKey: `demo:${source.id}`,
      title: `${source.label} Demo Readiness Opportunity`,
      description: `Demo-ready ${source.stateCode} procurement summary for Admin/source operations validation.`,
      fullDescription: `Detailed local demo procurement narrative for ${source.stateCode}. This record is deterministic and does not require external network access.`,
      originalCategory: "General Procurement",
      amount: "$50,000",
      amountMin: 50_000,
      amountMax: 50_000,
      currency: "USD",
      publishedDate: "2026-06-01",
      deadlineDate: "2026-08-15",
      issuerName: source.label,
      issuerType: "state",
      stateCode: source.stateCode,
      contactName: "Procurement Office",
      contactEmail: `procurement.${source.stateCode.toLowerCase()}@example.gov`,
      contactPhone: "+1 (555) 010-0000",
      sourceUrl: demoSourceUrl(source.baseUrl, source.stateCode),
      isActive: 1,
      rawPayload: JSON.stringify({ demoReadiness: true, sourceId: source.id, stateCode: source.stateCode }),
      sourceConfidence: source.trustStatus,
      qualityFlagsJson: "[]",
      adminReviewStatus: "unreviewed",
      displayStatus: "published",
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };

    db.insert(bids)
      .values(bidValues)
      .onConflictDoUpdate({
        target: bids.id,
        set: {
          source: bidValues.source,
          sourceBidId: bidValues.sourceBidId,
          dedupeKey: bidValues.dedupeKey,
          title: bidValues.title,
          description: bidValues.description,
          fullDescription: bidValues.fullDescription,
          originalCategory: bidValues.originalCategory,
          amount: bidValues.amount,
          amountMin: bidValues.amountMin,
          amountMax: bidValues.amountMax,
          currency: bidValues.currency,
          publishedDate: bidValues.publishedDate,
          deadlineDate: bidValues.deadlineDate,
          issuerName: bidValues.issuerName,
          issuerType: bidValues.issuerType,
          stateCode: bidValues.stateCode,
          contactName: bidValues.contactName,
          contactEmail: bidValues.contactEmail,
          contactPhone: bidValues.contactPhone,
          sourceUrl: bidValues.sourceUrl,
          isActive: bidValues.isActive,
          rawPayload: bidValues.rawPayload,
          sourceConfidence: bidValues.sourceConfidence,
          qualityFlagsJson: bidValues.qualityFlagsJson,
          adminReviewStatus: bidValues.adminReviewStatus,
          displayStatus: bidValues.displayStatus,
          lastSeenAt: bidValues.lastSeenAt,
          updatedAt: bidValues.updatedAt,
        },
      })
      .run();

    db.delete(bidAttachments).where(eq(bidAttachments.bidId, bidId)).run();
    db.insert(bidAttachments)
      .values({
        id: demoAttachmentId(source.id),
        bidId,
        name: `${source.stateCode}_Demo_Readiness_SOW.pdf`,
        url: demoAttachmentUrl(source.id),
        originalUrl: demoSourceUrl(source.baseUrl, source.stateCode),
        archiveStatus: "not_archived",
        sizeLabel: "128 KB",
        mimeType: "application/pdf",
        sortOrder: 1,
        createdAt: now,
      })
      .run();
  }
}

async function prepareMysqlDemoData(pool: Pool, now: string) {
  for (const source of STATE_CRAWLER_SOURCES) {
    await pool.execute(
      `
        INSERT INTO data_sources (
          id,
          label,
          issuer_type,
          state_code,
          base_url,
          is_enabled,
          cadence,
          provider_family,
          access_mode,
          source_type,
          source_confidence,
          activation_status,
          requires_browser,
          requires_manual,
          requires_login,
          supports_query,
          supports_pagination,
          supports_attachment_metadata,
          supports_detail_page_fetch,
          fallback_notes,
          approved_for_ingestion,
          approval_status,
          access_pattern,
          legal_review_status,
          source_owner,
          approval_notes,
          last_approval_reviewed_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          label = VALUES(label),
          issuer_type = VALUES(issuer_type),
          state_code = VALUES(state_code),
          base_url = VALUES(base_url),
          is_enabled = VALUES(is_enabled),
          cadence = VALUES(cadence),
          provider_family = VALUES(provider_family),
          access_mode = VALUES(access_mode),
          source_type = VALUES(source_type),
          source_confidence = VALUES(source_confidence),
          activation_status = VALUES(activation_status),
          requires_browser = VALUES(requires_browser),
          requires_manual = VALUES(requires_manual),
          requires_login = VALUES(requires_login),
          supports_query = VALUES(supports_query),
          supports_pagination = VALUES(supports_pagination),
          supports_attachment_metadata = VALUES(supports_attachment_metadata),
          supports_detail_page_fetch = VALUES(supports_detail_page_fetch),
          fallback_notes = VALUES(fallback_notes),
          approved_for_ingestion = VALUES(approved_for_ingestion),
          approval_status = VALUES(approval_status),
          access_pattern = VALUES(access_pattern),
          legal_review_status = VALUES(legal_review_status),
          source_owner = VALUES(source_owner),
          approval_notes = VALUES(approval_notes),
          last_approval_reviewed_at = VALUES(last_approval_reviewed_at),
          updated_at = VALUES(updated_at)
      `,
      [
        source.id,
        source.label,
        "state",
        source.stateCode,
        source.baseUrl,
        1,
        "daily",
        "state_portal",
        source.accessPattern,
        "state_procurement_portal",
        source.trustStatus,
        "active",
        source.accessPattern === "browser_required" ? 1 : 0,
        source.accessPattern === "login_required" || source.accessPattern === "restricted" ? 1 : 0,
        source.accessPattern === "login_required" ? 1 : 0,
        source.capabilities.includes("query") ? 1 : 0,
        source.capabilities.includes("pagination") ? 1 : 0,
        source.capabilities.includes("attachments") ? 1 : 0,
        source.capabilities.includes("detail_pages") ? 1 : 0,
        source.validityNotes,
        source.approvedForIngestion ? 1 : 0,
        source.approvalStatus,
        source.accessPattern,
        source.legalReviewStatus,
        source.sourceOwner,
        source.approvalNotes,
        source.lastApprovalReviewedAt,
        now,
        now,
      ],
    );

    const bidId = demoBidId(source.id);
    await pool.execute(
      `
        INSERT INTO bids (
          id,
          source,
          source_bid_id,
          dedupe_key,
          title,
          description,
          full_description,
          original_category,
          amount,
          amount_min,
          amount_max,
          currency,
          published_date,
          deadline_date,
          issuer_name,
          issuer_type,
          state_code,
          contact_name,
          contact_email,
          contact_phone,
          source_url,
          is_active,
          raw_payload,
          source_confidence,
          quality_flags_json,
          admin_review_status,
          display_status,
          first_seen_at,
          last_seen_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          source = VALUES(source),
          source_bid_id = VALUES(source_bid_id),
          dedupe_key = VALUES(dedupe_key),
          title = VALUES(title),
          description = VALUES(description),
          full_description = VALUES(full_description),
          original_category = VALUES(original_category),
          amount = VALUES(amount),
          amount_min = VALUES(amount_min),
          amount_max = VALUES(amount_max),
          currency = VALUES(currency),
          published_date = VALUES(published_date),
          deadline_date = VALUES(deadline_date),
          issuer_name = VALUES(issuer_name),
          issuer_type = VALUES(issuer_type),
          state_code = VALUES(state_code),
          contact_name = VALUES(contact_name),
          contact_email = VALUES(contact_email),
          contact_phone = VALUES(contact_phone),
          source_url = VALUES(source_url),
          is_active = VALUES(is_active),
          raw_payload = VALUES(raw_payload),
          source_confidence = VALUES(source_confidence),
          quality_flags_json = VALUES(quality_flags_json),
          admin_review_status = VALUES(admin_review_status),
          display_status = VALUES(display_status),
          last_seen_at = VALUES(last_seen_at),
          updated_at = VALUES(updated_at)
      `,
      [
        bidId,
        source.label,
        `demo:${source.id}`,
        `demo:${source.id}`,
        `${source.label} Demo Readiness Opportunity`,
        `Demo-ready ${source.stateCode} procurement summary for Admin/source operations validation.`,
        `Detailed local demo procurement narrative for ${source.stateCode}. This record is deterministic and does not require external network access.`,
        "General Procurement",
        "$50,000",
        50_000,
        50_000,
        "USD",
        "2026-06-01",
        "2026-08-15",
        source.label,
        "state",
        source.stateCode,
        "Procurement Office",
        `procurement.${source.stateCode.toLowerCase()}@example.gov`,
        "+1 (555) 010-0000",
        demoSourceUrl(source.baseUrl, source.stateCode),
        1,
        JSON.stringify({ demoReadiness: true, sourceId: source.id, stateCode: source.stateCode }),
        source.trustStatus,
        "[]",
        "unreviewed",
        "published",
        now,
        now,
        now,
        now,
      ],
    );

    await pool.execute("DELETE FROM bid_attachments WHERE bid_id = ?", [bidId]);
    await pool.execute(
      `
        INSERT INTO bid_attachments (
          id,
          bid_id,
          name,
          url,
          original_url,
          archive_status,
          size_label,
          mime_type,
          sort_order,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        demoAttachmentId(source.id),
        bidId,
        `${source.stateCode}_Demo_Readiness_SOW.pdf`,
        demoAttachmentUrl(source.id),
        demoSourceUrl(source.baseUrl, source.stateCode),
        "not_archived",
        "128 KB",
        "application/pdf",
        1,
        now,
      ],
    );
  }
}

function normalizeSqliteStateAttachmentRoutes(db: AppDatabase) {
  const updates = stateAttachmentRouteUpdates(sqliteDataset(db));

  for (const update of updates) {
    db.update(bidAttachments)
      .set({
        url: update.nextUrl,
        originalUrl: update.previousUrl,
      })
      .where(eq(bidAttachments.id, update.id))
      .run();
  }

  return updates.length;
}

async function normalizeMysqlStateAttachmentRoutes(pool: Pool) {
  const updates = stateAttachmentRouteUpdates(await mysqlDataset(pool));

  for (const update of updates) {
    await pool.execute(
      `
        UPDATE bid_attachments
        SET
          url = ?,
          original_url = COALESCE(original_url, ?)
        WHERE id = ? AND bid_id = ?
      `,
      [update.nextUrl, update.previousUrl, update.id, update.bidId],
    );
  }

  return updates.length;
}

function sqliteDataset(db: AppDatabase): DemoReadinessDataset {
  return {
    dataSources: db.select().from(dataSources).all().map((source) => ({
      id: source.id,
      label: source.label,
      issuerType: source.issuerType,
      stateCode: source.stateCode,
      baseUrl: source.baseUrl,
      isEnabled: source.isEnabled,
    })),
    bids: db.select().from(bids).all().map((bid) => ({
      id: bid.id,
      title: bid.title,
      source: bid.source,
      issuerName: bid.issuerName,
      issuerType: bid.issuerType,
      stateCode: bid.stateCode,
      sourceUrl: bid.sourceUrl,
      description: bid.description,
      fullDescription: bid.fullDescription,
      isActive: bid.isActive,
      displayStatus: bid.displayStatus,
    })),
    attachments: db.select().from(bidAttachments).all().map((attachment) => ({
      id: attachment.id,
      bidId: attachment.bidId,
      name: attachment.name,
      url: attachment.url,
    })),
  };
}

async function mysqlDataset(pool: Pool): Promise<DemoReadinessDataset> {
  const sourceRows = await mysqlSelectMany<Record<string, unknown>>(
    pool,
    `
      SELECT
        id,
        label,
        issuer_type AS issuerType,
        state_code AS stateCode,
        base_url AS baseUrl,
        is_enabled AS isEnabled
      FROM data_sources
    `,
  );
  const bidRows = await mysqlSelectMany<Record<string, unknown>>(
    pool,
    `
      SELECT
        id,
        title,
        source,
        issuer_name AS issuerName,
        issuer_type AS issuerType,
        state_code AS stateCode,
        source_url AS sourceUrl,
        description,
        full_description AS fullDescription,
        is_active AS isActive,
        display_status AS displayStatus
      FROM bids
    `,
  );
  const attachmentRows = await mysqlSelectMany<Record<string, unknown>>(
    pool,
    `
      SELECT
        id,
        bid_id AS bidId,
        name,
        url
      FROM bid_attachments
    `,
  );

  return {
    dataSources: sourceRows.map((source) => ({
      id: String(source.id ?? ""),
      label: String(source.label ?? ""),
      issuerType: String(source.issuerType ?? ""),
      stateCode: String(source.stateCode ?? ""),
      baseUrl: source.baseUrl === null || source.baseUrl === undefined ? null : String(source.baseUrl),
      isEnabled: Number(source.isEnabled ?? 0),
    })),
    bids: bidRows.map((bid) => ({
      id: String(bid.id ?? ""),
      title: String(bid.title ?? ""),
      source: String(bid.source ?? ""),
      issuerName: String(bid.issuerName ?? ""),
      issuerType: String(bid.issuerType ?? ""),
      stateCode: String(bid.stateCode ?? ""),
      sourceUrl: String(bid.sourceUrl ?? ""),
      description: String(bid.description ?? ""),
      fullDescription: bid.fullDescription === null || bid.fullDescription === undefined ? null : String(bid.fullDescription),
      isActive: Number(bid.isActive ?? 0),
      displayStatus: bid.displayStatus === null || bid.displayStatus === undefined ? null : String(bid.displayStatus),
    })),
    attachments: attachmentRows.map((attachment) => ({
      id: String(attachment.id ?? ""),
      bidId: String(attachment.bidId ?? ""),
      name: String(attachment.name ?? ""),
      url: String(attachment.url ?? ""),
    })),
  };
}

async function runSqlite(options: CliOptions) {
  const db = createDatabase(options.sqlitePath);
  try {
    if (options.mode === "prepare") {
      runMigrations(db);
      await prepareSqliteDemoData(db, new Date().toISOString());
      normalizeSqliteStateAttachmentRoutes(db);
    }

    return buildDemoReadinessReport(sqliteDataset(db), new Date(), "sqlite");
  } finally {
    db.$client.close();
  }
}

async function runMysql(options: CliOptions) {
  const pool = resolveMysqlPool();
  if (options.mode === "prepare") {
    await runMysqlMigrations(pool);
    await prepareMysqlDemoData(pool, new Date().toISOString());
    await normalizeMysqlStateAttachmentRoutes(pool);
  }

  return buildDemoReadinessReport(await mysqlDataset(pool), new Date(), "mysql");
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const report = isMysqlDatabaseUrlConfigured() ? await runMysql(options) : await runSqlite(options);

  console.log(options.json ? JSON.stringify(report, null, 2) : formatDemoReadinessReport(report));

  if (!report.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Demo readiness check failed.");
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeResolvedMysqlPool();
    });
}
