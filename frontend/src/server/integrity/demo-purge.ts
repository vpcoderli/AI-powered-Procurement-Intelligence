/**
 * Purge of the demo and seed bids, with every row that depends on them.
 *
 * WHICH BIDS. One rule, implemented once in `demoBidKind` / `isDemoBidRow` and used by both dialects (the SQL below
 * only pre-selects candidates; the predicate decides). A bid is demo data only when its id prefix (the text before
 * the first `:`, or the whole id) is NOT a `data_sources.id` AND one of these holds:
 *   - demo readiness: `id` ends with `_demo_readiness` and `source_bid_id` starts with `demo:`
 *     (`npm run demo:prepare`, scripts/demo-readiness.ts; raw_payload.demoReadiness = true);
 *   - mock seed: `id` is all digits and `source_bid_id` is `mock:<id>` (`db:seed`, MOCK_BIDS).
 *
 * WHICH DEPENDENTS. Every table whose REFERENCES chain in src/server/db/migrate.ts reaches `bids`
 * (DEMO_PURGE_TABLES, children first; demo-purge.test.ts fails when a table is missing from it, when its references
 * drift from migrate.ts, when its order is not children-first, or when a table the purge keeps gains a reference into
 * the graph that is not an ON DELETE SET NULL it detaches). MySQL has no foreign keys (mysql.ts strips every
 * REFERENCES) and SQLite cascades only with `foreign_keys=ON`, so both dialects delete explicitly, in the same
 * order, and then verify that nothing was left dangling:
 *   - SQLite runs `PRAGMA foreign_key_check` before COMMIT and compares it with one taken before the first write;
 *   - MySQL collects, before the first write, the ids the purge removes from every parent table, and before COMMIT asks,
 *     for every relationship of DEMO_PURGE_RELATIONSHIPS, whether any row of the child table still names one of them.
 * Either check rolls the whole purge back when it finds a reference the purge itself left behind. Both are exact: a row
 * that was already an orphan before the purge names a parent that never existed, so it cannot trip the check, and
 * nothing the purge does can hide behind it.
 *
 * A row is deleted when ANY of its references points at a deleted row, which is what ON DELETE CASCADE does; so a
 * row that names a demo workspace item but belongs to another intent goes too. The ON DELETE SET NULL references
 * into the graph are detached the same way in both dialects (DEMO_PURGE_DETACHMENTS): `knowledge_items.source_bid_id`
 * and `.source_intent_id`, and `award_outcomes.tabulation_artifact_id`. Knowledge items are kept, never deleted.
 * The detachments run first, while the intents they are resolved through still exist. A link is counted and nulled
 * only on a row that stays (the demo bids' own award outcomes name their own artifacts, but go anyway), and the plan
 * counts every one of them (`detachments`; the apply reports `detached`), so a dry run shows every write the apply makes.
 *
 * LEFT UNTOUCHED, as history, because nothing keys them to a bid: `notification_outbox.matched_bid_ids`,
 * `search_alert_digest_runs.matched_bid_ids_json`, `event_log.target_id` / `metadata_json`,
 * `ai_call_logs.metadata_json` and `crawler_logs.metadata`. Files that deleted rows point at through `storage_path`
 * (artifact vault, response-package exports, archived attachments) are not removed either.
 *
 * RUN IT IN A MAINTENANCE WINDOW. On MySQL, stop the web app AND every worker first. MySQL has no foreign keys, so
 * nothing stops the web app from inserting a child row for a demo bid (a save, an intent, a workspace edit) while the
 * transaction runs; a row committed by another session after the transaction took its snapshot is invisible to the
 * checks above and would be an orphan once the purge commits. SQLite needs no such window: `.immediate()` takes the
 * write lock for the whole purge, and the app's connections enforce foreign keys, so a child row for a deleted bid is
 * refused.
 */
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectMany, mysqlSelectOne, mysqlTransaction } from "@/server/db/mysql-runtime";

