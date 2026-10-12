import { ISSUER_TYPES, type IssuerType } from "@/lib/issuer-types";
import { qualityObject, readCrawlerQualityEvidence, type CrawlerContentStatus, type CrawlerListCoverage, type CrawlerQualityEvidence } from "@/lib/crawler-data-quality";
import type { AppDatabase } from "@/server/db/client";
import { mysqlSelectMany } from "@/server/db/mysql-runtime";
import { evaluateCrawlerBid } from "@/server/crawler/data-quality";
import { createRegisteredSourceIndex, normalizeSourceIdentity, sourceIdentityDifferences } from "@/lib/source-identity";

export interface MysqlSourceDataQualityReader {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  getConnection?: () => Promise<MysqlSourceDataQualityConnection>;
}
export interface MysqlSourceDataQualityConnection {
  query: MysqlSourceDataQualityReader["query"];
  beginTransaction: () => Promise<void>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  release: () => void;
}
export interface SourceDataQualityRow {
  sourceId: string;
  sourceLabel: string;
  jurisdictionLevel: IssuerType | "unknown";
  jurisdictionName: string | null;
  stateCode: string;
  providerFamily: string | null;
  enabled: boolean;
  execution: "success" | "failure" | "unknown";
  lastExecutionAt: string | null;
  lastSuccessAt: string | null;
  runId: string | null;
  listCoverage: CrawlerListCoverage;
  contentStatus: CrawlerContentStatus;
  run: CrawlerQualityEvidence;
  stored: {
    bidCount: number;
    coreInvalidCount: number;
    validBodyCount: number;
    analysisReadyCount: number;
    retainedBodyCount: number;
    bodyVerificationUnknownCount: number;
    oldestBodyVerifiedAt: string | null;
    latestBodyVerifiedAt: string | null;
    oldestBodyAgeHours: number | null;
    attachmentsDiscovered: number;
    attachmentsArchived: number;
    attachmentsVerified: number;
    bodyBacklog?: {
      pendingCount: number;
      neverAttemptedCount: number;
      statusCounts: Record<string, number>;
      oldestPendingObservedAt: string | null;
      nextRetryAt: string | null;
    };
  };
}
export interface SourceDataQualitySummary {
  totalSources: number;
  usableSources: number;
  degradedSources: number;
  unknownSources: number;
  verifiedEmptySources: number;
}
export interface SourceDataQualityReport {
  checkedAt: string;
  readConsistency?: "snapshot" | "per_query";
  summary: SourceDataQualitySummary;
  segments: Array<SourceDataQualitySummary & { jurisdictionLevel: IssuerType | "unknown" }>;
  rows: SourceDataQualityRow[];
  unattributedBidCount: number;
}

type Row = Record<string, unknown>;
const string = (value: unknown) => typeof value === "string" ? value : value == null ? "" : String(value);
function normalize(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]));
}
const snake = (row: Row): Row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value]));
const nullableString = (value: unknown) => string(value) || null;
function summarize(rows: SourceDataQualityRow[]): SourceDataQualitySummary {
  return { totalSources: rows.length, usableSources: rows.filter((row) => row.contentStatus === "usable").length, degradedSources: rows.filter((row) => ["partial", "unusable"].includes(row.contentStatus)).length, unknownSources: rows.filter((row) => row.contentStatus === "unknown").length, verifiedEmptySources: rows.filter((row) => row.contentStatus === "empty_verified").length };
}

