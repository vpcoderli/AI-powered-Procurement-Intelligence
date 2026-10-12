import { bidDeadlineExpiresAtMs, bidDeadlinePassed } from "@/lib/bid-deadline";
import { closedRawPayload } from "@/server/crawler/lifecycle";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectMany, mysqlTransaction } from "@/server/db/mysql-runtime";

/** Open bids read per page, and per write transaction. */
export const DEFAULT_SWEEP_BATCH_SIZE = 500;
/** Bounds the `IN (...)` list a page of closures sends. */
const MAX_SWEEP_BATCH_SIZE = 5_000;

export interface LifecycleSweepResult {
  /** Open bids examined. */
  scanned: number;
  /** Bids closed; on a dry run, bids that would be. */
  closed: number;
  /** Open bids with a non-blank deadline that `parseBidDeadline` rejects; they stay open. */
  unparseable: number;
  closedByIssuerType: Record<string, number>;
  dryRun: boolean;
}

export interface LifecycleSweepOptions {
  now: Date;
  /** Count what would be closed and write nothing. */
  dryRun?: boolean;
  /** Open bids per page and per write transaction; a value that is not a positive whole number reads as the default. */
  batchSize?: number;
}

/** A MySQL connection holding a transaction, as the sweep's page of closures uses it. */
interface MysqlSweepConnection {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
  beginTransaction: () => Promise<void>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  release: () => void;
}

/**
 * A MySQL pool. Pages are read through `query`; every page of closures holds its transaction on a connection
 * from `getConnection`, so a narrower store (one with only `query` and `execute`) is not accepted.
 */
export interface MysqlSweepStore {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  getConnection: () => Promise<MysqlSweepConnection>;
}

export type LifecycleSweepTarget = { database: AppDatabase } | { mysql: MysqlSweepStore };

interface OpenBid {
  id: string;
  deadline_date: string | null;
  issuer_type: string;
}

/** An open bid read under the write lock, with the payload the close is recorded in. */
interface LockedBid extends OpenBid {
  raw_payload: string | null;
}

interface SweepStore {
  /** The next open bids after `afterId`, in id order, without their payloads. */
  readPage(afterId: string, limit: number): Promise<OpenBid[]>;
  /** Closes the expired bids of one page in one transaction; resolves to the ones it closed. */
  closePage(expired: OpenBid[], nowMs: number, nowIso: string): Promise<OpenBid[]>;
}

const PAGE_SQL = "SELECT id, deadline_date, issuer_type FROM bids WHERE lifecycle_status = 'open' AND id > ? ORDER BY id LIMIT ?";

function lockedReadSql(count: number, lock: string) {
  return `SELECT id, deadline_date, issuer_type, raw_payload FROM bids WHERE lifecycle_status = 'open' AND id IN (${Array(count).fill("?").join(", ")})${lock}`;
}

function closeSql(withPayload: boolean) {
  return `UPDATE bids SET lifecycle_status = 'closed', is_active = 0, ${withPayload ? "raw_payload = ?, " : ""}updated_at = ? WHERE id = ? AND lifecycle_status = 'open'`;
}

/**
 * What to write for a bid read under the write lock, or null when it is not to be closed after all: an import
 * may have moved its deadline since the page was read, and the import's own write is then the newer truth.
 * The payload is null when it is not a JSON object, which is then left as it is.
 */
function closureOf(bid: LockedBid, nowMs: number, nowIso: string): { rawPayload: string | null } | null {
  if (!bidDeadlinePassed(bid.deadline_date, nowMs)) return null;
  return { rawPayload: closedRawPayload(bid.raw_payload, "deadline_passed", nowIso, { deadline: String(bid.deadline_date).trim() }) };
}

function sqliteSweepStore(database: AppDatabase): SweepStore {
  const client = database.$client;
  return {
    async readPage(afterId, limit) {
      return client.prepare(PAGE_SQL).all(afterId, limit) as OpenBid[];
    },
    async closePage(expired, nowMs, nowIso) {
      // IMMEDIATE takes the write lock first, so the payloads read below cannot change before they are replaced.
      const closeAll = client.transaction((): OpenBid[] => {
        const ids = expired.map((bid) => bid.id);
        const closeWithPayload = client.prepare(closeSql(true));
        const closeWithoutPayload = client.prepare(closeSql(false));
        const closed: OpenBid[] = [];
        for (const bid of client.prepare(lockedReadSql(ids.length, "")).all(...ids) as LockedBid[]) {
          const closure = closureOf(bid, nowMs, nowIso);
          if (!closure) continue;
          const written = closure.rawPayload === null
            ? closeWithoutPayload.run(nowIso, bid.id)
            : closeWithPayload.run(closure.rawPayload, nowIso, bid.id);
          if (written.changes === 1) closed.push(bid);
        }
        return closed;
      });
      return closeAll.immediate();
    },
  };
}

