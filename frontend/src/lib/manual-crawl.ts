import {
  runSamGovCrawlerNow,
  runStateCrawlersNow,
  type CrawlerRunWindowOptions,
  type StateCrawlerRunResponse,
  type StateCrawlerRunResultEntry,
} from "@/lib/api/admin";
import { stateCrawlerSourceIdForAdminSource } from "@/lib/state-crawler-sources";

/** Browser-side source identity. Older callers need not supply the registered jurisdiction. */
export interface CrawlerRunSource {
  id: string;
  issuerType: string;
  jurisdictionLevel?: string | null;
  stateCode: string;
  crawlerSourceId: string | null;
}

export type BatchRunSource = CrawlerRunSource & {
  label: string;
  isEnabled: boolean;
};

/** Federal uses its separate route; local registry rows always run by data_sources.id. */
export function crawlerRunIdFor(source: CrawlerRunSource): string | null {
  const level = sourceJurisdiction(source);
  if (level === "federal") return null;
  if (level !== "state") return source.id;
  return source.crawlerSourceId ?? stateCrawlerSourceIdForAdminSource({ issuerType: "state", stateCode: source.stateCode });
}

export function runTargets(items: readonly CrawlerRunSource[]): { runIds: string[]; skippedIds: string[] } {
  const runIds: string[] = [];
  const skippedIds: string[] = [];
  for (const item of items) {
    const runId = crawlerRunIdFor(item);
    if (runId) runIds.push(runId);
    else skippedIds.push(item.id);
  }
  return { runIds: Array.from(new Set(runIds)), skippedIds };
}

export interface RunTally {
  ok: number;
  failed: number;
  skipped: number;
}

export function emptyRunTally(): RunTally {
  return { ok: 0, failed: 0, skipped: 0 };
}

/** Legacy raw-response tally for callers of source-bulk-actions. Execution tallies requested rows only. */
export function summarizeRunResults(response: StateCrawlerRunResponse): RunTally {
  let ok = 0;
  let failed = response.errors?.length ?? 0;
  let skipped = 0;
  for (const result of response.results) {
    if (result.status === "success") ok += 1;
    else if (result.status === "failure") failed += 1;
    else skipped += 1;
  }
  return { ok, failed, skipped };
}

export function addRunResponse(tally: RunTally, response: StateCrawlerRunResponse): RunTally {
  const summary = summarizeRunResults(response);
  return { ok: tally.ok + summary.ok, failed: tally.failed + summary.failed, skipped: tally.skipped + summary.skipped };
}

export const BATCH_JURISDICTION_LEVELS = ["federal", "state", "county", "city", "township", "special_district"] as const;
export type BatchJurisdictionLevel = (typeof BATCH_JURISDICTION_LEVELS)[number];

export const BATCH_WINDOW_PRESETS = ["all", "last7", "last30", "last90", "custom"] as const;
export type BatchWindowPreset = (typeof BATCH_WINDOW_PRESETS)[number];

export const BATCH_RUN_CHUNK_SIZE = 5;

export const SAM_GOV_ENTRY_KEY = "sam_gov_federal";

function sourceJurisdiction(source: Pick<CrawlerRunSource, "jurisdictionLevel" | "issuerType">): string {
  const registered = source.jurisdictionLevel;
  return registered && (BATCH_JURISDICTION_LEVELS as readonly string[]).includes(registered)
    ? registered
    : source.issuerType;
}

export interface BatchRunEntry {
  /** Stable selection key: the runnable crawler source id, or SAM_GOV_ENTRY_KEY for federal. */
  key: string;
  kind: "state_task" | "sam_gov";
  label: string;
  level: BatchJurisdictionLevel;
  stateCode: string | null;
}

export type BatchRunEntryStatus =
  | { phase: "pending" }
  | { phase: "running" }
  | {
      phase: "done";
      status: "success" | "failure" | "blocked" | "locked" | "disabled" | "deferred" | "unknown";
      fetchedCount?: number;
      dateFilter?: { kept?: number; dropped?: number; unparsed?: number };
      /**
       * Orchestrator-provided reason: the blocked governance/legal sentence, or, for `deferred`,
       * `platform_throttled:<sourceId>` (C7).
       */
      reason?: string;
      /** A returned request/runner error; missing response rows have no error code. */
      errorCode?: string;
      /** Verified-empty-list marker from `metadata.emptyState` (C1), when the run reported one. */
      emptyState?: { verified: boolean; marker: string | null };
    };

/**
 * How a zero-row success should read in the panel.
 *
 * - `verified_empty`: the crawler confirmed the tenant page and an explicit "no open bids"
 *   phrase, so zero rows is the correct answer, not a silent parse failure.
 * - `zero`: a success with nothing fetched and no empty-state evidence — still a success, but
 *   worth showing as such rather than hiding behind a bare "Success" badge.
 * - `rows`: the ordinary case.
 */
