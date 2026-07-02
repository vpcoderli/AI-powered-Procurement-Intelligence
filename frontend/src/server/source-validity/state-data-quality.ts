import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { desc, eq, ne } from "drizzle-orm";
import { STATE_CRAWLER_SOURCES, type StateCrawlerSourceMetadata } from "@/lib/state-crawler-sources";
import { bidDetailPath, bidIdFromRouteParam } from "@/lib/bid-routes";
import type { AppDatabase } from "@/server/db/client";
import { mysqlSelectMany } from "@/server/db/mysql-runtime";
import { bidAttachments, bids, crawlerLogs, dataSources, riskCheckSnapshots, sourceHealthSnapshots } from "@/server/db/schema";
import { validateBidSourceUrl } from "./url-validity";

export type StateDataQualitySeverity = "P0" | "P1" | "P2";
export type StateDataQualityRiskLevel = "PASS" | StateDataQualitySeverity;
export type StateAttachmentQualityStatus = "real_file_openable" | "download_note" | "missing_or_failed";

export type StateDataQualityReasonCode =
  | "missing_state_bid"
  | "empty_core_field"
  | "detail_route_invalid"
  | "detail_archive_invalid"
  | "attachment_archive_invalid"
  | "attachment_missing_or_failed"
  | "placeholder_or_unsafe_url"
  | "missing_source_validity_metadata"
  | "duplicate_canonical_enabled_source"
  | "crawler_success_zero_rows"
  | "fixture_fallback"
  | "crawler_stale_or_missing"
  | "risk_check_stale_or_missing"
  | "source_health_stale_or_missing"
  | "source_health_unhealthy"
  | "needs_review_source"
  | "attachment_download_note";

export interface StateDataQualityReason {
  code: StateDataQualityReasonCode;
  severity: StateDataQualitySeverity;
  message: string;
}

export interface StateDataQualityAction {
  id: string;
  priority: StateDataQualitySeverity;
  stateCode: string;
  sourceId: string;
  sourceLabel: string;
  reasonCode: StateDataQualityReasonCode;
  title: string;
  recommendedAction: string;
  ownerHint: string;
  dueInHours: number;
  evidence: string;
}

export interface StateAttachmentWorklistItem {
  id: string;
  stateCode: string;
  sourceId: string;
  sourceLabel: string;
  bidId: string;
  attachmentId: string;
  name: string;
  archiveStatus: string;
  originalUrl: string | null;
  recommendedAction: string;
  evidence: string;
}

export interface StateAttachmentQualitySummary {
  total: number;
  realFileOpenable: number;
  downloadNote: number;
  missingOrFailed: number;
}

export interface StateDataQualityRow {
  stateCode: string;
  sourceId: string;
  sourceLabel: string;
  sourceUrl: string;
  riskLevel: StateDataQualityRiskLevel;
  bidCount: number;
  enabledSourceCount: number;
  latestCrawlerStartedAt: string | null;
  latestSourceHealthCheckedAt: string | null;
  latestRiskCheckCheckedAt: string | null;
  attachmentStatus: StateAttachmentQualityStatus;
  attachmentSummary: StateAttachmentQualitySummary;
  reasons: StateDataQualityReason[];
}

export interface StateDataQualityReport {
  ok: boolean;
  checkedAt: string;
  summary: {
    totalStates: number;
    p0BlockerStates: number;
    p1WarningStates: number;
    p2WarningStates: number;
  };
  actions: StateDataQualityAction[];
  attachmentWorklist: StateAttachmentWorklistItem[];
  rows: StateDataQualityRow[];
}

export interface StateDataQualityOptions {
  attachmentRoots?: string[];
  maxCrawlerAgeMs?: number;
  maxRiskCheckAgeMs?: number;
  maxSourceHealthAgeMs?: number;
}

export interface MysqlStateDataQualityReader {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
}

export interface CanonicalStateSourceCleanupResult {
  checkedStates: number;
  disabledSourceIds: string[];
  enabledCanonicalSourceIds: string[];
  unresolvedStateCodes: string[];
}

type BidRow = typeof bids.$inferSelect;
type AttachmentRow = typeof bidAttachments.$inferSelect;
type DataSourceRow = typeof dataSources.$inferSelect;
type CrawlerLogRow = typeof crawlerLogs.$inferSelect;
type SourceHealthSnapshotRow = typeof sourceHealthSnapshots.$inferSelect;
type RiskCheckSnapshotRow = typeof riskCheckSnapshots.$inferSelect;

interface StateDataQualityDataset {
  bids: BidRow[];
  attachments: AttachmentRow[];
  dataSources: DataSourceRow[];
  crawlerLogs: CrawlerLogRow[];
  latestRiskCheck: RiskCheckSnapshotRow | undefined;
  latestSourceHealth: SourceHealthSnapshotRow | undefined;
}

const DEFAULT_CRAWLER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_RISK_CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SOURCE_HEALTH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const STATE_DATA_QUALITY_REASON_SEVERITY = {
  missing_state_bid: "P0",
  empty_core_field: "P0",
  detail_route_invalid: "P0",
  detail_archive_invalid: "P0",
  attachment_archive_invalid: "P0",
  attachment_missing_or_failed: "P0",
  placeholder_or_unsafe_url: "P0",
  missing_source_validity_metadata: "P0",
  duplicate_canonical_enabled_source: "P0",
  crawler_success_zero_rows: "P0",
  fixture_fallback: "P1",
  crawler_stale_or_missing: "P1",
  risk_check_stale_or_missing: "P2",
  source_health_stale_or_missing: "P2",
  source_health_unhealthy: "P1",
  needs_review_source: "P2",
  attachment_download_note: "P2",
} as const satisfies Record<StateDataQualityReasonCode, StateDataQualitySeverity>;