export interface DemoBid {
  id: string;
  sourceBidId: string;
  title: string | null;
  stateCode: string | null;
  lifecycleStatus: string | null;
  kind: "demo_readiness" | "mock_seed";
}

export interface DemoPurgePlan {
  bids: DemoBid[];
  /** Rows the purge deletes, per dependent table (every table of DEMO_PURGE_TABLES, zero included), `bids` excluded. */
  dependents: Record<string, number>;
  /** Knowledge items that lose a link to a demo bid or one of its intents; they are kept. */
  knowledgeItemsToDetach: number;
  /**
   * Links the purge sets to NULL on rows that stay, per `table.column` (every entry of DEMO_PURGE_DETACHMENTS, zero
   * included). With `dependents` and `bids` this is every write the apply makes.
   */
  detachments: Record<string, number>;
}

export interface DemoPurgeResult extends DemoPurgePlan {
  /** True only when a transaction committed. A dry run, or an apply that found no demo bid, is false. */
  applied: boolean;
  /** Rows actually deleted, per dependent table and `bids`; all zero when nothing was applied. */
  deleted: Record<string, number>;
  /** Links actually set to NULL, per `table.column`; all zero when nothing was applied. */
  detached: Record<string, number>;
}

/** What `resolveMysqlPool()` returns, narrowed to what the purge uses: reads (`query`) and a transaction. */
export type DemoPurgeMysql = Parameters<typeof mysqlSelectMany>[0] & Parameters<typeof mysqlTransaction>[0];
/**
 * The purge only runs raw SQL on the connection, so a SQLite handle is anything that carries the better-sqlite3
 * connection as `$client`: a Drizzle `AppDatabase`, or `{ $client }` from a script that opened the file itself.
 */
export type DemoPurgeSqlite = Pick<AppDatabase, "$client">;
export type DemoPurgeTarget = { database: DemoPurgeSqlite } | { mysql: DemoPurgeMysql };

export type DemoPurgeErrorCode = "TOO_MANY_DEMO_BIDS" | "INTEGRITY_CHECK_FAILED";

export class DemoPurgeError extends Error {
  constructor(
    readonly code: DemoPurgeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DemoPurgeError";
  }
}

/** The rule matches 56 rows in the local data (50 demo readiness, 6 mock). A match far past that means the data, or the rule, is wrong. */
export const DEMO_PURGE_MAX_BIDS = 500;

/* -------------------------------------------------------------------------------------------------------------- */
/* The rule                                                                                                       */
/* -------------------------------------------------------------------------------------------------------------- */

interface BidIdentity {
  id: string;
  source_bid_id?: string | null;
  sourceBidId?: string | null;
}

/** Which kind of demo data a bid is, or null when it is not demo data. Takes the row as SQL or Drizzle spells it. */
export function demoBidKind(row: BidIdentity, registeredSourceIds: ReadonlySet<string>): DemoBid["kind"] | null {
  const id = row.id;
  const sourceBidId = row.source_bid_id ?? row.sourceBidId;
  if (typeof id !== "string" || typeof sourceBidId !== "string") return null;

  const colon = id.indexOf(":");
  if (registeredSourceIds.has(colon === -1 ? id : id.slice(0, colon))) return null;

  if (id.endsWith("_demo_readiness") && sourceBidId.startsWith("demo:")) return "demo_readiness";
  if (/^[0-9]+$/.test(id) && sourceBidId === `mock:${id}`) return "mock_seed";
  return null;
}

export function isDemoBidRow(row: BidIdentity, registeredSourceIds: ReadonlySet<string>): boolean {
  return demoBidKind(row, registeredSourceIds) !== null;
}

/* -------------------------------------------------------------------------------------------------------------- */
/* The graph                                                                                                      */
/* -------------------------------------------------------------------------------------------------------------- */

export type DemoPurgeParent =
  | "bids"
  | "intent_to_bid"
  | "response_workspace_items"
  | "supplier_artifacts"
  | "quote_requests"
  | "response_package_snapshots"
  | "response_package_exports";