function mysqlSweepStore(mysql: MysqlSweepStore): SweepStore {
  return {
    readPage: (afterId, limit) => mysqlSelectMany<OpenBid>(mysql, PAGE_SQL, [afterId, limit]),
    closePage: (expired, nowMs, nowIso) =>
      // SKIP LOCKED: a bid another transaction holds (an import in flight) is left for a later pass instead of waited for,
      // so the sweep never blocks an import or deadlocks with one; that import applies the deadline rule to the bid itself.
      mysqlTransaction(mysql, async (connection) => {
        const ids = expired.map((bid) => bid.id);
        const closed: OpenBid[] = [];
        for (const bid of await mysqlSelectMany<LockedBid>(connection, lockedReadSql(ids.length, " FOR UPDATE SKIP LOCKED"), ids)) {
          const closure = closureOf(bid, nowMs, nowIso);
          if (!closure) continue;
          const written = closure.rawPayload === null
            ? await mysqlExecute(connection, closeSql(false), [nowIso, bid.id])
            : await mysqlExecute(connection, closeSql(true), [closure.rawPayload, nowIso, bid.id]);
          if (written.affectedRows === 1) closed.push(bid);
        }
        return closed;
      }),
  };
}

function pageSize(batchSize: number | undefined): number {
  return batchSize !== undefined && Number.isInteger(batchSize) && batchSize >= 1
    ? Math.min(batchSize, MAX_SWEEP_BATCH_SIZE)
    : DEFAULT_SWEEP_BATCH_SIZE;
}

/**
 * Closes every open bid whose deadline has passed at `options.now`. The import closes a bid at the moment it
 * sees one past its deadline (`mergeLifecycleFields`), but a bid its portal stops listing, or whose source is
 * not crawled for weeks, would stay open until then; this is the same rule applied to what is already stored.
 *
 * Open bids are read a page at a time in id order, without their payloads. A page's expired bids are then
 * re-read under the write lock and judged once more, so a bid an import has just refreshed is never closed on
 * a stale deadline and no payload is overwritten with an older copy; each is closed (`lifecycle_status`,
 * `is_active`, `updated_at`) with the reason recorded in `raw_payload.lifecycle`, all of a page in one
 * transaction. On MySQL the re-read is `FOR UPDATE SKIP LOCKED`: a bid an import holds is skipped, not waited
 * for, and is closed on a later pass if it is still past its deadline (the import applies the same rule to it
 * itself). A deadline that cannot be read never closes a bid. Only open bids are touched, so a second run
 * finds nothing left to close.
 */
export async function sweepExpiredBids(target: LifecycleSweepTarget, options: LifecycleSweepOptions): Promise<LifecycleSweepResult> {
  const store = "mysql" in target ? mysqlSweepStore(target.mysql) : sqliteSweepStore(target.database);
  const nowMs = options.now.getTime();
  const nowIso = options.now.toISOString();
  const dryRun = options.dryRun === true;
  const limit = pageSize(options.batchSize);
  const result: LifecycleSweepResult = { scanned: 0, closed: 0, unparseable: 0, closedByIssuerType: {}, dryRun };

  let afterId = "";
  for (;;) {
    const page = await store.readPage(afterId, limit);
    result.scanned += page.length;
    const expired: OpenBid[] = [];
    for (const bid of page) {
      const expiresAt = bidDeadlineExpiresAtMs(bid.deadline_date);
      if (expiresAt === null) {
        if (String(bid.deadline_date ?? "").trim() !== "") result.unparseable += 1;
      } else if (nowMs >= expiresAt) {
        expired.push(bid);
      }
    }
    const closed = dryRun || expired.length === 0 ? expired : await store.closePage(expired, nowMs, nowIso);
    for (const bid of closed) {
      result.closed += 1;
      result.closedByIssuerType[bid.issuer_type] = (result.closedByIssuerType[bid.issuer_type] ?? 0) + 1;
    }
    // A short page is the last one; a full page may be followed by more.
    if (page.length < limit) return result;
    afterId = page[page.length - 1].id;
  }
}
