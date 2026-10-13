/**
 * data:integrity: a per-level report of the state, county, city and township bid data, and the snapshot a later run
 * is compared with (data-integrity-compare.ts). Take a snapshot before a migration, deploy or data fix, make the
 * change, compare: the compare is the proof that nothing was lost, hidden or mis-typed.
 *
 * LEVEL. A bid's level is its `issuer_type` when that is one of the six real ones (state, county, city, township,
 * special_district, federal), otherwise `other`.
 *
 * VISIBLE means exactly what the search path shows: `display_status <> 'suppressed'`, `isPublishableRow` and
 * `is_active = 1` (`listBids` / `listBidsFromMysql` and `queryBidsFromList`, src/server/bids). The rows are read in
 * pages and judged in JS by the very functions the search path calls (`isPublishableRow` is imported from the
 * repository, not copied); only `display_status <> 'suppressed'` is asked of the database, as the same expression the
 * repository's query uses, so NULL and collation behave as they do there. data-integrity.test.ts holds the result to
 * `queryBids`, level by level and row by row. A row is OPEN when its lifecycle is open (`lifecycle_status`, falling
 * back to `is_active` like the search path's `Bid`); `activeFlagMismatch` counts the rows where the two disagree.
 *
 * IDENTITY is computed independently of the gate. The gate lets a row of an UNKNOWN source through and compares a
 * registered one case-insensitively; `identityMismatch` resolves the registered source the same way the gate does
 * (id prefix, then the historic label) and compares level, state and FIPS exactly. A mismatch the gate would also
 * hide shows up in `hiddenReasons` as `registered_source_mismatch`.
 *
 * ONE CONSISTENT READ. Both dialects read inside a single read-only transaction (SQLite: a deferred transaction on
 * the handle; MySQL: `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` and then `START TRANSACTION WITH CONSISTENT SNAPSHOT,
 * READ ONLY` on one pooled connection: the snapshot only holds under REPEATABLE READ), so the pages of a scan, the source
 * list, the column list and the report all describe one moment even while a crawler writes. Nothing here writes.
 */
import { createHash } from "node:crypto";
import { detailAccessFromRawPayload } from "@/lib/bid-access";
import { bidDeadlinePassed, parseBidDeadline } from "@/lib/bid-deadline";
import { getBidDescription } from "@/lib/bid-description";
import { bidLifecycleStatusOf, type BidLifecycleStatus } from "@/lib/bid-lifecycle";
import { getBidCoreIssues } from "@/lib/bid-usability";
import { ISSUER_TYPES } from "@/lib/issuer-types";
import {
  createRegisteredSourceIndex,
  isCanonicalSourceBid,
  normalizeSourceIdentity,
  sourceIdentityDifferences,
  type SourceIdentity,
} from "@/lib/source-identity";
import { createRegisteredSourceIdentityGuard, type RegisteredSourceIdentity } from "@/server/bids/registered-source-identity";
import { isPublishableRow, publicationInputsOf, type PublishableRowInput } from "@/server/bids/repository";
import { mysqlSelectMany } from "@/server/db/mysql-runtime";
import { isDemoBidRow, type DemoPurgeMysql, type DemoPurgeSqlite, type DemoPurgeTarget } from "./demo-purge";

/* -------------------------------------------------------------------------------------------------------------- */
/* Shapes                                                                                                         */
/* -------------------------------------------------------------------------------------------------------------- */

/** The target of the demo purge, so one opened target serves every integrity tool. */
export type IntegrityTarget = DemoPurgeTarget;
export type IntegrityDialect = "sqlite" | "mysql";

export const INTEGRITY_LEVELS = ["state", "county", "city", "township", "special_district", "federal", "other"] as const;
export type IntegrityLevel = (typeof INTEGRITY_LEVELS)[number];

/** The columns a snapshot row carries by value, so a compare can say what changed and not only that something did. */
export const TRACKED_COLUMNS = [
  "issuer_type", "jurisdiction_level", "fips_code", "lifecycle_status", "is_active", "display_status",
  "issuer_name", "title", "deadline_date", "source_bid_id",
] as const;
export type TrackedColumn = (typeof TRACKED_COLUMNS)[number];
export type TrackedValue = string | number | null;

export interface SourceHealth {
  /** Enabled sources of the level. */
  sources: number;
  neverSucceeded: number;
  succeededWithin2d: number;
  succeededWithin7d: number;
  /** consecutive_failures > 0. */
  failing: number;
}