export function cleanupDuplicateCanonicalStateSources(
  db: AppDatabase,
  now = new Date(),
): CanonicalStateSourceCleanupResult {
  const sourceRows = db.select().from(dataSources).all();
  const canonicalByState = new Map(STATE_CRAWLER_SOURCES.map((source) => [source.stateCode, source.id]));
  const disabledSourceIds: string[] = [];
  const enabledCanonicalSourceIds: string[] = [];
  const unresolvedStateCodes: string[] = [];
  const updatedAt = now.toISOString();

  for (const [stateCode, canonicalSourceId] of canonicalByState) {
    const stateSources = sourceRows.filter(
      (source) => source.issuerType === "state" && source.stateCode.toUpperCase() === stateCode,
    );
    const canonicalSource = stateSources.find((source) => source.id === canonicalSourceId);
    if (!canonicalSource) {
      unresolvedStateCodes.push(stateCode);
      continue;
    }

    if (canonicalSource.isEnabled !== 1) {
      db.update(dataSources)
        .set({ isEnabled: 1, updatedAt })
        .where(eq(dataSources.id, canonicalSource.id))
        .run();
      enabledCanonicalSourceIds.push(canonicalSource.id);
    }

    for (const source of stateSources) {
      if (source.id === canonicalSourceId || source.isEnabled !== 1) continue;

      db.update(dataSources)
        .set({ isEnabled: 0, updatedAt })
        .where(eq(dataSources.id, source.id))
        .run();
      disabledSourceIds.push(source.id);
    }
  }

  return {
    checkedStates: canonicalByState.size,
    disabledSourceIds,
    enabledCanonicalSourceIds,
    unresolvedStateCodes,
  };
}

function reason(code: StateDataQualityReasonCode, message: string): StateDataQualityReason {
  return {
    code,
    severity: STATE_DATA_QUALITY_REASON_SEVERITY[code],
    message,
  };
}

function rowsByState<T extends { stateCode: string }>(rows: T[]) {
  const byState = new Map<string, T[]>();
  for (const row of rows) {
    const stateCode = row.stateCode.toUpperCase();
    const current = byState.get(stateCode) ?? [];
    current.push(row);
    byState.set(stateCode, current);
  }
  return byState;
}

function attachmentsByBid(rows: AttachmentRow[]) {
  const byBid = new Map<string, AttachmentRow[]>();
  for (const row of rows) {
    const current = byBid.get(row.bidId) ?? [];
    current.push(row);
    byBid.set(row.bidId, current);
  }
  return byBid;
}

function activeStateBids(db: AppDatabase) {
  return db
    .select()
    .from(bids)
    .where(ne(bids.displayStatus, "suppressed"))
    .all()
    .filter((bid) => bid.issuerType === "state" && bid.isActive === 1);
}

function enabledStateSourcesByState(rows: DataSourceRow[]) {
  return rowsByState(rows.filter((row) => row.issuerType === "state" && row.isEnabled === 1));
}

function latestCrawlerLogsBySource(rows: CrawlerLogRow[]) {
  const latest = new Map<string, CrawlerLogRow>();
  for (const row of rows) {
    if (!latest.has(row.source)) {
      latest.set(row.source, row);
    }
  }
  return latest;
}

function sourceHealthResultsByState(snapshot: SourceHealthSnapshotRow | undefined) {
  if (!snapshot) return new Map<string, Record<string, unknown>>();

  try {
    const parsed = JSON.parse(snapshot.resultsJson) as unknown;
    if (!Array.isArray(parsed)) return new Map<string, Record<string, unknown>>();

    return new Map(
      parsed
        .filter((result): result is Record<string, unknown> => typeof result === "object" && result !== null)
        .map((result) => [String(result.stateCode ?? "").toUpperCase(), result]),
    );
  } catch {
    return new Map<string, Record<string, unknown>>();
  }
}

function isStale(value: string | null | undefined, now: Date, maxAgeMs: number) {
  if (!value) return true;
  const timestamp = new Date(value).getTime();
  return !Number.isFinite(timestamp) || now.getTime() - timestamp > maxAgeMs;
}

function coreFieldFailures(bid: BidRow) {
  return [
    bid.title.trim() ? null : "title",
    bid.issuerName.trim() ? null : "issuerName",
    bid.sourceUrl.trim() ? null : "sourceUrl",
    bid.stateCode.trim() ? null : "stateCode",
    bid.description.trim() || bid.fullDescription?.trim() ? null : "description",
  ].filter((value): value is string => Boolean(value));
}

function routeParamFromPath(routePath: string) {
  const prefix = "/bids/";
  return routePath.startsWith(prefix) ? routePath.slice(prefix.length) : routePath;
}

function detailRouteIsOpenable(bid: BidRow) {
  const routeParam = routeParamFromPath(bidDetailPath(bid.id));
  return bidIdFromRouteParam(routeParam) === bid.id;
}

function validityMetadataFailures(source: StateCrawlerSourceMetadata) {
  return [
    source.sourceAuthority ? null : "sourceAuthority",
    source.trustStatus ? null : "trustStatus",
    source.evidenceMode ? null : "evidenceMode",
    source.validityNotes.trim() ? null : "validityNotes",
  ].filter((value): value is string => Boolean(value));
}

function defaultAttachmentRoots() {
  const configuredRoots = (process.env.CRAWLER_ATTACHMENT_DIR ?? "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);

  return [path.join(process.cwd(), "data", "attachments"), ...configuredRoots];
}

function relativeArchivePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/^data\/attachments\//, "");
}

function candidateArchivePaths(value: string, roots: string[]) {
  if (value.startsWith("file://")) {
    try {
      return [fileURLToPath(value)];
    } catch {
      return [];
    }
  }

  if (path.isAbsolute(value)) return [value];

  const relativePath = relativeArchivePath(value);
  return roots.map((root) => path.resolve(root, relativePath));
}