export interface DemoPurgeReference {
  column: string;
  parent: DemoPurgeParent;
}

export interface DemoPurgeTable {
  table: string;
  /** The references that delete a row of this table together with the row they point at (ON DELETE CASCADE). */
  references: readonly DemoPurgeReference[];
}

export interface DemoPurgeDetachment extends DemoPurgeReference {
  table: string;
}

const toBid: DemoPurgeReference = { column: "bid_id", parent: "bids" };
const toIntent: DemoPurgeReference = { column: "intent_id", parent: "intent_to_bid" };
const toItem: DemoPurgeReference = { column: "item_id", parent: "response_workspace_items" };
const toArtifact: DemoPurgeReference = { column: "artifact_id", parent: "supplier_artifacts" };
const toSnapshot: DemoPurgeReference = { column: "snapshot_id", parent: "response_package_snapshots" };

/**
 * Every table whose REFERENCES chain reaches `bids`, in the order it is purged: children before the tables they
 * reference, so no delete ever depends on a cascade. Derived from migrate.ts (REFERENCES ... ON DELETE CASCADE):
 *
 *  1. response_package_export_review_events  export_id -> response_package_exports, snapshot_id -> response_package_snapshots,
 *                                            intent_id -> intent_to_bid, bid_id -> bids
 *  2. response_package_exports               snapshot_id -> response_package_snapshots, intent_id -> intent_to_bid, bid_id -> bids
 *  3. response_package_snapshots             intent_id -> intent_to_bid, bid_id -> bids
 *  4. response_workspace_comments            intent_id -> intent_to_bid, item_id -> response_workspace_items
 *  5. response_workspace_activity            intent_id -> intent_to_bid, item_id -> response_workspace_items
 *  6. response_workspace_item_artifacts      item_id -> response_workspace_items, artifact_id -> supplier_artifacts
 *  7. quote_request_artifacts                quote_request_id -> quote_requests, artifact_id -> supplier_artifacts
 *  8. artifact_versions                      artifact_id -> supplier_artifacts, intent_id -> intent_to_bid, bid_id -> bids
 *  9. award_outcomes                         intent_id -> intent_to_bid, bid_id -> bids
 * 10. quote_requests                         intent_id -> intent_to_bid, bid_id -> bids
 * 11. supplier_artifacts                     intent_id -> intent_to_bid, bid_id -> bids
 * 12. response_workspace_items               intent_id -> intent_to_bid, bid_id -> bids
 * 13. submission_confirmations               intent_id -> intent_to_bid
 * 14. submission_paths                       intent_id -> intent_to_bid, bid_id -> bids
 * 15. compliance_manifest_items              intent_id -> intent_to_bid, bid_id -> bids
 * 16. pursuit_decisions                      intent_id -> intent_to_bid, bid_id -> bids
 * 17. deadline_reminders                     intent_id -> intent_to_bid, bid_id -> bids
 * 18. bid_attachments                        bid_id -> bids
 * 19. bid_field_corrections                  bid_id -> bids
 * 20. saved_bids                             bid_id -> bids
 * 21. intent_to_bid                          bid_id -> bids
 *     bids                                   (last, always)
 *
 * `knowledge_items` (ON DELETE SET NULL on source_bid_id and source_intent_id) is not here: see DEMO_PURGE_DETACHMENTS.
 */