export interface LevelReport {
  total: number;
  open: number;
  closed: number;
  awarded: number;

  /** Open and shown by search. */
  openVisible: number;
  /** Open and not shown. */
  openHidden: number;
  /** Why the open hidden rows are hidden, most frequent first. A row with several reasons counts under each. */
  hiddenReasons: Record<string, number>;

  /** The registered source of the row disagrees on level, state (exactly) or FIPS (both non-empty). All lifecycles. */
  identityMismatch: number;
  /** The id prefix is not a data_sources.id. */
  unregistered: number;
  /** The demo rule of the demo purge (demo:prepare and db:seed rows). */
  demoLike: number;
  /** The id is not `<prefix>:<source_bid_id>` for the source its prefix names. */
  nonCanonicalId: number;
  /** Rows whose is_active disagrees with lifecycle_status = open. Search reads is_active; the rest of the app, the lifecycle. */
  activeFlagMismatch: number;

  /** Open rows with a body worth showing (`getBidDescription`). */
  withBody: number;
  /** Open rows whose portal shows the description to its members only (`raw_payload.detail_access`). */
  detailLockedAtSource: number;
  /** Open rows with no body that the portal does not lock: genuinely missing. */
  bodyMissing: number;
  /**
   * Open rows whose issuer is neither blank nor a placeholder, by the publication gate's own rule (`invalid_issuer`: the
   * trimmed name is empty or matches `/^Unknown(?:\s|$)/i`), so that a bid counted out here is also one search hides.
   */
  withIssuer: number;
  deadlineParseable: number;
  withSourceUrl: number;

  /** Open rows whose deadline has passed at the report's `now`. */
  expiredOpen: number;

  /** The newest `last_seen_at` of any bid of the level. */
  newestLastSeenAt: string | null;
  sourceHealth: SourceHealth;
}

export interface IntegrityReport {
  generatedAt: string;
  dialect: IntegrityDialect;
  levels: Record<IntegrityLevel, LevelReport>;
  /** The sum of the levels (the newest of their newest). */
  totals: LevelReport;
  /** How many legacy `ny_contract_reporter:% Company:%` ids the NY re-key skipped (child rows or a key clash). */
  malformedNyIds: number;
  /**
   * Those ids themselves, in code-unit order whatever the database's collation. One per counted id, so its length is
   * `malformedNyIds`. Every report this version builds has it; a snapshot written before it existed has the count alone.
   */
  malformedNyIdList?: string[];
}

export interface SnapshotRow {
  /** sha256 of the canonical JSON of every column of the row. */
  h: string;
  level: IntegrityLevel;
  /** Shown by search (open or not). */
  visible: boolean;
  open: boolean;
  t: Record<TrackedColumn, TrackedValue>;
  /** `raw_payload.lifecycle.closed_reason`, kept for a row that is not open. */
  c?: string;
}

/** Hashes of an earlier snapshot's columns, computed now: how a compare tells an edited row from a new column. */
export interface ComparableHashes {
  columns: readonly string[];
  byId: ReadonlyMap<string, string>;
}

export interface IntegritySnapshot {
  version: 1;
  takenAt: string;
  dialect: IntegrityDialect;
  /** The `bids` columns the row hashes cover, sorted. */
  columns: string[];
  report: IntegrityReport;
  rows: Record<string, SnapshotRow>;
  /** In memory only: present on a snapshot built to be compared with an older one that had fewer columns. */
  comparable?: ComparableHashes;
}

export class IntegritySnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegritySnapshotError";
  }
}

/** Bids read per page. Small enough that a page of heavy raw payloads stays modest. */
const PAGE_SIZE = 250;
/** A column the scan adds to the select list; it is not a column of `bids` and never enters a hash. */
const SCAN_COLUMN_PREFIX = "__integrity_";
const SHOWN_COLUMN = `${SCAN_COLUMN_PREFIX}shown`;
const DAY_MS = 86_400_000;
const NY_ID_PREFIX = "ny_contract_reporter:";
const NY_COMPANY_MARKER = " Company:";

export function levelOfIssuerType(value: unknown): IntegrityLevel {
  return typeof value === "string" && (ISSUER_TYPES as readonly string[]).includes(value) ? (value as IntegrityLevel) : "other";
}