async function verifiedArchiveFile(value: string | null, checksumSha256: string | null, roots: string[]) {
  if (!value?.trim() || !checksumSha256?.trim()) return false;

  for (const candidate of candidateArchivePaths(value, roots)) {
    const fileStats = await stat(candidate).catch(() => undefined);
    if (!fileStats?.isFile()) continue;

    const bytes = await readFile(candidate).catch(() => undefined);
    if (!bytes) continue;

    const actualChecksum = createHash("sha256").update(bytes).digest("hex");
    if (actualChecksum === checksumSha256.trim().toLowerCase()) {
      return true;
    }
  }

  return false;
}

function parseLogMetadata(metadata: string | null) {
  if (!metadata) {
    return {
      fallbackSource: null,
      fallbackFixture: null,
    };
  }

  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    return {
      fallbackSource: typeof parsed.fallback_source === "string" ? parsed.fallback_source : null,
      fallbackFixture: typeof parsed.fallback_fixture === "string" ? parsed.fallback_fixture : null,
    };
  } catch {
    return {
      fallbackSource: null,
      fallbackFixture: null,
    };
  }
}

function crawlerRowCount(log: CrawlerLogRow) {
  return log.fetchedCount + log.insertedCount + log.updatedCount;
}

function riskLevelForReasons(reasons: StateDataQualityReason[]): StateDataQualityRiskLevel {
  if (reasons.some((entry) => entry.severity === "P0")) return "P0";
  if (reasons.some((entry) => entry.severity === "P1")) return "P1";
  if (reasons.some((entry) => entry.severity === "P2")) return "P2";
  return "PASS";
}

function attachmentStatus(summary: StateAttachmentQualitySummary): StateAttachmentQualityStatus {
  if (summary.missingOrFailed > 0) return "missing_or_failed";
  if (summary.realFileOpenable > 0 && summary.downloadNote === 0) return "real_file_openable";
  return "download_note";
}

function latestCrawlerLogForSource(source: StateCrawlerSourceMetadata, latestLogs: Map<string, CrawlerLogRow>) {
  return latestLogs.get(source.id) ?? latestLogs.get(source.label) ?? latestLogs.get(source.stateCode) ?? null;
}

async function detailArchiveReasons(bid: BidRow, roots: string[]) {
  if (bid.detailArchiveStatus !== "archived") return [];

  const openable = await verifiedArchiveFile(bid.detailArchivePath, bid.detailChecksumSha256, roots);
  return openable
    ? []
    : [
        reason(
          "detail_archive_invalid",
          `${bid.id} is marked archived but its detail archive file or checksum is not valid.`,
        ),
      ];
}

async function attachmentQualityForState(
  source: StateCrawlerSourceMetadata,
  stateBids: BidRow[],
  attachmentRowsByBid: Map<string, AttachmentRow[]>,
  roots: string[],
) {
  const summary: StateAttachmentQualitySummary = {
    total: 0,
    realFileOpenable: 0,
    downloadNote: 0,
    missingOrFailed: 0,
  };
  const reasons: StateDataQualityReason[] = [];
  const worklist: StateAttachmentWorklistItem[] = [];

  for (const bid of stateBids) {
    const attachments = attachmentRowsByBid.get(bid.id) ?? [];
    for (const attachment of attachments) {
      summary.total += 1;

      if (attachment.archiveStatus === "archived") {
        if (await verifiedArchiveFile(attachment.storagePath, attachment.checksumSha256, roots)) {
          summary.realFileOpenable += 1;
        } else {
          summary.missingOrFailed += 1;
          worklist.push({
            id: `${source.stateCode}:${bid.id}:${attachment.id}`,
            stateCode: source.stateCode,
            sourceId: source.id,
            sourceLabel: source.label,
            bidId: bid.id,
            attachmentId: attachment.id,
            name: attachment.name,
            archiveStatus: attachment.archiveStatus,
            originalUrl: attachment.originalUrl,
            recommendedAction: "Re-archive the attachment locally and verify the stored file and checksum.",
            evidence: `${bid.id}/${attachment.id} archived file is missing or checksum validation failed.`,
          });
          reasons.push(
            reason(
              "attachment_archive_invalid",
              `${bid.id}/${attachment.id} is marked archived but its file or checksum is not valid.`,
            ),
          );
        }
        continue;
      }

      if (attachment.archiveStatus === "not_archived") {
        summary.downloadNote += 1;
        worklist.push({
          id: `${source.stateCode}:${bid.id}:${attachment.id}`,
          stateCode: source.stateCode,
          sourceId: source.id,
          sourceLabel: source.label,
          bidId: bid.id,
          attachmentId: attachment.id,
          name: attachment.name,
          archiveStatus: attachment.archiveStatus,
          originalUrl: attachment.originalUrl,
          recommendedAction: "Archive the attachment locally or keep the source download note with explicit risk copy.",
          evidence: `${bid.id}/${attachment.id} is currently represented only by a source download note.`,
        });
        reasons.push(
          reason(
            "attachment_download_note",
            `${bid.id}/${attachment.id} is not archived locally; only the source download note is available.`,
          ),
        );
        continue;
      }

      summary.missingOrFailed += 1;
      worklist.push({
        id: `${source.stateCode}:${bid.id}:${attachment.id}`,
        stateCode: source.stateCode,
        sourceId: source.id,
        sourceLabel: source.label,
        bidId: bid.id,
        attachmentId: attachment.id,
        name: attachment.name,
        archiveStatus: attachment.archiveStatus,
        originalUrl: attachment.originalUrl,
        recommendedAction: "Re-run attachment archival or mark the attachment unavailable with a clear source note.",
        evidence: `${bid.id}/${attachment.id} has archive status ${attachment.archiveStatus}.`,
      });
      reasons.push(
        reason(
          "attachment_missing_or_failed",
          `${bid.id}/${attachment.id} has archive status ${attachment.archiveStatus}.`,
        ),
      );
    }
  }

  return {
    summary,
    reasons,
    worklist,
  };
}

function hasP0Reason(row: StateDataQualityRow) {
  return row.reasons.some((entry) => entry.severity === "P0");
}

