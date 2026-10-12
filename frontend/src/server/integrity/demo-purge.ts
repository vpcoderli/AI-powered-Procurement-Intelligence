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
 * drift from migrate.ts, or when its order is not children-first). MySQL has no foreign keys (mysql.ts strips every
 * REFERENCES) and SQLite cascades only with `foreign_keys=ON`, so both dialects delete explicitly, in the same
 * order, and then verify that nothing was left dangling:
 *   - SQLite runs `PRAGMA foreign_key_check` before COMMIT;
 *   - MySQL runs one orphan-count query per relationship (DEMO_PURGE_RELATIONSHIPS) before COMMIT.
 * Either check rolls the whole purge back when it finds a reference the purge itself left behind. References that
 * were already dangling before the purge (a legacy orphan row unrelated to it) are counted first and do not block it.
 *
 * A row is deleted when ANY of its references points at a deleted row, which is what ON DELETE CASCADE does; so a
 * row that names a demo workspace item but belongs to another intent goes too. The ON DELETE SET NULL references
 * into the graph are detached the same way in both dialects (DEMO_PURGE_DETACHMENTS): `knowledge_items.source_bid_id`
 * and `.source_intent_id`, and `award_outcomes.tabulation_artifact_id`. Knowledge items are kept, never deleted.
 * The detachments run first, while the intents they are resolved through still exist.
 *
 * LEFT UNTOUCHED, as history, because nothing keys them to a bid: `notification_outbox.matched_bid_ids`,
 * `search_alert_digest_runs.matched_bid_ids_json`, `event_log.target_id` / `metadata_json`,
 * `ai_call_logs.metadata_json` and `crawler_logs.metadata`. Files that deleted rows point at through `storage_path`
 * (artifact vault, response-package exports, archived attachments) are not removed either.
 *
 * Run it while the workers are stopped. MySQL has no foreign keys to stop a writer from adding a row for a demo bid
 * between the plan and the commit.
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
}

export interface DemoPurgeResult extends DemoPurgePlan {
  /** True only when a transaction committed. A dry run, or an apply that found no demo bid, is false. */
  applied: boolean;
  /** Rows actually deleted, per dependent table and `bids`; all zero when nothing was applied. */
  deleted: Record<string, number>;
}

/** What `resolveMysqlPool()` returns, narrowed to what the purge uses: reads (`query`) and a transaction. */
export type DemoPurgeMysql = Parameters<typeof mysqlSelectMany>[0] & Parameters<typeof mysqlTransaction>[0];
export type DemoPurgeTarget = { database: AppDatabase } | { mysql: DemoPurgeMysql };

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

/** Every foreign-key relationship of the purge, for the orphan check that stands in for MySQL's missing foreign keys. */
export const DEMO_PURGE_RELATIONSHIPS: readonly DemoPurgeRelationship[] = [
  ...DEMO_PURGE_TABLES.flatMap((entry) => entry.references.map((reference) => ({ child: entry.table, ...reference }))),
  ...DEMO_PURGE_DETACHMENTS.map((entry) => ({ child: entry.table, column: entry.column, parent: entry.parent })),
].map((relationship) => ({ ...relationship, label: `${relationship.child}.${relationship.column} -> ${relationship.parent}` }));

/** Rows of `child` whose `column` names a `parent` row that does not exist. */
export function orphanCountSql(relationship: DemoPurgeRelationship): string {
  const { child, column, parent } = relationship;
  return (
    `SELECT COUNT(*) AS n FROM \`${child}\` c LEFT JOIN \`${parent}\` p ON p.id = c.\`${column}\` ` +
    `WHERE c.\`${column}\` IS NOT NULL AND p.id IS NULL`
  );
}

/* -------------------------------------------------------------------------------------------------------------- */
/* Statements (dialect-neutral SQL; both runners bind the same parameters)                                         */
/* -------------------------------------------------------------------------------------------------------------- */

interface Sql {
  sql: string;
  params: string[];
}

