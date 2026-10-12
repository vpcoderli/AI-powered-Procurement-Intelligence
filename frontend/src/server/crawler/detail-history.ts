import type { AppDatabase } from "@/server/db/client";
import type { CrawlerJsonRunPayload } from "./mysql-json-importer";
import { mysqlSelectMany } from "@/server/db/mysql-runtime";
import type { CrawlableSource, MysqlSourceStore } from "./source-registry";
import { evaluateCrawlerBid, existingIdentityIssues } from "./data-quality";
import { isCanonicalSourceBid } from "@/lib/source-identity";

export type DetailHistoryRecord = Record<string, unknown>;

export interface DetailHistoryStore {
  database?: AppDatabase;
  mysql?: MysqlSourceStore;
}

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

/**
 * Read persisted bodies AND retry provenance, including records outside the current date
 * window. Deliberately no newest-first LIMIT: that would create another starving backlog.
 * The escaped ID namespace is canonical even when the source's display label changes.
 */
export async function loadDetailHistory(store: DetailHistoryStore, sourceId: string, source?: CrawlableSource): Promise<DetailHistoryRecord[]> {
  const prefix = `${sourceId.replace(/[!%_]/g, (character) => `!${character}`)}:%`;
  const sql = "SELECT * FROM bids WHERE id LIKE ? ESCAPE '!' ORDER BY first_seen_at, id";
  const rows = store.mysql
    ? await mysqlSelectMany<DetailHistoryRecord>(store.mysql, sql, [prefix])
    : store.database!.$client.prepare(sql).all(prefix) as DetailHistoryRecord[];
  return normalizedRows(rows, sourceId, source);
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