/** A map with no prototype: a bid id such as `constructor` or `__proto__` is just a key. */
export function dictionary<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/* -------------------------------------------------------------------------------------------------------------- */
/* Row hashing                                                                                                    */
/* -------------------------------------------------------------------------------------------------------------- */

function canonicalValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value));
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return `{"$bigint":"${value}"}`;
  if (value instanceof Date) return `{"$date":${JSON.stringify(value.toISOString())}}`;
  if (Buffer.isBuffer(value)) return `{"$hex":"${value.toString("hex")}"}`;
  return JSON.stringify(String(value));
}

/**
 * One JSON text per row: the keys sorted, NULL kept apart from an empty string and a number from its text. The
 * columns the scan adds are left out; `columns` narrows the row to the columns of an older snapshot.
 */
export function canonicalRowJson(row: Record<string, unknown>, columns?: readonly string[]): string {
  const names = (columns ? columns.filter((column) => Object.hasOwn(row, column)) : Object.keys(row))
    .filter((column) => !column.startsWith(SCAN_COLUMN_PREFIX))
    .sort();
  return `{${names.map((name) => `${JSON.stringify(name)}:${canonicalValue(row[name])}`).join(",")}}`;
}

export function hashBidRow(row: Record<string, unknown>, columns?: readonly string[]): string {
  return createHash("sha256").update(canonicalRowJson(row, columns)).digest("hex");
}

/* -------------------------------------------------------------------------------------------------------------- */
/* Judging one row                                                                                                */
/* -------------------------------------------------------------------------------------------------------------- */

type BidRow = Record<string, unknown>;

interface SourceRow {
  id: string;
  label: string;
  issuer_type: string;
  jurisdiction_level: string | null;
  state_code: string;
  fips_code: string | null;
  is_enabled: number | string | null;
  last_success_at: string | null;
  consecutive_failures: number | string | null;
}

function createScanContext(sources: readonly SourceRow[], nowMs: number) {
  // The fields the repository builds its guard from (registeredSourceGuard): id, label, issuer type, level, state, FIPS.
  const identities: RegisteredSourceIdentity[] = sources.map((source) => ({
    id: source.id, label: source.label, issuerType: source.issuer_type, jurisdictionLevel: source.jurisdiction_level,
    stateCode: source.state_code, fipsCode: source.fips_code,
  }));
  return {
    nowMs,
    registeredIds: new Set(sources.map((source) => source.id)),
    index: createRegisteredSourceIndex(identities),
    matchesSource: createRegisteredSourceIdentityGuard(identities),
  };
}
type ScanContext = ReturnType<typeof createScanContext>;

/** The text before the first ":" or the whole id (the rule of the demo purge, and of the source index). */
function idPrefixOf(id: string): string {
  const colon = id.indexOf(":");
  return colon === -1 ? id : id.slice(0, colon);
}

function gateRowOf(row: BidRow): PublishableRowInput {
  return {
    id: row.id as string, source: row.source as string, title: row.title as string, issuerName: row.issuer_name as string,
    issuerType: row.issuer_type as string, stateCode: row.state_code as string, sourceUrl: row.source_url as string,
    rawPayload: row.raw_payload as string | null, qualityFlagsJson: row.quality_flags_json as string | null,
    sourceBidId: row.source_bid_id as string | null, dedupeKey: row.dedupe_key as string | null,
    jurisdictionLevel: row.jurisdiction_level as string | null, fipsCode: row.fips_code as string | null,
  };
}

/** How the row differs from the source that registered it. The guard compares case-insensitively; the report, exactly. */
function differencesFromSource(identity: SourceIdentity, source: RegisteredSourceIdentity, comparison: "exact" | "case-insensitive") {
  const expected = normalizeSourceIdentity(source);
  const level = expected.jurisdictionLevel || expected.issuerType;
  return sourceIdentityDifferences(identity, { ...expected, issuerType: level, jurisdictionLevel: level }, comparison);
}

function closedReasonOf(rawPayload: unknown): string | null {
  if (typeof rawPayload !== "string" || !rawPayload.includes("closed_reason")) return null;
  try {
    const lifecycle = (JSON.parse(rawPayload) as { lifecycle?: { closed_reason?: unknown } } | null)?.lifecycle;
    return typeof lifecycle?.closed_reason === "string" ? lifecycle.closed_reason : null;
  } catch {
    return null;
  }
}