export function stateDataQualityP0Details(report: StateDataQualityReport) {
  return report.rows.flatMap((row) =>
    row.reasons
      .filter((entry) => entry.severity === "P0")
      .map((entry) => `${row.stateCode} ${row.sourceId} ${entry.code}: ${entry.message}`),
  );
}

function recommendedActionForReason(code: StateDataQualityReasonCode) {
  const actions: Record<StateDataQualityReasonCode, string> = {
    missing_state_bid: "Run or repair the state crawler, then verify at least one active state bid is imported.",
    empty_core_field: "Review normalized bid rows and patch parser mappings for missing required fields.",
    detail_route_invalid: "Fix bid id normalization so the public detail route round-trips without a 404.",
    detail_archive_invalid: "Re-fetch the bid detail archive and verify the stored file and checksum.",
    attachment_archive_invalid: "Re-archive the failed attachment and verify the stored file and checksum.",
    attachment_missing_or_failed: "Re-run attachment archival or mark the attachment unavailable with a clear source note.",
    placeholder_or_unsafe_url: "Replace the placeholder or unsafe URL with the official source URL before publishing.",
    missing_source_validity_metadata: "Complete source registry validity metadata before promoting the source.",
    duplicate_canonical_enabled_source: "Run canonical source cleanup and disable duplicate enabled state sources.",
    crawler_success_zero_rows: "Inspect the latest crawler run, repair parser/query parameters, and verify non-empty rows.",
    fixture_fallback: "Replace fixture fallback with live or staged source data, or keep the source marked beta.",
    crawler_stale_or_missing: "Run the state crawler and inspect the latest crawler log.",
    risk_check_stale_or_missing: "Run the risk checklist and record a fresh snapshot.",
    source_health_stale_or_missing: "Run source health check and record a fresh source-health snapshot.",
    source_health_unhealthy: "Use the source-health access-review queue to classify and schedule follow-up.",
    needs_review_source: "Complete source approval review or keep the source in beta with an owner.",
    attachment_download_note: "Archive the attachment locally or keep the download note with explicit risk copy.",
  };

  return actions[code];
}

function ownerHintForReason(code: StateDataQualityReasonCode) {
  if (
    code === "missing_state_bid" ||
    code === "crawler_success_zero_rows" ||
    code === "crawler_stale_or_missing" ||
    code === "fixture_fallback"
  ) {
    return "data-ops";
  }

  if (
    code === "attachment_archive_invalid" ||
    code === "attachment_missing_or_failed" ||
    code === "attachment_download_note" ||
    code === "detail_archive_invalid"
  ) {
    return "archive-ops";
  }

  if (
    code === "source_health_stale_or_missing" ||
    code === "source_health_unhealthy" ||
    code === "needs_review_source" ||
    code === "missing_source_validity_metadata"
  ) {
    return "source-ops";
  }

  if (code === "risk_check_stale_or_missing") return "release-ops";

  return "data-qa";
}

function dueInHoursForPriority(priority: StateDataQualitySeverity) {
  if (priority === "P0") return 24;
  if (priority === "P1") return 72;
  return 168;
}

function actionSortWeight(priority: StateDataQualitySeverity) {
  if (priority === "P0") return 0;
  if (priority === "P1") return 1;
  return 2;
}

function buildStateDataQualityActions(rows: StateDataQualityRow[]): StateDataQualityAction[] {
  const actions = new Map<string, StateDataQualityAction>();

  for (const row of rows) {
    for (const entry of row.reasons) {
      const id = `${row.stateCode}:${row.sourceId}:${entry.code}`;
      if (actions.has(id)) continue;

      actions.set(id, {
        id,
        priority: entry.severity,
        stateCode: row.stateCode,
        sourceId: row.sourceId,
        sourceLabel: row.sourceLabel,
        reasonCode: entry.code,
        title: `${row.stateCode} ${entry.code}`,
        recommendedAction: recommendedActionForReason(entry.code),
        ownerHint: ownerHintForReason(entry.code),
        dueInHours: dueInHoursForPriority(entry.severity),
        evidence: entry.message,
      });
    }
  }

  return [...actions.values()].sort((left, right) => {
    const priorityDelta = actionSortWeight(left.priority) - actionSortWeight(right.priority);
    if (priorityDelta !== 0) return priorityDelta;

    const stateDelta = left.stateCode.localeCompare(right.stateCode);
    if (stateDelta !== 0) return stateDelta;

    return left.reasonCode.localeCompare(right.reasonCode);
  });
}