const PAGE_SIZE = 250;
const SOURCE_COLUMNS = "id, label, issuer_type, jurisdiction_level, jurisdiction_name, state_code, fips_code, provider_family, is_enabled, last_success_at";
const BID_COLUMNS = "id, source, source_bid_id, dedupe_key, title, description, full_description, issuer_name, issuer_type, jurisdiction_level, jurisdiction_name, state_code, fips_code, source_url, raw_payload, quality_flags_json, deadline_date, published_date, detail_fetched_at, first_seen_at";
const ATTACHMENT_COLUMNS = "bid_id, id, name, url, original_url, archive_status, storage_path, checksum_sha256, verified_at, byte_size, content_type, mime_type, fetched_at";
function latestListLogSql(dialect: "sqlite" | "mysql") {
  const safeMetadata = "CASE WHEN JSON_VALID(metadata) THEN metadata ELSE '{}' END";
  const mode = dialect === "mysql" ? `JSON_UNQUOTE(JSON_EXTRACT(${safeMetadata}, '$.mode'))` : `JSON_EXTRACT(${safeMetadata}, '$.mode')`;
  return `SELECT latest.id, latest.source, latest.run_id, latest.status, latest.started_at, latest.finished_at, latest.metadata
  FROM (SELECT id AS source_key FROM data_sources UNION SELECT label AS source_key FROM data_sources) registered
  JOIN crawler_logs latest ON latest.id = (
    SELECT id FROM crawler_logs WHERE source = registered.source_key AND status IN ('success', 'failure', 'failed')
      AND COALESCE(${mode}, '') <> 'detail_backfill'
    ORDER BY started_at DESC, id DESC LIMIT 1
  )`;
}

function emptyStored(): SourceDataQualityRow["stored"] {
  return { bidCount: 0, coreInvalidCount: 0, validBodyCount: 0, analysisReadyCount: 0, retainedBodyCount: 0, bodyVerificationUnknownCount: 0, oldestBodyVerifiedAt: null, latestBodyVerifiedAt: null, oldestBodyAgeHours: null, attachmentsDiscovered: 0, attachmentsArchived: 0, attachmentsVerified: 0, bodyBacklog: { pendingCount: 0, neverAttemptedCount: 0, statusCounts: {}, oldestPendingObservedAt: null, nextRetryAt: null } };
}