function detailLockedAtSource(rawPayload: unknown): boolean {
  if (typeof rawPayload !== "string" || !rawPayload.includes("detail_access")) return false;
  return detailAccessFromRawPayload(rawPayload)?.restricted.includes("description") === true;
}

interface BidEvaluation {
  id: string;
  level: IntegrityLevel;
  lifecycle: BidLifecycleStatus;
  open: boolean;
  /** Shown by search. */
  visible: boolean;
  /** Why an open row is hidden; empty for any other row. */
  reasons: string[];
  identityMismatch: boolean;
  unregistered: boolean;
  demoLike: boolean;
  nonCanonicalId: boolean;
  activeFlagMismatch: boolean;
  malformedNyId: boolean;
  withBody: boolean;
  locked: boolean;
  withIssuer: boolean;
  deadlineParseable: boolean;
  withSourceUrl: boolean;
  expired: boolean;
  lastSeenAt: string | null;
  closedReason: string | null;
}

/** Everything the report and the snapshot need to know about one stored bid. Pure: no I/O, no clock. */
function evaluateBid(row: BidRow, context: ScanContext): BidEvaluation {
  const id = String(row.id);
  const isActive = row.is_active === 1;
  // As `toBid` reads it: the stored lifecycle, else the active flag.
  const lifecycle = bidLifecycleStatusOf(row.lifecycle_status) ?? (isActive ? "open" : "closed");
  const open = lifecycle === "open";
  const shown = Number(row[SHOWN_COLUMN]) === 1;

  const gateRow = gateRowOf(row);
  const publishable = isPublishableRow(gateRow, context.matchesSource);
  const visible = shown && publishable && isActive;

  const { identity, qualityFlags, dataQuality } = publicationInputsOf(gateRow);
  const attribution = context.index.resolveBid(identity);
  const identityMismatch = attribution.kind === "registered" && differencesFromSource(identity, attribution.source, "exact").length > 0;

  const prefix = idPrefixOf(id);
  const rawPayload = row.raw_payload;
  const reasons: string[] = [];
  let withIssuer = true;
  if (open) {
    const coreIssues = getBidCoreIssues({ ...identity, qualityFlags });
    withIssuer = !coreIssues.includes("invalid_issuer");
    if (!visible) {
      if (!shown) reasons.push("suppressed");
      if (!isActive) reasons.push("inactive_flag");
      if (!publishable) {
        if (attribution.kind === "ambiguous") reasons.push("registered_source_ambiguous");
        else if (attribution.kind === "registered" && differencesFromSource(identity, attribution.source, "case-insensitive").length > 0) {
          reasons.push("registered_source_mismatch");
        }
        reasons.push(...coreIssues);
        if (dataQuality?.coreValid === false) reasons.push("data_quality_core_invalid");
        if (dataQuality?.capabilities.discovery === false) reasons.push("data_quality_discovery_off");
        // The gate said no and nothing above says why: say so rather than lose the row from the explanation.
        if (!reasons.some((reason) => reason !== "suppressed" && reason !== "inactive_flag")) reasons.push("unexplained");
      }
    }
  }

  const deadline = row.deadline_date as string | null | undefined;
  const sourceUrl = row.source_url;
  return {
    id,
    level: levelOfIssuerType(row.issuer_type),
    lifecycle,
    open,
    visible,
    reasons,
    identityMismatch,
    unregistered: !context.registeredIds.has(prefix),
    demoLike: isDemoBidRow({ id, source_bid_id: row.source_bid_id as string | null }, context.registeredIds),
    nonCanonicalId: !isCanonicalSourceBid({ id, sourceBidId: row.source_bid_id }, prefix),
    activeFlagMismatch: isActive !== open,
    malformedNyId: id.startsWith(NY_ID_PREFIX) && id.indexOf(NY_COMPANY_MARKER, NY_ID_PREFIX.length) !== -1,
    withBody: getBidDescription({
      title: row.title as string | null, description: row.description as string | null, fullDescription: row.full_description as string | null,
    }) !== "",
    locked: detailLockedAtSource(rawPayload),
    withIssuer,
    deadlineParseable: parseBidDeadline(deadline) !== null,
    withSourceUrl: typeof sourceUrl === "string" && sourceUrl.trim() !== "",
    expired: bidDeadlinePassed(deadline, context.nowMs),
    lastSeenAt: typeof row.last_seen_at === "string" ? row.last_seen_at : null,
    closedReason: open ? null : closedReasonOf(rawPayload),
  };
}