async function createStateDataQualityReportFromDataset(
  dataset: StateDataQualityDataset,
  now = new Date(),
  options: StateDataQualityOptions = {},
): Promise<StateDataQualityReport> {
  const attachmentRoots = options.attachmentRoots ?? defaultAttachmentRoots();
  const stateBidsByState = rowsByState(dataset.bids);
  const attachmentRowsByBid = attachmentsByBid(dataset.attachments);
  const enabledSources = enabledStateSourcesByState(dataset.dataSources);
  const latestCrawlerLogs = latestCrawlerLogsBySource(dataset.crawlerLogs);
  const latestRiskCheck = dataset.latestRiskCheck;
  const latestSourceHealth = dataset.latestSourceHealth;
  const sourceHealthResults = sourceHealthResultsByState(latestSourceHealth);

  const rowResults = await Promise.all(
    [...STATE_CRAWLER_SOURCES]
      .sort((left, right) => left.stateCode.localeCompare(right.stateCode))
      .map(async (source): Promise<{ row: StateDataQualityRow; attachmentWorklist: StateAttachmentWorklistItem[] }> => {
        const stateBids = stateBidsByState.get(source.stateCode) ?? [];
        const stateEnabledSources = enabledSources.get(source.stateCode) ?? [];
        const reasons: StateDataQualityReason[] = [];

        if (stateBids.length === 0) {
          reasons.push(reason("missing_state_bid", `${source.stateCode} has no active state bid rows.`));
        }

        const missingValidity = validityMetadataFailures(source);
        if (missingValidity.length > 0) {
          reasons.push(
            reason(
              "missing_source_validity_metadata",
              `${source.id} is missing source validity metadata: ${missingValidity.join(", ")}.`,
            ),
          );
        }

        if (stateEnabledSources.length > 1) {
          reasons.push(
            reason(
              "duplicate_canonical_enabled_source",
              `${source.stateCode} has ${stateEnabledSources.length} enabled state data source rows.`,
            ),
          );
        }

        if (source.approvalStatus === "needs_review" || source.trustStatus === "needs_review") {
          reasons.push(reason("needs_review_source", `${source.id} is still marked needs_review.`));
        }

        for (const urlFinding of validateBidSourceUrl(source.baseUrl)) {
          reasons.push(reason("placeholder_or_unsafe_url", `${source.id} baseUrl ${urlFinding.code}: ${urlFinding.message}`));
        }

        for (const bid of stateBids) {
          const missingFields = coreFieldFailures(bid);
          if (missingFields.length > 0) {
            reasons.push(reason("empty_core_field", `${bid.id} has empty core fields: ${missingFields.join(", ")}.`));
          }

          if (!detailRouteIsOpenable(bid)) {
            reasons.push(reason("detail_route_invalid", `${bid.id} cannot round-trip through the bid detail route.`));
          }

          for (const detailReason of await detailArchiveReasons(bid, attachmentRoots)) {
            reasons.push(detailReason);
          }

          for (const urlFinding of validateBidSourceUrl(bid.sourceUrl)) {
            reasons.push(reason("placeholder_or_unsafe_url", `${bid.id} sourceUrl ${urlFinding.code}: ${urlFinding.message}`));
          }
        }

        const attachmentQuality = await attachmentQualityForState(source, stateBids, attachmentRowsByBid, attachmentRoots);
        reasons.push(...attachmentQuality.reasons);

        const latestCrawlerLog = latestCrawlerLogForSource(source, latestCrawlerLogs);
        if (!latestCrawlerLog || isStale(latestCrawlerLog.startedAt, now, options.maxCrawlerAgeMs ?? DEFAULT_CRAWLER_MAX_AGE_MS)) {
          reasons.push(
            reason(
              "crawler_stale_or_missing",
              latestCrawlerLog
                ? `${source.id} latest crawler run at ${latestCrawlerLog.startedAt} is stale.`
                : `${source.id} has no recorded crawler run.`,
            ),
          );
        }
        if (latestCrawlerLog?.status === "success" && crawlerRowCount(latestCrawlerLog) === 0) {
          reasons.push(reason("crawler_success_zero_rows", `${source.id} latest successful crawler run produced 0 rows.`));
        }
        if (latestCrawlerLog) {
          const logMetadata = parseLogMetadata(latestCrawlerLog.metadata);
          if (logMetadata.fallbackSource || logMetadata.fallbackFixture) {
            reasons.push(reason("fixture_fallback", `${source.id} latest crawler run used fixture fallback metadata.`));
          }
        }

        if (isStale(latestRiskCheck?.checkedAt, now, options.maxRiskCheckAgeMs ?? DEFAULT_RISK_CHECK_MAX_AGE_MS)) {
          reasons.push(
            reason(
              "risk_check_stale_or_missing",
              latestRiskCheck
                ? `Latest risk check at ${latestRiskCheck.checkedAt} is stale.`
                : "No risk check snapshot has been recorded.",
            ),
          );
        }

        const sourceHealthResult = sourceHealthResults.get(source.stateCode);
        if (isStale(latestSourceHealth?.checkedAt, now, options.maxSourceHealthAgeMs ?? DEFAULT_SOURCE_HEALTH_MAX_AGE_MS)) {
          reasons.push(
            reason(
              "source_health_stale_or_missing",
              latestSourceHealth
                ? `Latest source health check at ${latestSourceHealth.checkedAt} is stale.`
                : "No source health snapshot has been recorded.",
            ),
          );
        } else if (sourceHealthResult && sourceHealthResult.status !== "healthy") {
          reasons.push(reason("source_health_unhealthy", `${source.id} latest source health status is ${sourceHealthResult.status}.`));
        }

        const riskLevel = riskLevelForReasons(reasons);

        return {
          row: {
            stateCode: source.stateCode,
            sourceId: source.id,
            sourceLabel: source.label,
            sourceUrl: source.baseUrl,
            riskLevel,
            bidCount: stateBids.length,
            enabledSourceCount: stateEnabledSources.length,
            latestCrawlerStartedAt: latestCrawlerLog?.startedAt ?? null,
            latestSourceHealthCheckedAt: latestSourceHealth?.checkedAt ?? null,
            latestRiskCheckCheckedAt: latestRiskCheck?.checkedAt ?? null,
            attachmentStatus: attachmentStatus(attachmentQuality.summary),
            attachmentSummary: attachmentQuality.summary,
            reasons,
          },
          attachmentWorklist: attachmentQuality.worklist,
        };
      }),
  );
  const rows = rowResults.map((result) => result.row);
  const attachmentWorklist = rowResults.flatMap((result) => result.attachmentWorklist);

  return {
    ok: rows.every((row) => !hasP0Reason(row)),
    checkedAt: now.toISOString(),
    summary: {
      totalStates: rows.length,
      p0BlockerStates: rows.filter((row) => row.riskLevel === "P0").length,
      p1WarningStates: rows.filter((row) => row.riskLevel === "P1").length,
      p2WarningStates: rows.filter((row) => row.riskLevel === "P2").length,
    },
    actions: buildStateDataQualityActions(rows),
    attachmentWorklist,
    rows,
  };
}