export const DEMO_PURGE_TABLES: readonly DemoPurgeTable[] = [
  {
    table: "response_package_export_review_events",
    references: [{ column: "export_id", parent: "response_package_exports" }, toSnapshot, toIntent, toBid],
  },
  { table: "response_package_exports", references: [toSnapshot, toIntent, toBid] },
  { table: "response_package_snapshots", references: [toIntent, toBid] },
  { table: "response_workspace_comments", references: [toIntent, toItem] },
  { table: "response_workspace_activity", references: [toIntent, toItem] },
  { table: "response_workspace_item_artifacts", references: [toItem, toArtifact] },
  {
    table: "quote_request_artifacts",
    references: [{ column: "quote_request_id", parent: "quote_requests" }, toArtifact],
  },
  { table: "artifact_versions", references: [toArtifact, toIntent, toBid] },
  { table: "award_outcomes", references: [toIntent, toBid] },
  { table: "quote_requests", references: [toIntent, toBid] },
  { table: "supplier_artifacts", references: [toIntent, toBid] },
  { table: "response_workspace_items", references: [toIntent, toBid] },
  { table: "submission_confirmations", references: [toIntent] },
  { table: "submission_paths", references: [toIntent, toBid] },
  { table: "compliance_manifest_items", references: [toIntent, toBid] },
  { table: "pursuit_decisions", references: [toIntent, toBid] },
  { table: "deadline_reminders", references: [toIntent, toBid] },
  { table: "bid_attachments", references: [toBid] },
  { table: "bid_field_corrections", references: [toBid] },
  { table: "saved_bids", references: [toBid] },
  { table: "intent_to_bid", references: [toBid] },
];

/**
 * ON DELETE SET NULL references into the graph. A row that points at a purged row keeps existing; the link is nulled
 * (SQLite does this by itself with foreign keys on, MySQL never does).
 */
export const DEMO_PURGE_DETACHMENTS: readonly DemoPurgeDetachment[] = [
  { table: "knowledge_items", column: "source_bid_id", parent: "bids" },
  { table: "knowledge_items", column: "source_intent_id", parent: "intent_to_bid" },
  { table: "award_outcomes", column: "tabulation_artifact_id", parent: "supplier_artifacts" },
];

export interface DemoPurgeRelationship {
  child: string;
  column: string;
  parent: DemoPurgeParent;
  /** `child.column -> parent`, as an integrity failure reports it. */
  label: string;
}

/** Every foreign-key relationship of the purge, for the check that stands in for MySQL's missing foreign keys. */
export const DEMO_PURGE_RELATIONSHIPS: readonly DemoPurgeRelationship[] = [
  ...DEMO_PURGE_TABLES.flatMap((entry) => entry.references.map((reference) => ({ child: entry.table, ...reference }))),
  ...DEMO_PURGE_DETACHMENTS.map((entry) => ({ child: entry.table, column: entry.column, parent: entry.parent })),
].map((relationship) => ({ ...relationship, label: `${relationship.child}.${relationship.column} -> ${relationship.parent}` }));

/* -------------------------------------------------------------------------------------------------------------- */
/* Statements (dialect-neutral SQL; both runners bind the same parameters)                                         */
/* -------------------------------------------------------------------------------------------------------------- */

interface Sql {
  sql: string;
  params: string[];
}

interface PurgeStatement extends Sql {
  /** `table` for a count or a delete, `table.column` for a detachment. */
  key: string;
}

const tableByName = new Map(DEMO_PURGE_TABLES.map((entry) => [entry.table, entry]));

/** The ids of the `parent` rows the purge removes, as the inside of `IN (...)`. */
function removedIds(parent: DemoPurgeParent, bidIds: readonly string[]): Sql {
  if (parent === "bids") return { sql: bidIds.map(() => "?").join(", "), params: [...bidIds] };
  const entry = tableByName.get(parent);
  if (!entry) throw new Error(`demo purge: ${parent} is referenced but is not in DEMO_PURGE_TABLES`);
  const condition = referencesRemoved(entry.references, bidIds);
  return { sql: `SELECT id FROM ${parent} WHERE ${condition.sql}`, params: condition.params };
}

/** True for a row when any one of `references` points at a removed row. */
function referencesRemoved(references: readonly DemoPurgeReference[], bidIds: readonly string[]): Sql {
  const parts = references.map(({ column, parent }) => {
    const ids = removedIds(parent, bidIds);
    return { sql: `${column} IN (${ids.sql})`, params: ids.params };
  });
  return { sql: parts.map((part) => part.sql).join(" OR "), params: parts.flatMap((part) => part.params) };
}