function trackedValuesOf(row: BidRow): Record<TrackedColumn, TrackedValue> {
  const values = {} as Record<TrackedColumn, TrackedValue>;
  for (const column of TRACKED_COLUMNS) {
    const value = row[column];
    values[column] = value === undefined || value === null ? null : typeof value === "string" || typeof value === "number" ? value : String(value);
  }
  return values;
}

/* -------------------------------------------------------------------------------------------------------------- */
/* Building the report                                                                                            */
/* -------------------------------------------------------------------------------------------------------------- */

function zeroSourceHealth(): SourceHealth {
  return { sources: 0, neverSucceeded: 0, succeededWithin2d: 0, succeededWithin7d: 0, failing: 0 };
}

function zeroLevelReport(): LevelReport {
  return {
    total: 0, open: 0, closed: 0, awarded: 0, openVisible: 0, openHidden: 0, hiddenReasons: {},
    identityMismatch: 0, unregistered: 0, demoLike: 0, nonCanonicalId: 0, activeFlagMismatch: 0,
    withBody: 0, detailLockedAtSource: 0, bodyMissing: 0, withIssuer: 0, deadlineParseable: 0, withSourceUrl: 0,
    expiredOpen: 0, newestLastSeenAt: null, sourceHealth: zeroSourceHealth(),
  };
}

/** Most frequent first, then by code, so that two reports of the same data print the same. */
function sortedReasons(reasons: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries([...reasons].sort(([leftCode, left], [rightCode, right]) => right - left || (leftCode < rightCode ? -1 : leftCode > rightCode ? 1 : 0)));
}

function laterTimestamp(current: string | null, candidate: string | null): string | null {
  if (candidate === null) return current;
  const candidateMs = Date.parse(candidate);
  if (!Number.isFinite(candidateMs)) return current;
  if (current === null) return candidate;
  return candidateMs > Date.parse(current) ? candidate : current;
}

/**
 * The numeric metrics of a level, in the order reports and deltas list them. (`hiddenReasons`, `newestLastSeenAt` and
 * `sourceHealth` are not plain counts and are folded separately.)
 */
export const NUMERIC_LEVEL_METRICS = [
  "total", "open", "closed", "awarded", "openVisible", "openHidden",
  "identityMismatch", "unregistered", "demoLike", "nonCanonicalId", "activeFlagMismatch",
  "withBody", "detailLockedAtSource", "bodyMissing", "withIssuer", "deadlineParseable", "withSourceUrl",
  "expiredOpen",
] as const satisfies readonly (keyof LevelReport)[];

interface LevelAccumulator {
  report: LevelReport;
  reasons: Map<string, number>;
}

/** Folds evaluations and sources into the per-level report. */
class ReportBuilder {
  private readonly levels = {} as Record<IntegrityLevel, LevelAccumulator>;
  private readonly malformedNyIdList: string[] = [];

  constructor() {
    for (const level of INTEGRITY_LEVELS) this.levels[level] = { report: zeroLevelReport(), reasons: new Map() };
  }