function sqliteStateDataQualityDataset(db: AppDatabase): StateDataQualityDataset {
  return {
    bids: activeStateBids(db),
    attachments: db.select().from(bidAttachments).all(),
    dataSources: db.select().from(dataSources).all(),
    crawlerLogs: db.select().from(crawlerLogs).orderBy(desc(crawlerLogs.startedAt)).all(),
    latestRiskCheck: db.select().from(riskCheckSnapshots).orderBy(desc(riskCheckSnapshots.checkedAt)).limit(1).get(),
    latestSourceHealth: db
      .select()
      .from(sourceHealthSnapshots)
      .orderBy(desc(sourceHealthSnapshots.checkedAt))
      .limit(1)
      .get(),
  };
}

function mysqlSnakeKey(key: string) {
  return key.replace(/[A-Z]/g, (value) => `_${value.toLowerCase()}`);
}

function mysqlValue(row: Record<string, unknown>, key: string) {
  return row[key] ?? row[mysqlSnakeKey(key)];
}

function mysqlString(row: Record<string, unknown>, key: string, fallback = "") {
  const value = mysqlValue(row, key);
  return value === null || value === undefined ? fallback : String(value);
}

function mysqlNullableString(row: Record<string, unknown>, key: string) {
  const value = mysqlValue(row, key);
  return value === null || value === undefined ? null : String(value);
}