const detachmentKey = (entry: DemoPurgeDetachment) => `${entry.table}.${entry.column}`;

/**
 * The rows whose link is set to NULL: those that name a purged row and stay. A row the purge deletes anyway (a demo
 * bid's own award outcome, which names its own artifact) keeps its link, so it is neither counted nor written.
 */
function detachCondition(entry: DemoPurgeDetachment, bidIds: readonly string[]): Sql {
  const link = referencesRemoved([entry], bidIds);
  const purged = tableByName.get(entry.table);
  if (!purged) return link;
  const deleted = referencesRemoved(purged.references, bidIds);
  return { sql: `${link.sql} AND NOT (${deleted.sql})`, params: [...link.params, ...deleted.params] };
}

function countStatements(bidIds: readonly string[]): PurgeStatement[] {
  return DEMO_PURGE_TABLES.map((entry) => {
    const condition = referencesRemoved(entry.references, bidIds);
    return { key: entry.table, sql: `SELECT COUNT(*) AS n FROM ${entry.table} WHERE ${condition.sql}`, params: condition.params };
  });
}

function detachCountStatements(bidIds: readonly string[]): PurgeStatement[] {
  return DEMO_PURGE_DETACHMENTS.map((entry) => {
    const condition = detachCondition(entry, bidIds);
    return { key: detachmentKey(entry), sql: `SELECT COUNT(*) AS n FROM ${entry.table} WHERE ${condition.sql}`, params: condition.params };
  });
}

/** Distinct knowledge items that lose a link in either column (a row that loses both counts once). */
function knowledgeItemsCountStatement(bidIds: readonly string[]): PurgeStatement {
  const references = DEMO_PURGE_DETACHMENTS.filter((entry) => entry.table === "knowledge_items");
  const condition = referencesRemoved(references, bidIds);
  return { key: "knowledge_items", sql: `SELECT COUNT(*) AS n FROM knowledge_items WHERE ${condition.sql}`, params: condition.params };
}

function detachStatements(bidIds: readonly string[]): PurgeStatement[] {
  return DEMO_PURGE_DETACHMENTS.map((entry) => {
    const condition = detachCondition(entry, bidIds);
    return { key: detachmentKey(entry), sql: `UPDATE ${entry.table} SET ${entry.column} = NULL WHERE ${condition.sql}`, params: condition.params };
  });
}

/** The dependents children first, then `bids`. */
function deleteStatements(bidIds: readonly string[]): PurgeStatement[] {
  return [
    ...DEMO_PURGE_TABLES.map((entry) => {
      const condition = referencesRemoved(entry.references, bidIds);
      return { key: entry.table, sql: `DELETE FROM ${entry.table} WHERE ${condition.sql}`, params: condition.params };
    }),
    { key: "bids", sql: `DELETE FROM bids WHERE id IN (${bidIds.map(() => "?").join(", ")})`, params: [...bidIds] },
  ];
}

/* -------------------------------------------------------------------------------------------------------------- */
/* Finding and planning                                                                                           */
/* -------------------------------------------------------------------------------------------------------------- */

interface CandidateRow {
  id: string;
  source_bid_id: string | null;
  title: string | null;
  state_code: string | null;
  lifecycle_status: string | null;
}

const REGISTERED_SOURCES_SQL = "SELECT id FROM data_sources";
// A superset of the rule (both kinds carry one of these source_bid_id prefixes, and LIKE is case-insensitive in both
// dialects); `demoBidKind` makes the decision.
const CANDIDATES_SQL =
  "SELECT id, source_bid_id, title, state_code, lifecycle_status FROM bids " +
  "WHERE source_bid_id LIKE 'demo:%' OR source_bid_id LIKE 'mock:%'";

