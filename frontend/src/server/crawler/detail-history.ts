import type { AppDatabase } from "@/server/db/client";
import type { CrawlerJsonRunPayload } from "./mysql-json-importer";
import { mysqlSelectMany } from "@/server/db/mysql-runtime";
import type { CrawlableSource, MysqlSourceStore } from "./source-registry";
import { evaluateCrawlerBid, existingIdentityIssues } from "./data-quality";
import { getBidDescription } from "@/lib/bid-description";
import { isCanonicalSourceBid } from "@/lib/source-identity";

export type DetailHistoryRecord = Record<string, unknown>;

export interface DetailHistoryStore {
  database?: AppDatabase;
  mysql?: MysqlSourceStore;
}

type Dialect = "sqlite" | "mysql";

/** A list run only returns bids its source showed recently; older rows cannot be reused. */
export const DETAIL_HISTORY_LIST_WINDOW_DAYS = 30;
/** Safety cap for one list run's history, newest sighting first. */
export const DETAIL_HISTORY_LIST_LIMIT = 5000;
/** Backfill reads a page at a time so rows the registry no longer accepts cannot block valid ones. */
export const DETAIL_BACKFILL_PAGE_SIZE = 200;
export const DETAIL_BACKFILL_MAX_PAGES = 10;
/** crawler/apsi_crawler/enrichment.py: max_details_per_run defaults to 25 and is clamped to 1–200. */
const DEFAULT_DETAIL_ATTEMPTS = 25;
const DAY_MS = 86_400_000;