function createAccumulator(sourceRows: Row[], logRows: Row[], now: Date) {
  const sources = sourceRows.map(normalize);
  const sourceIndex = createRegisteredSourceIndex(sources);
  const latestLogBySource = new Map<string, Row>();
  for (const log of logRows.map(normalize).sort((left, right) => string(right.startedAt).localeCompare(string(left.startedAt)) || string(right.id).localeCompare(string(left.id)))) {
    if (!["success", "failure", "failed"].includes(string(log.status)) || qualityObject(log.metadata).mode === "detail_backfill") continue;
    const attribution = sourceIndex.resolveSource(log.source);
    const sourceId = attribution.kind === "registered" ? string(attribution.source.id) : null;
    if (sourceId && !latestLogBySource.has(sourceId)) latestLogBySource.set(sourceId, log);
  }
  const rows = sources.map((source): SourceDataQualityRow => {
    const sourceId = string(source.id);
    const log = latestLogBySource.get(sourceId);
    const run = readCrawlerQualityEvidence(log?.metadata);
    const level = string(source.jurisdictionLevel || source.issuerType);
    return {
      sourceId, sourceLabel: string(source.label), jurisdictionLevel: ISSUER_TYPES.includes(level as IssuerType) ? level as IssuerType : "unknown", jurisdictionName: nullableString(source.jurisdictionName), stateCode: string(source.stateCode), providerFamily: nullableString(source.providerFamily), enabled: Number(source.isEnabled) === 1,
      execution: log ? log.status === "success" ? "success" : "failure" : "unknown", lastExecutionAt: nullableString(log?.finishedAt || log?.startedAt), lastSuccessAt: nullableString(source.lastSuccessAt), runId: nullableString(log?.runId), listCoverage: run.listCoverage, contentStatus: run.contentStatus, run, stored: emptyStored(),
    };
  }).sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const reportById = new Map(rows.map((row) => [row.sourceId, row]));
  let unattributedBidCount = 0;
  return {
    addPage(bidRows: Row[], attachmentRows: Row[]) {
      const attachmentsByBid = new Map<string, Row[]>();
      for (const attachment of attachmentRows.map(normalize)) attachmentsByBid.set(string(attachment.bidId), [...(attachmentsByBid.get(string(attachment.bidId)) ?? []), attachment]);
      for (const bid of bidRows.map(normalize)) {
        const attribution = sourceIndex.resolveBid(bid);
        if (attribution.kind !== "registered") { unattributedBidCount += 1; continue; }
        const source = attribution.source;
        const sourceId = string(source.id);
        const stored = reportById.get(sourceId)!.stored;
        const quality = evaluateCrawlerBid({ ...snake(bid), source_id: sourceId, raw_payload: qualityObject(bid.rawPayload), attachments: (attachmentsByBid.get(string(bid.id)) ?? []).map(snake) });
        const persisted = qualityObject(qualityObject(bid.rawPayload).data_quality);
        const capabilities = qualityObject(persisted.capabilities);
        const persistedCoreBlocked = persisted.coreValid === false || capabilities.discovery === false;
        const identity = normalizeSourceIdentity(source);
        const sourceLevel = identity.jurisdictionLevel || identity.issuerType;
        const identityMismatch = sourceIdentityDifferences(bid, { ...identity, issuerType: sourceLevel, jurisdictionLevel: sourceLevel }, "case-insensitive").length > 0;
        stored.bidCount += 1;
        stored.coreInvalidCount += Number(!quality.coreValid || identityMismatch || persistedCoreBlocked);
        stored.analysisReadyCount += Number(quality.capabilities.analysis && !identityMismatch && !persistedCoreBlocked && capabilities.analysis !== false && qualityObject(persisted.body).valid !== false);
        stored.attachmentsDiscovered += quality.attachments.discovered;
        stored.attachmentsArchived += quality.attachments.archived;
        stored.attachmentsVerified += quality.attachments.verified;
        if (!quality.body.valid) {
          const backlog = stored.bodyBacklog!;
          const outcome = qualityObject(qualityObject(qualityObject(bid.rawPayload).enrichment).outcome);
          const status = ["failure", "deferred", "budget", "disabled", "not_configured", "restricted"].includes(string(outcome.status)) ? string(outcome.status) : "unknown";
          backlog.pendingCount += 1;
          backlog.neverAttemptedCount += Number(!outcome.attempted_at && !Number(outcome.attempt_count));
          backlog.statusCounts[status] = (backlog.statusCounts[status] ?? 0) + 1;
          const observedAt = nullableString(bid.firstSeenAt);
          if (observedAt && Number.isFinite(Date.parse(observedAt)) && (!backlog.oldestPendingObservedAt || Date.parse(observedAt) < Date.parse(backlog.oldestPendingObservedAt))) backlog.oldestPendingObservedAt = observedAt;
          const retryAt = nullableString(outcome.next_retry_at);
          if (retryAt && Number.isFinite(Date.parse(retryAt)) && (!backlog.nextRetryAt || Date.parse(retryAt) < Date.parse(backlog.nextRetryAt))) backlog.nextRetryAt = retryAt;
          continue;
        }
        stored.validBodyCount += 1;
        stored.retainedBodyCount += Number(quality.body.reused);
        const verifiedAt = quality.body.verifiedAt;
        if (!verifiedAt || !Number.isFinite(Date.parse(verifiedAt))) { stored.bodyVerificationUnknownCount += 1; continue; }
        if (!stored.oldestBodyVerifiedAt || Date.parse(verifiedAt) < Date.parse(stored.oldestBodyVerifiedAt)) stored.oldestBodyVerifiedAt = verifiedAt;
        if (!stored.latestBodyVerifiedAt || Date.parse(verifiedAt) > Date.parse(stored.latestBodyVerifiedAt)) stored.latestBodyVerifiedAt = verifiedAt;
        stored.oldestBodyAgeHours = Math.max(0, Math.floor((now.getTime() - Date.parse(stored.oldestBodyVerifiedAt)) / 3600000));
      }
    },
    finish(): SourceDataQualityReport {
      const levels: Array<IssuerType | "unknown"> = [...ISSUER_TYPES, ...(rows.some((row) => row.jurisdictionLevel === "unknown") ? ["unknown" as const] : [])];
      return { checkedAt: now.toISOString(), summary: summarize(rows), segments: levels.map((jurisdictionLevel) => ({ jurisdictionLevel, ...summarize(rows.filter((row) => row.jurisdictionLevel === jurisdictionLevel)) })), rows, unattributedBidCount };
    },
  };
}