function mysqlNumber(row: Record<string, unknown>, key: string, fallback = 0) {
  const value = mysqlValue(row, key);
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mysqlNullableNumber(row: Record<string, unknown>, key: string) {
  const value = mysqlValue(row, key);
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mysqlBidQualityRow(row: Record<string, unknown>): BidRow {
  return {
    id: mysqlString(row, "id"),
    source: mysqlString(row, "source"),
    sourceBidId: mysqlNullableString(row, "sourceBidId"),
    dedupeKey: mysqlString(row, "dedupeKey"),
    title: mysqlString(row, "title"),
    description: mysqlString(row, "description"),
    fullDescription: mysqlNullableString(row, "fullDescription"),
    originalCategory: mysqlNullableString(row, "originalCategory"),
    amount: mysqlNullableString(row, "amount"),
    amountMin: mysqlNullableNumber(row, "amountMin"),
    amountMax: mysqlNullableNumber(row, "amountMax"),
    currency: mysqlString(row, "currency", "USD"),
    publishedDate: mysqlNullableString(row, "publishedDate"),
    deadlineDate: mysqlNullableString(row, "deadlineDate"),
    issuerName: mysqlString(row, "issuerName"),
    issuerType: mysqlString(row, "issuerType"),
    stateCode: mysqlString(row, "stateCode"),
    contactName: mysqlNullableString(row, "contactName"),
    contactEmail: mysqlNullableString(row, "contactEmail"),
    contactPhone: mysqlNullableString(row, "contactPhone"),
    sourceUrl: mysqlString(row, "sourceUrl"),
    isActive: mysqlNumber(row, "isActive", 1),
    rawPayload: mysqlNullableString(row, "rawPayload"),
    sourceConfidence: mysqlString(row, "sourceConfidence", "medium"),
    qualityFlagsJson: mysqlString(row, "qualityFlagsJson", "[]"),
    adminReviewStatus: mysqlString(row, "adminReviewStatus", "unreviewed"),
    adminReviewNote: mysqlNullableString(row, "adminReviewNote"),
    adminReviewedAt: mysqlNullableString(row, "adminReviewedAt"),
    adminReviewedBy: mysqlNullableString(row, "adminReviewedBy"),
    displayStatus: mysqlString(row, "displayStatus", "published"),
    detailArchiveStatus: mysqlString(row, "detailArchiveStatus", "not_archived"),
    detailArchivePath: mysqlNullableString(row, "detailArchivePath"),
    detailFetchedAt: mysqlNullableString(row, "detailFetchedAt"),
    detailChecksumSha256: mysqlNullableString(row, "detailChecksumSha256"),
    detailArchiveError: mysqlNullableString(row, "detailArchiveError"),
    firstSeenAt: mysqlString(row, "firstSeenAt"),
    lastSeenAt: mysqlString(row, "lastSeenAt"),
    createdAt: mysqlString(row, "createdAt"),
    updatedAt: mysqlString(row, "updatedAt"),
  };
}

function mysqlAttachmentQualityRow(row: Record<string, unknown>): AttachmentRow {
  return {
    id: mysqlString(row, "id"),
    bidId: mysqlString(row, "bidId"),
    name: mysqlString(row, "name"),
    url: mysqlString(row, "url"),
    originalUrl: mysqlNullableString(row, "originalUrl"),
    storagePath: mysqlNullableString(row, "storagePath"),
    byteSize: mysqlNullableNumber(row, "byteSize"),
    contentType: mysqlNullableString(row, "contentType"),
    checksumSha256: mysqlNullableString(row, "checksumSha256"),
    fetchedAt: mysqlNullableString(row, "fetchedAt"),
    archiveStatus: mysqlString(row, "archiveStatus", "not_archived"),
    archiveError: mysqlNullableString(row, "archiveError"),
    sizeLabel: mysqlNullableString(row, "sizeLabel"),
    mimeType: mysqlNullableString(row, "mimeType"),
    sortOrder: mysqlNumber(row, "sortOrder", 0),
    createdAt: mysqlString(row, "createdAt"),
  };
}

function mysqlDataSourceQualityRow(row: Record<string, unknown>): DataSourceRow {
  return {
    id: mysqlString(row, "id"),
    label: mysqlString(row, "label"),
    issuerType: mysqlString(row, "issuerType"),
    stateCode: mysqlString(row, "stateCode"),
    baseUrl: mysqlNullableString(row, "baseUrl"),
    isEnabled: mysqlNumber(row, "isEnabled", 1),
    cadence: mysqlString(row, "cadence", "daily"),
    providerFamily: mysqlNullableString(row, "providerFamily"),
    accessMode: mysqlNullableString(row, "accessMode"),
    sourceType: mysqlNullableString(row, "sourceType"),
    sourceConfidence: mysqlNullableString(row, "sourceConfidence"),
    activationStatus: mysqlNullableString(row, "activationStatus"),
    requiresBrowser: mysqlNullableNumber(row, "requiresBrowser"),
    requiresManual: mysqlNullableNumber(row, "requiresManual"),
    requiresLogin: mysqlNullableNumber(row, "requiresLogin"),
    supportsQuery: mysqlNullableNumber(row, "supportsQuery"),
    supportsPagination: mysqlNullableNumber(row, "supportsPagination"),
    supportsAttachmentMetadata: mysqlNullableNumber(row, "supportsAttachmentMetadata"),
    supportsDetailPageFetch: mysqlNullableNumber(row, "supportsDetailPageFetch"),
    fallbackNotes: mysqlNullableString(row, "fallbackNotes"),
    approvedForIngestion: mysqlNullableNumber(row, "approvedForIngestion"),
    approvalStatus: mysqlNullableString(row, "approvalStatus"),
    accessPattern: mysqlNullableString(row, "accessPattern"),
    legalReviewStatus: mysqlNullableString(row, "legalReviewStatus"),
    sourceOwner: mysqlNullableString(row, "sourceOwner"),
    approvalNotes: mysqlNullableString(row, "approvalNotes"),
    lastApprovalReviewedAt: mysqlNullableString(row, "lastApprovalReviewedAt"),
    liveHealthOwner: mysqlNullableString(row, "liveHealthOwner"),
    liveHealthDisposition: mysqlNullableString(row, "liveHealthDisposition"),
    liveHealthNextReviewAt: mysqlNullableString(row, "liveHealthNextReviewAt"),
    liveHealthNotes: mysqlNullableString(row, "liveHealthNotes"),
    liveHealthReviewedAt: mysqlNullableString(row, "liveHealthReviewedAt"),
    lastSuccessAt: mysqlNullableString(row, "lastSuccessAt"),
    lastFailureAt: mysqlNullableString(row, "lastFailureAt"),
    consecutiveFailures: mysqlNumber(row, "consecutiveFailures", 0),
    robotsTxtStatus: mysqlNullableString(row, "robotsTxtStatus"),
    robotsTxtCheckedAt: mysqlNullableString(row, "robotsTxtCheckedAt"),
    robotsTxtHash: mysqlNullableString(row, "robotsTxtHash"),
    robotsTxtDisallowsCrawledPaths: row.robotsTxtDisallowsCrawledPaths === null || row.robotsTxtDisallowsCrawledPaths === undefined ? null : mysqlNumber(row, "robotsTxtDisallowsCrawledPaths", 0),
    robotsTxtFlagReason: mysqlNullableString(row, "robotsTxtFlagReason"),
    tosReviewed: row.tosReviewed === null || row.tosReviewed === undefined ? null : mysqlNumber(row, "tosReviewed", 0),
    tosReviewedAt: mysqlNullableString(row, "tosReviewedAt"),
    tosUrl: mysqlNullableString(row, "tosUrl"),
    complianceReviewer: mysqlNullableString(row, "complianceReviewer"),
    legalOpinionReference: mysqlNullableString(row, "legalOpinionReference"),
    complianceReviewDueAt: mysqlNullableString(row, "complianceReviewDueAt"),
    complianceNotes: mysqlNullableString(row, "complianceNotes"),
    createdAt: mysqlString(row, "createdAt"),
    updatedAt: mysqlString(row, "updatedAt"),
  };
}

function mysqlCrawlerLogQualityRow(row: Record<string, unknown>): CrawlerLogRow {
  return {
    id: mysqlString(row, "id"),
    source: mysqlString(row, "source"),
    runId: mysqlString(row, "runId"),
    status: mysqlString(row, "status"),
    startedAt: mysqlString(row, "startedAt"),
    finishedAt: mysqlNullableString(row, "finishedAt"),
    durationMs: mysqlNullableNumber(row, "durationMs"),
    fetchedCount: mysqlNumber(row, "fetchedCount", 0),
    insertedCount: mysqlNumber(row, "insertedCount", 0),
    updatedCount: mysqlNumber(row, "updatedCount", 0),
    skippedCount: mysqlNumber(row, "skippedCount", 0),
    failedCount: mysqlNumber(row, "failedCount", 0),
    errorCode: mysqlNullableString(row, "errorCode"),
    errorMessage: mysqlNullableString(row, "errorMessage"),
    errorStack: mysqlNullableString(row, "errorStack"),
    metadata: mysqlNullableString(row, "metadata"),
  };
}

function mysqlRiskCheckQualityRow(row: Record<string, unknown>): RiskCheckSnapshotRow {
  return {
    id: mysqlString(row, "id"),
    ok: mysqlNumber(row, "ok", 0),
    checkedAt: mysqlString(row, "checkedAt"),
    reportJson: mysqlString(row, "reportJson", "{}"),
    createdAt: mysqlString(row, "createdAt"),
  };
}

function mysqlSourceHealthQualityRow(row: Record<string, unknown>): SourceHealthSnapshotRow {
  return {
    id: mysqlString(row, "id"),
    ok: mysqlNumber(row, "ok", 0),
    checkedAt: mysqlString(row, "checkedAt"),
    summaryJson: mysqlString(row, "summaryJson", "{}"),
    resultsJson: mysqlString(row, "resultsJson", "[]"),
    createdAt: mysqlString(row, "createdAt"),
  };
}

async function mysqlStateDataQualityDataset(mysql: MysqlStateDataQualityReader): Promise<StateDataQualityDataset> {
  const [
    bidRows,
    attachmentRows,
    dataSourceRows,
    crawlerLogRows,
    riskRows,
    sourceHealthRows,
  ] = await Promise.all([
    mysqlSelectMany<Record<string, unknown>>(
      mysql,
      `
        SELECT
          id,
          source,
          source_bid_id AS sourceBidId,
          dedupe_key AS dedupeKey,
          title,
          description,
          full_description AS fullDescription,
          original_category AS originalCategory,
          amount,
          amount_min AS amountMin,
          amount_max AS amountMax,
          currency,
          published_date AS publishedDate,
          deadline_date AS deadlineDate,
          issuer_name AS issuerName,
          issuer_type AS issuerType,
          state_code AS stateCode,
          contact_name AS contactName,
          contact_email AS contactEmail,
          contact_phone AS contactPhone,
          source_url AS sourceUrl,
          is_active AS isActive,
          raw_payload AS rawPayload,
          source_confidence AS sourceConfidence,
          quality_flags_json AS qualityFlagsJson,
          admin_review_status AS adminReviewStatus,
          admin_review_note AS adminReviewNote,
          admin_reviewed_at AS adminReviewedAt,
          admin_reviewed_by AS adminReviewedBy,
          display_status AS displayStatus,
          detail_archive_status AS detailArchiveStatus,
          detail_archive_path AS detailArchivePath,
          detail_fetched_at AS detailFetchedAt,
          detail_checksum_sha256 AS detailChecksumSha256,
          detail_archive_error AS detailArchiveError,
          first_seen_at AS firstSeenAt,
          last_seen_at AS lastSeenAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM bids
        WHERE issuer_type = 'state'
          AND is_active = 1
          AND display_status <> 'suppressed'
      `,
    ),
    mysqlSelectMany<Record<string, unknown>>(
      mysql,
      `
        SELECT
          id,
          bid_id AS bidId,
          name,
          url,
          original_url AS originalUrl,
          storage_path AS storagePath,
          byte_size AS byteSize,
          content_type AS contentType,
          checksum_sha256 AS checksumSha256,
          fetched_at AS fetchedAt,
          archive_status AS archiveStatus,
          archive_error AS archiveError,
          size_label AS sizeLabel,
          mime_type AS mimeType,
          sort_order AS sortOrder,
          created_at AS createdAt
        FROM bid_attachments
      `,
    ),
    mysqlSelectMany<Record<string, unknown>>(
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
          last_success_at AS lastSuccessAt,
          last_failure_at AS lastFailureAt,
          consecutive_failures AS consecutiveFailures,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM data_sources
      `,
    ),
    mysqlSelectMany<Record<string, unknown>>(
      mysql,
      `
        SELECT
          id,
          source,
          run_id AS runId,
          status,
          started_at AS startedAt,
          finished_at AS finishedAt,
          duration_ms AS durationMs,
          fetched_count AS fetchedCount,
          inserted_count AS insertedCount,
          updated_count AS updatedCount,
          skipped_count AS skippedCount,
          failed_count AS failedCount,
          error_code AS errorCode,
          error_message AS errorMessage,
          error_stack AS errorStack,
          metadata
        FROM crawler_logs
        ORDER BY started_at DESC
      `,
    ),
    mysqlSelectMany<Record<string, unknown>>(
      mysql,
      `
        SELECT
          id,
          ok,
          checked_at AS checkedAt,
          report_json AS reportJson,
          created_at AS createdAt
        FROM risk_check_snapshots
        ORDER BY checked_at DESC
        LIMIT 1
      `,
    ),
    mysqlSelectMany<Record<string, unknown>>(
      mysql,
      `
        SELECT
          id,
          ok,
          checked_at AS checkedAt,
          summary_json AS summaryJson,
          results_json AS resultsJson,
          created_at AS createdAt
        FROM source_health_snapshots
        ORDER BY checked_at DESC
        LIMIT 1
      `,
    ),
  ]);

  return {
    bids: bidRows.map(mysqlBidQualityRow),
    attachments: attachmentRows.map(mysqlAttachmentQualityRow),
    dataSources: dataSourceRows.map(mysqlDataSourceQualityRow),
    crawlerLogs: crawlerLogRows.map(mysqlCrawlerLogQualityRow),
    latestRiskCheck: riskRows[0] ? mysqlRiskCheckQualityRow(riskRows[0]) : undefined,
    latestSourceHealth: sourceHealthRows[0] ? mysqlSourceHealthQualityRow(sourceHealthRows[0]) : undefined,
  };
}

export async function createStateDataQualityReport(
  db: AppDatabase,
  now = new Date(),
  options: StateDataQualityOptions = {},
): Promise<StateDataQualityReport> {
  return createStateDataQualityReportFromDataset(sqliteStateDataQualityDataset(db), now, options);
}

export async function createStateDataQualityReportFromMysql(
  mysql: MysqlStateDataQualityReader,
  now = new Date(),
  options: StateDataQualityOptions = {},
): Promise<StateDataQualityReport> {
  return createStateDataQualityReportFromDataset(await mysqlStateDataQualityDataset(mysql), now, options);
}

export function formatStateDataQualityReport(report: StateDataQualityReport) {
  const lines = [
    `State data quality ${report.ok ? "PASS" : "FAIL"} at ${report.checkedAt}`,
    `Summary: ${report.summary.totalStates} states, ${report.summary.p0BlockerStates} P0 blocker states, `
      + `${report.summary.p1WarningStates} P1 warning states, ${report.summary.p2WarningStates} P2 warning states`,
    `Remediation actions: ${report.actions.length}`,
    `Attachment worklist: ${report.attachmentWorklist.length}`,
    "state | risk | bids | enabled_sources | attachments | reasons",
    ...report.rows.map((row) => {
      const reasonCodes = row.reasons.map((entry) => `${entry.severity}:${entry.code}`).join(", ") || "none";
      return [
        row.stateCode,
        row.riskLevel,
        String(row.bidCount),
        String(row.enabledSourceCount),
        `${row.attachmentStatus} (${row.attachmentSummary.realFileOpenable}/${row.attachmentSummary.total} real)`,
        reasonCodes,
      ].join(" | ");
    }),
  ];

  return lines.join("\n");
}