function demoBidsAmong(candidates: readonly CandidateRow[], registered: ReadonlySet<string>): DemoBid[] {
  const bids: DemoBid[] = [];
  for (const row of candidates) {
    const kind = demoBidKind(row, registered);
    if (kind && row.source_bid_id !== null) {
      bids.push({
        id: row.id,
        sourceBidId: row.source_bid_id,
        title: row.title,
        stateCode: row.state_code,
        lifecycleStatus: row.lifecycle_status,
        kind,
      });
    }
  }
  return bids.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

function assertWithinLimit(bids: readonly DemoBid[]) {
  if (bids.length > DEMO_PURGE_MAX_BIDS) {
    throw new DemoPurgeError(
      "TOO_MANY_DEMO_BIDS",
      `The demo rule matched ${bids.length} bids; the purge refuses more than ${DEMO_PURGE_MAX_BIDS}. ` +
        "That is far more than the demo and seed data ever holds, so check the data before purging.",
    );
  }
}

const zeroDependents = (): Record<string, number> => Object.fromEntries(DEMO_PURGE_TABLES.map((entry) => [entry.table, 0]));
const zeroDetachments = (): Record<string, number> => Object.fromEntries(DEMO_PURGE_DETACHMENTS.map((entry) => [detachmentKey(entry), 0]));
const emptyPlan = (): DemoPurgePlan => ({ bids: [], dependents: zeroDependents(), knowledgeItemsToDetach: 0, detachments: zeroDetachments() });
const notApplied = (plan: DemoPurgePlan): DemoPurgeResult => ({
  ...plan,
  applied: false,
  deleted: { ...zeroDependents(), bids: 0 },
  detached: zeroDetachments(),
});
const countOf = (row: unknown): number => Number((row as { n?: number | string } | null | undefined)?.n ?? 0);

type Sqlite = AppDatabase["$client"];

function sqliteAll<T>(sqlite: Sqlite, sql: string): T[] {
  return sqlite.prepare(sql).all() as T[];
}

function findWithSqlite(sqlite: Sqlite): DemoBid[] {
  const registered = new Set(sqliteAll<{ id: string }>(sqlite, REGISTERED_SOURCES_SQL).map((row) => row.id));
  return demoBidsAmong(sqliteAll<CandidateRow>(sqlite, CANDIDATES_SQL), registered);
}

function planWithSqlite(sqlite: Sqlite): DemoPurgePlan {
  const bids = findWithSqlite(sqlite);
  assertWithinLimit(bids);
  if (bids.length === 0) return emptyPlan();

  const ids = bids.map((bid) => bid.id);
  const dependents = zeroDependents();
  for (const statement of countStatements(ids)) {
    dependents[statement.key] = countOf(sqlite.prepare(statement.sql).get(...statement.params));
  }
  const detachments = zeroDetachments();
  for (const statement of detachCountStatements(ids)) {
    detachments[statement.key] = countOf(sqlite.prepare(statement.sql).get(...statement.params));
  }
  const knowledge = knowledgeItemsCountStatement(ids);
  return { bids, dependents, knowledgeItemsToDetach: countOf(sqlite.prepare(knowledge.sql).get(...knowledge.params)), detachments };
}

type MysqlReader = Parameters<typeof mysqlSelectMany>[0];

async function findWithMysql(reader: MysqlReader): Promise<DemoBid[]> {
  const registered = new Set((await mysqlSelectMany<{ id: string }>(reader, REGISTERED_SOURCES_SQL)).map((row) => row.id));
  return demoBidsAmong(await mysqlSelectMany<CandidateRow>(reader, CANDIDATES_SQL), registered);
}

async function planWithMysql(reader: MysqlReader): Promise<DemoPurgePlan> {
  const bids = await findWithMysql(reader);
  assertWithinLimit(bids);
  if (bids.length === 0) return emptyPlan();

  const ids = bids.map((bid) => bid.id);
  const dependents = zeroDependents();
  for (const statement of countStatements(ids)) {
    dependents[statement.key] = countOf(await mysqlSelectOne(reader, statement.sql, statement.params));
  }
  const detachments = zeroDetachments();
  for (const statement of detachCountStatements(ids)) {
    detachments[statement.key] = countOf(await mysqlSelectOne(reader, statement.sql, statement.params));
  }
  const knowledge = knowledgeItemsCountStatement(ids);
  return { bids, dependents, knowledgeItemsToDetach: countOf(await mysqlSelectOne(reader, knowledge.sql, knowledge.params)), detachments };
}

/* -------------------------------------------------------------------------------------------------------------- */
/* Applying                                                                                                       */
/* -------------------------------------------------------------------------------------------------------------- */

interface ForeignKeyViolation {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
}

function foreignKeyViolations(sqlite: Sqlite): ForeignKeyViolation[] {
  return sqlite.pragma("foreign_key_check") as ForeignKeyViolation[];
}

const violationKey = (violation: ForeignKeyViolation) => `${violation.table}|${violation.rowid}|${violation.parent}|${violation.fkid}`;

function integrityFailure(dialect: "SQLite" | "MySQL", problems: readonly string[]): DemoPurgeError {
  return new DemoPurgeError(
    "INTEGRITY_CHECK_FAILED",
    `The ${dialect} integrity check found references the purge would leave dangling, so nothing was changed: ${problems.join("; ")}`,
  );
}

function applyWithSqlite(sqlite: Sqlite): DemoPurgeResult {
  // Looked at before any lock is taken: with nothing to purge, nothing is written and no write lock is held.
  const preview = planWithSqlite(sqlite);
  if (preview.bids.length === 0) return notApplied(preview);

  const purge = sqlite.transaction((): DemoPurgeResult => {
    const plan = planWithSqlite(sqlite);
    if (plan.bids.length === 0) return notApplied(plan);

    const ids = plan.bids.map((bid) => bid.id);
    const existing = new Set(foreignKeyViolations(sqlite).map(violationKey));
    const detached = zeroDetachments();
    for (const statement of detachStatements(ids)) {
      detached[statement.key] = sqlite.prepare(statement.sql).run(...statement.params).changes;
    }
    const deleted: Record<string, number> = { ...zeroDependents(), bids: 0 };
    for (const statement of deleteStatements(ids)) {
      deleted[statement.key] = sqlite.prepare(statement.sql).run(...statement.params).changes;
    }

    // Foreign keys are on, so a delete that would orphan a row has already failed. This catches what deferred or
    // disabled enforcement lets through, and a table the list does not know.
    const introduced = foreignKeyViolations(sqlite).filter((violation) => !existing.has(violationKey(violation)));
    if (introduced.length > 0) {
      const perRelationship = new Map<string, number>();
      for (const violation of introduced) {
        const label = `${violation.table} -> ${violation.parent}`;
        perRelationship.set(label, (perRelationship.get(label) ?? 0) + 1);
      }
      throw integrityFailure("SQLite", [...perRelationship].map(([label, count]) => `${label} (${count})`));
    }
    return { ...plan, applied: true, deleted, detached };
  });
  return purge.immediate();
}

/** The parent tables, other than `bids`, that some relationship of the purge points at. */
const PARENT_TABLES: readonly DemoPurgeParent[] = [...new Set(DEMO_PURGE_RELATIONSHIPS.map((relationship) => relationship.parent))]
  .filter((parent) => parent !== "bids");

/** The ids the purge removes from every parent table, read before the first write while those rows still exist. */
async function collectRemovedIds(reader: MysqlReader, bidIds: readonly string[]): Promise<Record<DemoPurgeParent, string[]>> {
  const removed = { bids: [...bidIds] } as Record<DemoPurgeParent, string[]>;
  for (const parent of PARENT_TABLES) {
    const query = removedIds(parent, bidIds);
    removed[parent] = (await mysqlSelectMany<{ id: string }>(reader, query.sql, query.params)).map((row) => row.id);
  }
  return removed;
}

/** Ids per statement of the check: far below any parameter limit, and a purge of the most bids it accepts fits in one. */
const CHECK_CHUNK_SIZE = 500;

/**
 * For every relationship, how many rows of the child table still name an id the purge removed from its parent.
 * Rows that never had a parent are not looked at: they name ids that were never removed.
 */
async function danglingReferences(reader: MysqlReader, removed: Record<DemoPurgeParent, string[]>): Promise<string[]> {
  const problems: string[] = [];
  for (const { child, column, parent, label } of DEMO_PURGE_RELATIONSHIPS) {
    let rows = 0;
    for (let start = 0; start < removed[parent].length; start += CHECK_CHUNK_SIZE) {
      const ids = removed[parent].slice(start, start + CHECK_CHUNK_SIZE);
      const sql = `SELECT COUNT(*) AS n FROM \`${child}\` WHERE \`${column}\` IN (${ids.map(() => "?").join(", ")})`;
      rows += countOf(await mysqlSelectOne(reader, sql, ids));
    }
    if (rows > 0) problems.push(`${label} (${rows} rows still reference purged rows)`);
  }
  return problems;
}

async function applyWithMysql(pool: DemoPurgeMysql): Promise<DemoPurgeResult> {
  // Looked at before a transaction is opened: with nothing to purge, nothing is written.
  const preview = await planWithMysql(pool);
  if (preview.bids.length === 0) return notApplied(preview);

  // Everything below goes through `connection`, never `pool`: a pool of one connection would wait on itself.
  return mysqlTransaction(pool, async (connection) => {
    const plan = await planWithMysql(connection);
    if (plan.bids.length === 0) return notApplied(plan);

    const ids = plan.bids.map((bid) => bid.id);
    const removed = await collectRemovedIds(connection, ids);
    const detached = zeroDetachments();
    for (const statement of detachStatements(ids)) {
      detached[statement.key] = (await mysqlExecute(connection, statement.sql, statement.params)).affectedRows;
    }
    const deleted: Record<string, number> = { ...zeroDependents(), bids: 0 };
    for (const statement of deleteStatements(ids)) {
      deleted[statement.key] = (await mysqlExecute(connection, statement.sql, statement.params)).affectedRows;
    }

    // No foreign keys here: ask, for every relationship, whether a row still names an id that was just removed. A throw
    // rolls the transaction back (mysqlTransaction).
    const dangling = await danglingReferences(connection, removed);
    if (dangling.length > 0) throw integrityFailure("MySQL", dangling);
    return { ...plan, applied: true, deleted, detached };
  });
}

/* -------------------------------------------------------------------------------------------------------------- */
/* Public API                                                                                                     */
/* -------------------------------------------------------------------------------------------------------------- */

/** The demo and seed bids in the database, by id. No limit is applied; the plan applies one. */
export async function findDemoBids(target: DemoPurgeTarget): Promise<DemoBid[]> {
  return "mysql" in target ? findWithMysql(target.mysql) : findWithSqlite(target.database.$client);
}

/** What a purge would delete, counted with exactly the conditions the deletes use. Writes nothing. */
export async function planDemoPurge(target: DemoPurgeTarget): Promise<DemoPurgePlan> {
  return "mysql" in target ? planWithMysql(target.mysql) : planWithSqlite(target.database.$client);
}

/**
 * Dry run unless `apply`: then one transaction detaches the links that must go (knowledge items, award outcomes),
 * deletes the dependents children first and the bids last, verifies that nothing dangles and commits, or rolls back
 * and throws a DemoPurgeError. A second apply finds no demo bid and writes nothing.
 */
export async function purgeDemoBids(target: DemoPurgeTarget, options: { apply: boolean }): Promise<DemoPurgeResult> {
  if (!options.apply) return notApplied(await planDemoPurge(target));
  return "mysql" in target ? applyWithMysql(target.mysql) : applyWithSqlite(target.database.$client);
}