export type BatchSuccessKind = "verified_empty" | "zero" | "rows";

export function batchSuccessKind(status: BatchRunEntryStatus): BatchSuccessKind {
  if (status.phase !== "done" || status.status !== "success") return "rows";
  if (status.emptyState?.verified) return "verified_empty";
  return status.fetchedCount === 0 ? "zero" : "rows";
}

/**
 * Maps the orchestrator's blocked `reason` sentence onto an i18n hint key, so the panel can
 * explain WHY a run was blocked (governance approval vs legal review) instead of leaving the
 * bare "blocked" badge ambiguous with a portal-side rejection. Unknown reasons fall back to
 * the raw text.
 */
export function blockedReasonHintKey(reason: string | undefined): string | null {
  if (!reason) return null;
  if (reason.includes("legal review")) return "admin.batchRunBlockedLegal";
  if (reason.includes("governance")) return "admin.batchRunBlockedApproval";
  return null;
}

/**
 * Extracts the offending source id from the C7 deferral reason (`platform_throttled:<sourceId>`)
 * so the panel can name which source tripped the platform throttle. Returns null for any other
 * shape, and the raw reason is shown instead.
 */
export function deferredThrottleSourceId(reason: string | undefined): string | null {
  if (!reason) return null;
  const match = /^platform_throttled:(.+)$/.exec(reason.trim());
  return match ? match[1] : null;
}

export function batchJurisdictionLevelOf(source: Pick<BatchRunSource, "jurisdictionLevel" | "issuerType">): BatchJurisdictionLevel {
  const level = sourceJurisdiction(source);
  if (level && (BATCH_JURISDICTION_LEVELS as readonly string[]).includes(level)) {
    return level as BatchJurisdictionLevel;
  }
  // Retain the legacy fallback for malformed unknown levels; valid issuer types were handled above.
  return source.issuerType === "federal" ? "federal" : "state";
}

/**
 * Flattens the admin source list into runnable batch entries: every enabled non-federal row with
 * a resolvable crawler source id, plus one synthetic SAM.gov entry for the federal level (federal
 * rows are excluded from /api/crawler/state/run and run through /api/crawler/sam-gov/run instead).
 */
export function buildBatchRunEntries(
  sources: BatchRunSource[],
  crawlerSourceIdFor: (source: BatchRunSource) => string | null = crawlerRunIdFor,
): BatchRunEntry[] {
  const entries: BatchRunEntry[] = [
    { key: SAM_GOV_ENTRY_KEY, kind: "sam_gov", label: "SAM.gov", level: "federal", stateCode: null },
  ];

  for (const source of sources) {
    if (!source.isEnabled) continue;
    const level = batchJurisdictionLevelOf(source);
    if (level === "federal") continue;
    const crawlerSourceId = level === "state" ? crawlerSourceIdFor(source) : source.id;
    if (!crawlerSourceId || entries.some((entry) => entry.key === crawlerSourceId)) continue;
    entries.push({
      key: crawlerSourceId,
      kind: "state_task",
      label: source.label,
      level,
      stateCode: source.stateCode || null,
    });
  }

  return entries;
}

export function filterBatchEntries(
  entries: BatchRunEntry[],
  levelFilter: BatchJurisdictionLevel | "all",
  stateFilter: string | "all",
): BatchRunEntry[] {
  return entries.filter((entry) => {
    if (levelFilter !== "all" && entry.level !== levelFilter) return false;
    if (stateFilter !== "all" && entry.stateCode !== stateFilter) return false;
    return true;
  });
}

export function countBatchEntriesByLevel(entries: BatchRunEntry[]): Record<BatchJurisdictionLevel, number> {
  const counts = { federal: 0, state: 0, county: 0, city: 0, township: 0, special_district: 0 };
  for (const entry of entries) counts[entry.level] += 1;
  return counts;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && isoDate(date) === value;
}

export type BatchWindow = { postedFrom?: string; postedTo?: string } | null;

/**
 * Resolves the selected time window into postedFrom/postedTo (ISO yyyy-mm-dd, inclusive).
 * Returns null for "all" (no window) and the string "invalid" for an unusable custom window.
 * "lastN" spans exactly N calendar days ending today (UTC).
 */