  addBid(evaluation: BidEvaluation) {
    const { report, reasons } = this.levels[evaluation.level];
    report.total += 1;
    if (evaluation.lifecycle === "open") report.open += 1;
    else if (evaluation.lifecycle === "awarded") report.awarded += 1;
    else report.closed += 1;

    if (evaluation.identityMismatch) report.identityMismatch += 1;
    if (evaluation.unregistered) report.unregistered += 1;
    if (evaluation.demoLike) report.demoLike += 1;
    if (evaluation.nonCanonicalId) report.nonCanonicalId += 1;
    if (evaluation.activeFlagMismatch) report.activeFlagMismatch += 1;
    if (evaluation.malformedNyId) this.malformedNyIdList.push(evaluation.id);
    report.newestLastSeenAt = laterTimestamp(report.newestLastSeenAt, evaluation.lastSeenAt);

    if (!evaluation.open) return;
    if (evaluation.visible) report.openVisible += 1;
    else {
      report.openHidden += 1;
      for (const reason of evaluation.reasons) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    if (evaluation.withBody) report.withBody += 1;
    else if (!evaluation.locked) report.bodyMissing += 1;
    if (evaluation.locked) report.detailLockedAtSource += 1;
    if (evaluation.withIssuer) report.withIssuer += 1;
    if (evaluation.deadlineParseable) report.deadlineParseable += 1;
    if (evaluation.withSourceUrl) report.withSourceUrl += 1;
    if (evaluation.expired) report.expiredOpen += 1;
  }

  addSource(source: SourceRow, nowMs: number) {
    if (Number(source.is_enabled) !== 1) return;
    const health = this.levels[levelOfSource(source)].report.sourceHealth;
    health.sources += 1;
    if (Number(source.consecutive_failures) > 0) health.failing += 1;
    const succeededAt = typeof source.last_success_at === "string" ? Date.parse(source.last_success_at) : Number.NaN;
    if (!Number.isFinite(succeededAt)) {
      health.neverSucceeded += 1;
      return;
    }
    if (nowMs - succeededAt <= 2 * DAY_MS) health.succeededWithin2d += 1;
    if (nowMs - succeededAt <= 7 * DAY_MS) health.succeededWithin7d += 1;
  }

  build(generatedAt: string, dialect: IntegrityDialect): IntegrityReport {
    const levels = {} as Record<IntegrityLevel, LevelReport>;
    const totals = zeroLevelReport();
    const totalReasons = new Map<string, number>();
    for (const level of INTEGRITY_LEVELS) {
      const { report, reasons } = this.levels[level];
      levels[level] = { ...report, hiddenReasons: sortedReasons(reasons) };
      for (const metric of NUMERIC_LEVEL_METRICS) totals[metric] += report[metric];
      for (const key of Object.keys(totals.sourceHealth) as Array<keyof SourceHealth>) totals.sourceHealth[key] += report.sourceHealth[key];
      for (const [reason, count] of reasons) totalReasons.set(reason, (totalReasons.get(reason) ?? 0) + count);
      totals.newestLastSeenAt = laterTimestamp(totals.newestLastSeenAt, report.newestLastSeenAt);
    }
    totals.hiddenReasons = sortedReasons(totalReasons);
    const malformedNyIdList = [...this.malformedNyIdList].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    return { generatedAt, dialect, levels, totals, malformedNyIds: malformedNyIdList.length, malformedNyIdList };
  }
}

/** State and federal sources carry no jurisdiction level: they are state, except SAM.gov. */
function levelOfSource(source: SourceRow): IntegrityLevel {
  const level = typeof source.jurisdiction_level === "string" ? source.jurisdiction_level.trim() : "";
  if (level === "") return source.id === "sam_gov" ? "federal" : "state";
  return levelOfIssuerType(level);
}

/* -------------------------------------------------------------------------------------------------------------- */
/* Reading: one consistent read per dialect                                                                       */
/* -------------------------------------------------------------------------------------------------------------- */

interface IntegrityReader {
  dataSources(): Promise<SourceRow[]>;
  /** The columns of `bids`, from the schema (not from a row, so an empty table has them too). */
  bidColumns(): Promise<string[]>;
  /** The next page of bids after `afterId` (the first page when null), in id order, whole rows plus the scan's own column. */
  bidPage(afterId: string | null, limit: number): Promise<BidRow[]>;
}

const SOURCES_SQL =
  "SELECT id, label, issuer_type, jurisdiction_level, state_code, fips_code, is_enabled, last_success_at, consecutive_failures FROM data_sources";
const SQLITE_COLUMNS_SQL = "PRAGMA table_info(bids)";
const MYSQL_COLUMNS_SQL = "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'bids'";
// The expression of the repository's WHERE clause, evaluated by the database it runs on.
const BIDS_SQL = `SELECT *, (display_status <> 'suppressed') AS ${SHOWN_COLUMN} FROM bids`;
const FIRST_PAGE_SQL = `${BIDS_SQL} ORDER BY id LIMIT ?`;
const NEXT_PAGE_SQL = `${BIDS_SQL} WHERE id > ? ORDER BY id LIMIT ?`;

async function withSqliteReader<T>(sqlite: DemoPurgeSqlite["$client"], run: (reader: IntegrityReader) => Promise<T>): Promise<T> {
  const reader: IntegrityReader = {
    dataSources: async () => sqlite.prepare(SOURCES_SQL).all() as SourceRow[],
    bidColumns: async () => (sqlite.prepare(SQLITE_COLUMNS_SQL).all() as Array<{ name: string }>).map((column) => column.name),
    bidPage: async (afterId, limit) =>
      (afterId === null ? sqlite.prepare(FIRST_PAGE_SQL).all(limit) : sqlite.prepare(NEXT_PAGE_SQL).all(afterId, limit)) as BidRow[],
  };
  // A deferred transaction: the first read fixes the snapshot, and (WAL) writers are not held up. A caller that is
  // already inside a transaction keeps it, and keeps ending it.
  const ownsTransaction = !sqlite.inTransaction;
  if (ownsTransaction) sqlite.exec("BEGIN");
  try {
    const result = await run(reader);
    if (ownsTransaction) sqlite.exec("COMMIT");
    return result;
  } catch (error) {
    if (ownsTransaction && sqlite.inTransaction) sqlite.exec("ROLLBACK");
    throw error;
  }
}

async function withMysqlReader<T>(pool: DemoPurgeMysql, run: (reader: IntegrityReader) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection();
  try {
    // WITH CONSISTENT SNAPSHOT only holds under REPEATABLE READ (under READ COMMITTED every statement reads the newest
    // committed data), and a connection's own level is whatever the server or the URL gave it. SET TRANSACTION, without
    // SESSION, covers the next transaction only, so the pooled connection is handed back as it was.
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    // READ ONLY makes the server itself refuse a write on this connection; CONSISTENT SNAPSHOT pins every page to one moment.
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    const result = await run({
      dataSources: () => mysqlSelectMany<SourceRow>(connection, SOURCES_SQL),
      bidColumns: async () => (await mysqlSelectMany<{ name: string }>(connection, MYSQL_COLUMNS_SQL)).map((column) => column.name),
      bidPage: (afterId, limit) =>
        mysqlSelectMany<BidRow>(connection, afterId === null ? FIRST_PAGE_SQL : NEXT_PAGE_SQL, afterId === null ? [limit] : [afterId, limit]),
    });
    await connection.commit();
    return result;
  } catch (error) {
    // A failed rollback must not hide the error that made it necessary.
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

function withReader<T>(target: IntegrityTarget, run: (reader: IntegrityReader) => Promise<T>): Promise<T> {
  return "mysql" in target ? withMysqlReader(target.mysql, run) : withSqliteReader(target.database.$client, run);
}

function dialectOf(target: IntegrityTarget): IntegrityDialect {
  return "mysql" in target ? "mysql" : "sqlite";
}

/* -------------------------------------------------------------------------------------------------------------- */
/* The scan                                                                                                       */
/* -------------------------------------------------------------------------------------------------------------- */

interface ScanOptions {
  now: Date;
  /** Keep a snapshot row per bid. */
  rows: boolean;
  /** Also hash these columns of every row: the columns of an older snapshot. */
  hashColumns?: readonly string[];
}

interface ScanResult {
  report: IntegrityReport;
  columns: string[];
  rows: Record<string, SnapshotRow>;
  comparable: ComparableHashes | null;
}

async function scan(target: IntegrityTarget, options: ScanOptions): Promise<ScanResult> {
  const nowMs = options.now.getTime();
  return withReader(target, async (reader) => {
    const sources = await reader.dataSources();
    const context = createScanContext(sources, nowMs);
    const builder = new ReportBuilder();
    for (const source of sources) builder.addSource(source, nowMs);

    const bidColumns = (await reader.bidColumns()).sort();
    const rows = dictionary<SnapshotRow>();
    const comparableById = options.hashColumns ? new Map<string, string>() : null;
    let afterId: string | null = null;
    for (;;) {
      const page = await reader.bidPage(afterId, PAGE_SIZE);
      for (const row of page) {
        const evaluation = evaluateBid(row, context);
        builder.addBid(evaluation);
        if (options.rows) {
          const hash = hashBidRow(row);
          rows[evaluation.id] = {
            h: hash, level: evaluation.level, visible: evaluation.visible, open: evaluation.open, t: trackedValuesOf(row),
            ...(evaluation.closedReason ? { c: evaluation.closedReason } : {}),
          };
          if (comparableById && options.hashColumns) comparableById.set(evaluation.id, hashBidRow(row, options.hashColumns));
        }
      }
      if (page.length < PAGE_SIZE) break;
      afterId = String(page[page.length - 1].id);
    }

    const wanted = options.hashColumns ? [...options.hashColumns].sort() : null;
    const sameColumns = wanted !== null && bidColumns.length === wanted.length && bidColumns.every((column, index) => column === wanted[index]);
    return {
      report: builder.build(options.now.toISOString(), dialectOf(target)),
      columns: bidColumns,
      rows,
      // With the columns unchanged the full hash is the comparable one; nothing more to keep.
      comparable: comparableById && wanted && !sameColumns ? { columns: wanted, byId: comparableById } : null,
    };
  });
}

/* -------------------------------------------------------------------------------------------------------------- */
/* Public API                                                                                                     */
/* -------------------------------------------------------------------------------------------------------------- */

/** The per-level report of the bid data at `now`. Reads only. */
export async function buildIntegrityReport(target: IntegrityTarget, options: { now: Date }): Promise<IntegrityReport> {
  return (await scan(target, { now: options.now, rows: false })).report;
}

/**
 * The report plus one entry per bid. `hashColumns` (the `columns` of an earlier snapshot) additionally hashes the rows
 * over those columns, so that a compare is not drowned in "changed" rows when a migration added a column since.
 */
export async function buildIntegritySnapshot(
  target: IntegrityTarget,
  options: { now: Date; hashColumns?: readonly string[] },
): Promise<IntegritySnapshot> {
  const result = await scan(target, { now: options.now, rows: true, hashColumns: options.hashColumns });
  return {
    version: 1,
    takenAt: options.now.toISOString(),
    dialect: dialectOf(target),
    columns: result.columns,
    report: result.report,
    rows: result.rows,
    ...(result.comparable ? { comparable: result.comparable } : {}),
  };
}

/** The snapshot file: one line of JSON, rows by id, nothing that is only in memory. */
export function serializeIntegritySnapshot(snapshot: IntegritySnapshot): string {
  const rows = Object.fromEntries(Object.keys(snapshot.rows).sort().map((id) => [id, snapshot.rows[id]]));
  return JSON.stringify({
    version: snapshot.version, takenAt: snapshot.takenAt, dialect: snapshot.dialect, columns: snapshot.columns,
    report: snapshot.report, rows,
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function validSnapshotRow(value: unknown): value is SnapshotRow {
  return isRecord(value) && typeof value.h === "string" && (INTEGRITY_LEVELS as readonly unknown[]).includes(value.level)
    && typeof value.visible === "boolean" && typeof value.open === "boolean" && isRecord(value.t)
    && (value.c === undefined || typeof value.c === "string");
}

/** Reads a snapshot file. Throws IntegritySnapshotError for anything that is not a version 1 snapshot. */
export function parseIntegritySnapshot(text: string): IntegritySnapshot {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new IntegritySnapshotError("not a data:integrity snapshot: the file is not valid JSON.");
  }
  if (!isRecord(value) || value.version === undefined) {
    throw new IntegritySnapshotError("not a data:integrity snapshot: the file has no version.");
  }
  if (value.version !== 1) {
    throw new IntegritySnapshotError(`not a data:integrity snapshot this version can read: it is version ${String(value.version)}, this tool reads version 1.`);
  }
  const { takenAt, dialect, columns, report, rows } = value;
  const reportLevels = isRecord(report) ? report.levels : undefined;
  if (typeof takenAt !== "string" || (dialect !== "sqlite" && dialect !== "mysql")
    || !Array.isArray(columns) || !columns.every((column) => typeof column === "string")
    || !isRecord(report) || !isRecord(reportLevels) || !isRecord(report.totals)
    || !INTEGRITY_LEVELS.every((level) => isRecord(reportLevels[level]))
    || !isRecord(rows)) {
    throw new IntegritySnapshotError("not a data:integrity snapshot: takenAt, dialect, columns, report or rows is missing or malformed.");
  }
  const parsedRows = dictionary<SnapshotRow>();
  for (const [id, row] of Object.entries(rows)) {
    if (!validSnapshotRow(row)) throw new IntegritySnapshotError(`not a data:integrity snapshot: the entry for bid ${JSON.stringify(id)} is malformed.`);
    parsedRows[id] = row;
  }
  return { version: 1, takenAt, dialect, columns: columns as string[], report: report as unknown as IntegrityReport, rows: parsedRows };
}