/** Every active record is checked; history and attachment reads are restricted to current source/page evidence. */
export async function createSourceDataQualityReport(db: AppDatabase, now = new Date()): Promise<SourceDataQualityReport> {
  return db.$client.transaction(() => {
    const sources = db.$client.prepare(`SELECT ${SOURCE_COLUMNS} FROM data_sources`).all() as Row[];
    const logs = db.$client.prepare(latestListLogSql("sqlite")).all() as Row[];
    const accumulator = createAccumulator(sources, logs, now);
    const readPage = db.$client.prepare(`SELECT ${BID_COLUMNS} FROM bids WHERE is_active = 1 AND display_status <> 'suppressed' AND id > ? ORDER BY id LIMIT ${PAGE_SIZE}`);
    let afterId = "";
    while (true) {
      const page = readPage.all(afterId) as Row[];
      if (!page.length) break;
      const ids = page.map((bid) => string(bid.id));
      const attachments = db.$client.prepare(`SELECT ${ATTACHMENT_COLUMNS} FROM bid_attachments WHERE bid_id IN (${ids.map(() => "?").join(",")})`).all(...ids) as Row[];
      accumulator.addPage(page, attachments);
      afterId = ids.at(-1)!;
      if (page.length < PAGE_SIZE) break;
    }
    return { ...accumulator.finish(), readConsistency: "snapshot" as const };
  })();
}
async function scanMysqlQuality(mysql: MysqlSourceDataQualityReader, now: Date): Promise<SourceDataQualityReport> {
  const [sources, logs] = await Promise.all([
    mysqlSelectMany<Row>(mysql, `SELECT ${SOURCE_COLUMNS} FROM data_sources`),
    mysqlSelectMany<Row>(mysql, latestListLogSql("mysql")),
  ]);
  const accumulator = createAccumulator(sources, logs, now);
  let afterId = "";
  while (true) {
    const page = await mysqlSelectMany<Row>(mysql, `SELECT ${BID_COLUMNS} FROM bids WHERE is_active = 1 AND display_status <> 'suppressed' AND id > ? ORDER BY id LIMIT ${PAGE_SIZE}`, [afterId]);
    if (!page.length) break;
    const ids = page.map((bid) => string(bid.id));
    const attachments = await mysqlSelectMany<Row>(mysql, `SELECT ${ATTACHMENT_COLUMNS} FROM bid_attachments WHERE bid_id IN (${ids.map(() => "?").join(",")})`, ids);
    accumulator.addPage(page, attachments);
    afterId = ids.at(-1)!;
    if (page.length < PAGE_SIZE) break;
  }
  return accumulator.finish();
}

/** Lease only a pool-owned connection. A supplied reader/transaction stays under its caller's control. */
export async function createSourceDataQualityReportFromMysql(mysql: MysqlSourceDataQualityReader, now = new Date()): Promise<SourceDataQualityReport> {
  if (!mysql.getConnection) return { ...await scanMysqlQuality(mysql, now), readConsistency: "per_query" };
  const connection = await mysql.getConnection();
  try {
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    await connection.beginTransaction();
    const report = await scanMysqlQuality(connection, now);
    await connection.commit();
    return { ...report, readConsistency: "snapshot" };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