export function resolveBatchWindow(
  preset: BatchWindowPreset,
  custom: { from: string; to: string },
  today: Date,
): BatchWindow | "invalid" {
  if (preset === "all") return null;

  if (preset === "custom") {
    const from = custom.from.trim();
    const to = custom.to.trim();
    if (!from && !to) return null;
    if (from && !isIsoDate(from)) return "invalid";
    if (to && !isIsoDate(to)) return "invalid";
    if (from && to && from > to) return "invalid";
    return { ...(from ? { postedFrom: from } : {}), ...(to ? { postedTo: to } : {}) };
  }

  const days = preset === "last7" ? 7 : preset === "last30" ? 30 : 90;
  const from = new Date(today.getTime());
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { postedFrom: isoDate(from), postedTo: isoDate(today) };
}

/** "2026-08-01" -> "08/01/2026" (the SAM.gov API's MM/dd/yyyy format). */
export function samGovDateFromIso(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
}

export function chunkBatchKeys(keys: string[], size = BATCH_RUN_CHUNK_SIZE): string[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("Chunk size must be a positive integer.");
  const chunks: string[][] = [];
  for (let index = 0; index < keys.length; index += size) {
    chunks.push(keys.slice(index, index + size));
  }
  return chunks;
}

const BATCH_DONE_STATUSES = ["success", "failure", "blocked", "locked", "disabled", "deferred"] as const;