function jsonValue(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizedRows(rows: DetailHistoryRecord[], sourceId: string, source?: CrawlableSource): DetailHistoryRecord[] {
  return rows.filter((row) => isCanonicalSourceBid({ id: row.id, sourceBidId: row.source_bid_id }, sourceId))
    .map((row): DetailHistoryRecord => ({
      ...row,
      raw_payload: jsonValue(row.raw_payload, {}),
      quality_flags_json: jsonValue(row.quality_flags_json, []),
      // Attachments are merged additively by persistence. A detail retry cannot delete them.
      attachments: [],
    })).filter((row) => {
      if (!evaluateCrawlerBid(row).coreValid) return false;
      const level = source?.jurisdictionLevel ?? source?.issuerType;
      const expected = source ? { state_code: source.stateCode, issuer_type: level, jurisdiction_level: level, fips_code: source.fipsCode }
        : sourceId === "sam_gov" ? { state_code: "US", issuer_type: "federal", jurisdiction_level: "federal" } : {};
      return existingIdentityIssues(row, expected).length === 0 && (!source?.baseUrl || row.source_url !== source.baseUrl);
    });
}

/** True when neither stored text field is usable procurement content. */
export function missingBody(row: DetailHistoryRecord): boolean {
  return !getBidDescription({ title: String(row.title ?? ""), description: String(row.description ?? ""), fullDescription: String(row.full_description ?? "") });
}

function historyOutcome(row: DetailHistoryRecord): Record<string, unknown> {
  const raw = row.raw_payload as { enrichment?: { outcome?: unknown } } | null;
  const outcome = raw?.enrichment?.outcome;
  return outcome && typeof outcome === "object" && !Array.isArray(outcome) ? outcome as Record<string, unknown> : {};
}

export function historyDue(row: DetailHistoryRecord, now: Date): boolean {
  const retry = historyOutcome(row).next_retry_at;
  const at = typeof retry === "string" ? Date.parse(retry) : NaN;
  return !Number.isFinite(at) || at <= now.getTime();
}

export function historyAge(row: DetailHistoryRecord): number {
  const at = historyOutcome(row).attempted_at ?? row.first_seen_at;
  const parsed = typeof at === "string" ? Date.parse(at) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Detail fetches one backfill run may attempt, read the way the crawler reads it. */
export function detailAttemptBudget(source: Pick<CrawlableSource, "fetchConfig">): number {
  const enrichment = source.fetchConfig?.enrichment;
  const requested = enrichment && typeof enrichment === "object" && !Array.isArray(enrichment)
    ? (enrichment as Record<string, unknown>).max_details_per_run : undefined;
  return typeof requested === "number" && Number.isFinite(requested)
    ? Math.min(200, Math.max(1, Math.trunc(requested)))
    : DEFAULT_DETAIL_ATTEMPTS;
}

/**
 * The source's canonical ID namespace. SQLite: the primary-key range `[<id>:, <id>;)`, because
 * its case-insensitive LIKE cannot use that index. MySQL: an escaped prefix LIKE, which the
 * optimizer reads as a primary-key range; its default utf8mb4_0900_ai_ci collation sorts ";"
 * before ":", so the SQLite range would be empty there.
 */
export function sourceIdPredicate(dialect: Dialect, sourceId: string): [string, string[]] {
  return dialect === "mysql"
    ? ["id LIKE ? ESCAPE '!'", [`${sourceId.replace(/[!%_]/g, (character) => `!${character}`)}:%`]]
    : ["id >= ? AND id < ?", [`${sourceId}:`, `${sourceId};`]];
}

async function selectRows(store: DetailHistoryStore, sql: string, values: unknown[]): Promise<DetailHistoryRecord[]> {
  return store.mysql
    ? mysqlSelectMany<DetailHistoryRecord>(store.mysql, sql, values)
    : store.database!.$client.prepare(sql).all(...values) as DetailHistoryRecord[];
}

/**
 * History for a list run: this source's rows seen within 30 days of its newest sighting, newest
 * first, at most 5,000. Anchoring on the newest sighting rather than the clock keeps the window
 * full after a worker outage.
 */
export async function loadDetailHistory(store: DetailHistoryStore, sourceId: string, source?: CrawlableSource): Promise<DetailHistoryRecord[]> {
  const [scope, scopeValues] = sourceIdPredicate(store.mysql ? "mysql" : "sqlite", sourceId);
  const [newest] = await selectRows(store, `SELECT MAX(last_seen_at) AS latest FROM bids WHERE ${scope}`, scopeValues);
  const latest = typeof newest?.latest === "string" ? Date.parse(newest.latest) : Number.NaN;
  const since = Number.isFinite(latest) ? new Date(latest - DETAIL_HISTORY_LIST_WINDOW_DAYS * DAY_MS).toISOString() : "";
  const rows = await selectRows(store,
    `SELECT * FROM bids WHERE ${scope} AND last_seen_at >= ? ORDER BY last_seen_at DESC, id LIMIT ?`,
    [...scopeValues, since, DETAIL_HISTORY_LIST_LIMIT]);
  if (rows.length >= DETAIL_HISTORY_LIST_LIMIT) {
    console.warn(JSON.stringify({ event: "crawler_detail_history_truncated", source: sourceId, limit: DETAIL_HISTORY_LIST_LIMIT }));
  }
  return normalizedRows(rows, sourceId, source);
}

function outcomeText(dialect: Dialect, field: "attempted_at" | "next_retry_at"): string {
  return dialect === "mysql"
    ? `(CASE WHEN JSON_VALID(raw_payload) THEN NULLIF(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.enrichment.outcome.${field}')), 'null') END)`
    : `(CASE WHEN json_valid(raw_payload) THEN json_extract(raw_payload, '$.enrichment.outcome.${field}') END)`;
}

/** No usable stored text: empty, the title again, or a bare SAM description link. */
function blankText(column: "description" | "full_description"): string {
  return `(TRIM(COALESCE(${column}, '')) = '' OR LOWER(TRIM(${column})) = LOWER(TRIM(title))`
    + ` OR ${column} LIKE 'https://api.sam.gov/%noticedesc%')`;
}

/**
 * One page of backfill candidates: rows with no usable stored body that are due, oldest attempt
 * (else first sighting) first. It approximates `missingBody`/`historyDue`, which re-check every
 * row. MySQL compares the JSON text and the column under one binary collation.
 */
export function detailBackfillQuery(dialect: Dialect, sourceId: string, now: Date, page: number): { sql: string; values: unknown[] } {
  const [scope, scopeValues] = sourceIdPredicate(dialect, sourceId);
  const attempted = outcomeText(dialect, "attempted_at");
  const order = dialect === "mysql"
    ? `COALESCE(CONVERT(${attempted} USING utf8mb4) COLLATE utf8mb4_bin, CONVERT(first_seen_at USING utf8mb4) COLLATE utf8mb4_bin)`
    : `COALESCE(${attempted}, first_seen_at)`;
  return {
    sql: `SELECT * FROM bids WHERE ${scope} AND ${blankText("description")} AND ${blankText("full_description")}`
      + ` AND COALESCE(${outcomeText(dialect, "next_retry_at")}, '') <= ? ORDER BY ${order}, id LIMIT ? OFFSET ?`,
    values: [...scopeValues, now.toISOString(), DETAIL_BACKFILL_PAGE_SIZE, page * DETAIL_BACKFILL_PAGE_SIZE],
  };
}

/** Backfill candidates for one run: at most `limit`, read a page at a time. */
export async function loadDetailBackfillCandidates(
  store: DetailHistoryStore,
  sourceId: string,
  source: CrawlableSource | undefined,
  options: { limit: number; now?: Date },
): Promise<DetailHistoryRecord[]> {
  const now = options.now ?? new Date();
  const dialect: Dialect = store.mysql ? "mysql" : "sqlite";
  const candidates: DetailHistoryRecord[] = [];
  for (let page = 0; page < DETAIL_BACKFILL_MAX_PAGES && candidates.length < options.limit; page += 1) {
    const { sql, values } = detailBackfillQuery(dialect, sourceId, now, page);
    const rows = await selectRows(store, sql, values);
    for (const row of normalizedRows(rows, sourceId, source)) {
      if (candidates.length < options.limit && missingBody(row) && historyDue(row, now)) candidates.push(row);
    }
    if (rows.length < DETAIL_BACKFILL_PAGE_SIZE) break;
  }
  return candidates;
}

/** Historical retries can never prove that absent open records have disappeared. */
export function fenceDetailBackfillPayload(payload: CrawlerJsonRunPayload): CrawlerJsonRunPayload {
  const pagination = payload.metadata?.pagination;
  return {
    ...payload,
    metadata: {
      ...(payload.metadata ?? {}),
      mode: "detail_backfill",
      pagination: { ...(pagination && typeof pagination === "object" ? pagination : {}), complete: false, stopped_reason: "detail_backfill" },
    },
  };
}