interface PurgeStatement extends Sql {
  table: string;
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

function countStatements(bidIds: readonly string[]): PurgeStatement[] {
  return DEMO_PURGE_TABLES.map((entry) => {
    const condition = referencesRemoved(entry.references, bidIds);
    return { table: entry.table, sql: `SELECT COUNT(*) AS n FROM ${entry.table} WHERE ${condition.sql}`, params: condition.params };
  });
}

function knowledgeItemsCountStatement(bidIds: readonly string[]): PurgeStatement {
  const references = DEMO_PURGE_DETACHMENTS.filter((entry) => entry.table === "knowledge_items");
  const condition = referencesRemoved(references, bidIds);
  return { table: "knowledge_items", sql: `SELECT COUNT(*) AS n FROM knowledge_items WHERE ${condition.sql}`, params: condition.params };
}

function detachStatements(bidIds: readonly string[]): PurgeStatement[] {
  return DEMO_PURGE_DETACHMENTS.map((entry) => {
    const condition = referencesRemoved([entry], bidIds);
    return { table: entry.table, sql: `UPDATE ${entry.table} SET ${entry.column} = NULL WHERE ${condition.sql}`, params: condition.params };
  });
}

/** The dependents children first, then `bids`. */
function deleteStatements(bidIds: readonly string[]): PurgeStatement[] {
  return [
    ...DEMO_PURGE_TABLES.map((entry) => {
      const condition = referencesRemoved(entry.references, bidIds);
      return { table: entry.table, sql: `DELETE FROM ${entry.table} WHERE ${condition.sql}`, params: condition.params };
    }),
    { table: "bids", sql: `DELETE FROM bids WHERE id IN (${bidIds.map(() => "?").join(", ")})`, params: [...bidIds] },
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
const emptyPlan = (): DemoPurgePlan => ({ bids: [], dependents: zeroDependents(), knowledgeItemsToDetach: 0 });
const notApplied = (plan: DemoPurgePlan): DemoPurgeResult => ({ ...plan, applied: false, deleted: { ...zeroDependents(), bids: 0 } });
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
    dependents[statement.table] = countOf(sqlite.prepare(statement.sql).get(...statement.params));
  }
  const knowledge = knowledgeItemsCountStatement(ids);
  return { bids, dependents, knowledgeItemsToDetach: countOf(sqlite.prepare(knowledge.sql).get(...knowledge.params)) };
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
    dependents[statement.table] = countOf(await mysqlSelectOne(reader, statement.sql, statement.params));
  }
  const knowledge = knowledgeItemsCountStatement(ids);
  return { bids, dependents, knowledgeItemsToDetach: countOf(await mysqlSelectOne(reader, knowledge.sql, knowledge.params)) };
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
    for (const statement of detachStatements(ids)) sqlite.prepare(statement.sql).run(...statement.params);
    const deleted: Record<string, number> = { ...zeroDependents(), bids: 0 };
    for (const statement of deleteStatements(ids)) {
      deleted[statement.table] = sqlite.prepare(statement.sql).run(...statement.params).changes;
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
    return { ...plan, applied: true, deleted };
  });
  return purge.immediate();
}

async function orphanCounts(reader: MysqlReader): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const relationship of DEMO_PURGE_RELATIONSHIPS) {
    counts.set(relationship.label, countOf(await mysqlSelectOne(reader, orphanCountSql(relationship))));
  }
  return counts;
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
    const orphansBefore = await orphanCounts(connection);
    for (const statement of detachStatements(ids)) await mysqlExecute(connection, statement.sql, statement.params);
    const deleted: Record<string, number> = { ...zeroDependents(), bids: 0 };
    for (const statement of deleteStatements(ids)) {
      deleted[statement.table] = (await mysqlExecute(connection, statement.sql, statement.params)).affectedRows;
    }

    // No foreign keys here: count, for every relationship, the rows whose parent no longer exists. Rows that were
    // already orphans before the purge are not its doing. A throw rolls the transaction back (mysqlTransaction).
    const orphansAfter = await orphanCounts(connection);
    const introduced = DEMO_PURGE_RELATIONSHIPS
      .filter((relationship) => (orphansAfter.get(relationship.label) ?? 0) > (orphansBefore.get(relationship.label) ?? 0))
      .map((relationship) => `${relationship.label} (${orphansAfter.get(relationship.label)} orphans, was ${orphansBefore.get(relationship.label)})`);
    if (introduced.length > 0) throw integrityFailure("MySQL", introduced);
    return { ...plan, applied: true, deleted };
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
 * Dry run unless `apply`: then one transaction detaches the knowledge-item links, deletes the dependents children
 * first and the bids last, verifies that nothing dangles and commits, or rolls back and throws a DemoPurgeError.
 * A second apply finds no demo bid and writes nothing.
 */
export async function purgeDemoBids(target: DemoPurgeTarget, options: { apply: boolean }): Promise<DemoPurgeResult> {
  if (!options.apply) return notApplied(await planDemoPurge(target));
  return "mysql" in target ? applyWithMysql(target.mysql) : applyWithSqlite(target.database.$client);
}