export function batchStatusFromRunResult(entry: StateCrawlerRunResultEntry): BatchRunEntryStatus {
  return normalizeRunStatus(entry);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeRunStatus(value: unknown): Extract<BatchRunEntryStatus, { phase: "done" }> {
  const entry = record(value);
  const status = typeof entry?.status === "string" && (BATCH_DONE_STATUSES as readonly string[]).includes(entry.status)
    ? (entry.status as (typeof BATCH_DONE_STATUSES)[number])
    : "unknown";
  const runner = record(entry?.runner);
  const metadata = record(record(runner?.payload)?.metadata);
  const emptyState = record(metadata?.emptyState);
  const filter = record(metadata?.dateFilter);
  const dateFilter = filter ? Object.fromEntries(
    ["kept", "dropped", "unparsed"].flatMap((key) => typeof filter[key] === "number" ? [[key, filter[key]]] : []),
  ) : undefined;

  return {
    phase: "done",
    status,
    fetchedCount: typeof runner?.fetchedCount === "number" ? runner.fetchedCount : undefined,
    dateFilter,
    ...(typeof entry?.reason === "string" && entry.reason ? { reason: entry.reason } : {}),
    ...(typeof runner?.errorCode === "string" ? { errorCode: runner.errorCode } : {}),
    ...(emptyState
      ? { emptyState: { verified: emptyState.verified === true, marker: typeof emptyState.marker === "string" ? emptyState.marker : null } }
      : {}),
  };
}

/** SAM returns one route envelope, so validate its identity before attributing any outcome. */
function normalizeSamGovStatus(value: unknown): Extract<BatchRunEntryStatus, { phase: "done" }> {
  const outcome = record(value);
  if (
    !outcome ||
    outcome.source !== "sam_gov" ||
    typeof outcome.ok !== "boolean" ||
    typeof outcome.status !== "string" ||
    !(BATCH_DONE_STATUSES as readonly string[]).includes(outcome.status) ||
    outcome.ok !== (outcome.status === "success")
  ) {
    return { phase: "done", status: "unknown" };
  }
  return normalizeRunStatus(outcome);
}

/** The owned HTTP boundary. Tests supply an in-memory transport through this same interface. */
export interface ManualCrawlTransport {
  runState: (keys: string[], window: CrawlerRunWindowOptions) => Promise<unknown>;
  runSamGov: (window: CrawlerRunWindowOptions) => Promise<unknown>;
}

const httpTransport: ManualCrawlTransport = {
  runState: runStateCrawlersNow,
  runSamGov: runSamGovCrawlerNow,
};

export interface ManualCrawlProgress {
  statuses: Record<string, BatchRunEntryStatus>;
  /** Sources whose request settled, including an attempted transport failure. */
  completedCount: number;
  total: number;
  /** Confirmed response outcomes only: a transport failure cannot tell us whether its sources ran. */
  tally: RunTally;
  notRunnableIds: string[];
  attemptedIds: string[];
  /** Never sent after a stop; their statuses remain pending. */
  unsentIds: string[];
}

export type ManualCrawlRequest =
  | { sources: readonly CrawlerRunSource[] }
  | { entries: readonly Pick<BatchRunEntry, "key" | "kind">[] };

export interface ManualCrawlOptions {
  transportFailure: "stop" | "continue";
  window?: CrawlerRunWindowOptions | null;
  onProgress?: (progress: ManualCrawlProgress) => void;
  transport?: ManualCrawlTransport;
}

export type ManualCrawlOutcome = ManualCrawlProgress & (
  | { failed: false }
  | { failed: true; failure: unknown }
);

/**
 * Runs the selected sources through the existing routes, retaining per-source outcomes across
 * requests. List/detail stop on transport errors; jurisdiction batches continue. SAM always runs
 * last and receives its own date format. Structured failures never interrupt later requests.
 */
export async function runManualCrawl(
  request: ManualCrawlRequest,
  options: ManualCrawlOptions,
): Promise<ManualCrawlOutcome> {
  const resolvedWindow = resolveBatchWindow("custom", {
    from: options.window?.postedFrom ?? "",
    to: options.window?.postedTo ?? "",
  }, new Date());
  if (resolvedWindow === "invalid") {
    throw new RangeError("Invalid published-date window.");
  }
  const window = resolvedWindow ?? {};
  const transport = options.transport ?? httpTransport;
  const mapped = "sources" in request ? runTargets(request.sources) : null;
  const candidates = mapped
    ? mapped.runIds.map((key) => ({ key, kind: "state_task" as const }))
    : "entries" in request ? request.entries : [];
  const targets = [...new Map(candidates.map((entry) => [entry.key, entry])).values()];
  const keys = targets.map((entry) => entry.key);
  const stateKeys = targets.filter((entry) => entry.kind === "state_task").map((entry) => entry.key);
  const samKeys = targets.filter((entry) => entry.kind === "sam_gov").map((entry) => entry.key);
  const statuses: Record<string, BatchRunEntryStatus> = Object.fromEntries(keys.map((key) => [key, { phase: "pending" }]));
  const attempted = new Set<string>();
  let completedCount = 0;
  const tally = emptyRunTally();
  let interruption: { failure: unknown } | undefined;

  const snapshot = (): ManualCrawlProgress => ({
    statuses: { ...statuses },
    completedCount,
    total: targets.length,
    tally: { ...tally },
    notRunnableIds: [...(mapped?.skippedIds ?? [])],
    attemptedIds: [...attempted],
    unsentIds: keys.filter((key) => !attempted.has(key)),
  });
  const publish = () => options.onProgress?.(snapshot());
  const finishResponse = (requested: string[], response: unknown) => {
    const body = record(response);
    const results = Array.isArray(body?.results) ? body.results : [];
    const errors = Array.isArray(body?.errors) ? body.errors : [];
    const requestedSet = new Set(requested);
    const returned = new Map<string, BatchRunEntryStatus>();
    for (const value of results) {
      const result = record(value);
      if (typeof result?.source === "string" && requestedSet.has(result.source)) returned.set(result.source, normalizeRunStatus(result));
    }
    for (const value of errors) {
      const error = record(value);
      if (typeof error?.source === "string" && requestedSet.has(error.source)) {
        returned.set(error.source, {
          phase: "done",
          status: "unknown",
          errorCode: typeof error.code === "string" ? error.code : "UNKNOWN_ERROR",
          ...(typeof error.message === "string" ? { reason: error.message } : {}),
        });
      }
    }
    for (const key of requested) statuses[key] = returned.get(key) ?? { phase: "done", status: "unknown" };
  };
  const addRequestedOutcomes = (requested: string[]) => {
    for (const key of requested) {
      const status = statuses[key];
      if (status.phase !== "done") continue;
      if (status.status === "success") tally.ok += 1;
      else if (status.status === "failure" || status.status === "unknown") tally.failed += 1;
      else tally.skipped += 1;
    }
  };
  const send = async (requested: string[], run: () => Promise<unknown>, isSamGov = false): Promise<boolean> => {
    for (const key of requested) {
      attempted.add(key);
      statuses[key] = { phase: "running" };
    }
    publish();
    try {
      const response = await run();
      if (isSamGov) {
        for (const key of requested) statuses[key] = normalizeSamGovStatus(response);
      } else {
        finishResponse(requested, response);
      }
      addRequestedOutcomes(requested);
    } catch (failure) {
      interruption ??= { failure };
      const reason = failure instanceof Error ? failure.message : typeof failure === "string" ? failure : "";
      for (const key of requested) statuses[key] = { phase: "done", status: "failure", ...(reason ? { reason } : {}) };
    }
    completedCount += requested.length;
    publish();
    return !interruption || options.transportFailure === "continue";
  };

  publish();
  let continuing = true;
  for (const chunk of chunkBatchKeys(stateKeys)) {
    continuing = await send(chunk, () => transport.runState(chunk, { ...window }));
    if (!continuing) break;
  }
  if (continuing && samKeys.length > 0) {
    const samWindow = {
      ...(window.postedFrom ? { postedFrom: samGovDateFromIso(window.postedFrom) } : {}),
      ...(window.postedTo ? { postedTo: samGovDateFromIso(window.postedTo) } : {}),
    };
    await send(samKeys, () => transport.runSamGov(samWindow), true);
  }
  return { ...snapshot(), ...(interruption ? { failed: true, failure: interruption.failure } : { failed: false }) };
}
