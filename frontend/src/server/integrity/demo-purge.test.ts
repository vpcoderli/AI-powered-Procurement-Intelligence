import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  DEMO_PURGE_DETACHMENTS,
  DEMO_PURGE_MAX_BIDS,
  DEMO_PURGE_RELATIONSHIPS,
  DEMO_PURGE_TABLES,
  DemoPurgeError,
  demoBidKind,
  findDemoBids,
  isDemoBidRow,
  planDemoPurge,
  purgeDemoBids,
  type DemoPurgeMysql,
  type DemoPurgeParent,
} from "./demo-purge";
import {
  EXPECTED_DEMO_DEPENDENTS,
  EXPECTED_DEMO_DETACHMENTS,
  EXPECTED_KNOWLEDGE_ITEMS_TO_DETACH,
  REAL_BID_ID,
  SEED_AT,
  SURVIVOR_BID_IDS,
  buildDemoPurgeSeed,
  expectedDemoDependents,
  expectedDemoDetachments,
  expectedPresence,
  insertStatement,
  isDemoOwned,
  seedKeyColumns,
  seedTag,
  type SeedRow,
} from "./demo-purge.fixtures";

type Sqlite = TestDatabase["db"]["$client"];

const DEMO_READINESS = { id: "al_state_procurement_demo_readiness", source_bid_id: "demo:al_state_procurement" };
const MOCK = { id: "1", source_bid_id: "mock:1" };
const NO_SOURCES: ReadonlySet<string> = new Set();

describe("isDemoBidRow", () => {
  it("accepts a demo-readiness row and a mock seed row, and says which", () => {
    expect(isDemoBidRow(DEMO_READINESS, NO_SOURCES)).toBe(true);
    expect(demoBidKind(DEMO_READINESS, NO_SOURCES)).toBe("demo_readiness");
    expect(isDemoBidRow(MOCK, NO_SOURCES)).toBe(true);
    expect(demoBidKind(MOCK, NO_SOURCES)).toBe("mock_seed");
  });

  it("reads source_bid_id under either spelling and never treats a missing one as a marker", () => {
    expect(isDemoBidRow({ id: MOCK.id, sourceBidId: MOCK.source_bid_id }, NO_SOURCES)).toBe(true);
    expect(isDemoBidRow({ id: MOCK.id, source_bid_id: null }, NO_SOURCES)).toBe(false);
    expect(isDemoBidRow({ id: MOCK.id }, NO_SOURCES)).toBe(false);
    expect(isDemoBidRow({ id: DEMO_READINESS.id, sourceBidId: null }, NO_SOURCES)).toBe(false);
  });

  it("needs both halves of the demo-readiness rule", () => {
    expect(isDemoBidRow({ id: DEMO_READINESS.id, source_bid_id: "al_state_procurement" }, NO_SOURCES)).toBe(false);
    expect(isDemoBidRow({ id: "al_state_procurement", source_bid_id: DEMO_READINESS.source_bid_id }, NO_SOURCES)).toBe(false);
    expect(isDemoBidRow({ id: DEMO_READINESS.id, source_bid_id: "Demo:al_state_procurement" }, NO_SOURCES)).toBe(false);
    expect(isDemoBidRow({ id: "x_DEMO_READINESS", source_bid_id: "demo:x" }, NO_SOURCES)).toBe(false);
  });

  it("needs both halves of the mock rule: an all-digit id and a source_bid_id of exactly mock:<id>", () => {
    expect(isDemoBidRow({ id: "1", source_bid_id: "mock:2" }, NO_SOURCES)).toBe(false);
    expect(isDemoBidRow({ id: "1", source_bid_id: "1" }, NO_SOURCES)).toBe(false);
    expect(isDemoBidRow({ id: "1", source_bid_id: "mock:1 " }, NO_SOURCES)).toBe(false);
    expect(isDemoBidRow({ id: "a1", source_bid_id: "mock:a1" }, NO_SOURCES)).toBe(false);
    expect(isDemoBidRow({ id: "", source_bid_id: "mock:" }, NO_SOURCES)).toBe(false);
    expect(isDemoBidRow({ id: "12", source_bid_id: "mock:12" }, NO_SOURCES)).toBe(true);
  });

  it("never claims a bid whose id prefix is a registered data source, the prefix being the text before the first colon", () => {
    expect(isDemoBidRow(MOCK, new Set(["1"]))).toBe(false);
    expect(isDemoBidRow(DEMO_READINESS, new Set([DEMO_READINESS.id]))).toBe(false);
    // The demo source itself is registered; the demo bid's id is a different string.
    expect(isDemoBidRow(DEMO_READINESS, new Set(["al_state_procurement"]))).toBe(true);
    const colon = { id: "portal:7_demo_readiness", source_bid_id: "demo:portal" };
    expect(isDemoBidRow(colon, NO_SOURCES)).toBe(true);
    expect(isDemoBidRow(colon, new Set(["portal"]))).toBe(false);
    expect(isDemoBidRow(colon, new Set(["portal:7_demo_readiness"]))).toBe(true);
  });
});

function seedSqlite(testDb: TestDatabase, rows: SeedRow[] = buildDemoPurgeSeed()) {
  for (const row of rows) {
    const { sql, params } = insertStatement(row);
    testDb.db.$client.prepare(sql).run(...params);
  }
}

function presentKeys(sqlite: Sqlite, table: string): Set<string> {
  const columns = seedKeyColumns(table);
  const rows = sqlite.prepare(`SELECT ${columns.join(", ")} FROM ${table}`).all() as Record<string, unknown>[];
  return new Set(rows.map((row) => columns.map((column) => String(row[column])).join("|")));
}

function totalChanges(sqlite: Sqlite): number {
  return (sqlite.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
}

function rowCounts(sqlite: Sqlite, tables: readonly string[]): Record<string, number> {
  return Object.fromEntries(tables.map((table) => [
    table,
    (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n,
  ]));
}

/** Every seeded row is present, except the dependents (and bids) of the demo bids. Knowledge items always stay. */
function expectSeedState(sqlite: Sqlite, rows: readonly SeedRow[], { purged }: { purged: boolean }) {
  const present = new Map<string, Set<string>>();
  for (const table of new Set(rows.map((row) => row.table))) present.set(table, presentKeys(sqlite, table));
  for (const { table, key, present: shouldBePresent } of expectedPresence(rows, { purged })) {
    expect({ table, key, present: present.get(table)!.has(key) }).toEqual({ table, key, present: shouldBePresent });
  }
}

function knowledgeLinks(sqlite: Sqlite): Record<string, { bid: string | null; intent: string | null }> {
  const rows = sqlite.prepare("SELECT id, source_bid_id, source_intent_id FROM knowledge_items").all() as Array<{
    id: string; source_bid_id: string | null; source_intent_id: string | null;
  }>;
  return Object.fromEntries(rows.map((row) => [row.id, { bid: row.source_bid_id, intent: row.source_intent_id }]));
}

const DEPENDENT_TABLES = DEMO_PURGE_TABLES.map((entry) => entry.table);

describe("demo and seed bid purge on SQLite", () => {
  let testDb: TestDatabase;
  let sqlite: Sqlite;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    sqlite = testDb.db.$client;
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("finds exactly the demo-readiness and mock bids, and leaves the registered, unregistered and look-alike bids", async () => {
    seedSqlite(testDb);

    const found = await findDemoBids({ database: testDb.db });

    expect(found).toEqual([
      { id: "1", sourceBidId: "mock:1", title: "Bid 1", stateCode: "CA", lifecycleStatus: "open", kind: "mock_seed" },
      { id: "2", sourceBidId: "mock:2", title: "Bid 2", stateCode: "TX", lifecycleStatus: "open", kind: "mock_seed" },
      {
        id: "al_state_procurement_demo_readiness", sourceBidId: "demo:al_state_procurement",
        title: "Bid al_state_procurement_demo_readiness", stateCode: "AL", lifecycleStatus: "open", kind: "demo_readiness",
      },
      {
        id: "wa_state_procurement_demo_readiness", sourceBidId: "demo:wa_state_procurement",
        title: "Bid wa_state_procurement_demo_readiness", stateCode: "WA", lifecycleStatus: "open", kind: "demo_readiness",
      },
    ]);
  });

  it("does not claim a mock-shaped bid whose id prefix is a registered data source", async () => {
    seedSqlite(testDb);
    sqlite.prepare(
      "INSERT INTO data_sources (id, label, issuer_type, state_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("2", "A source that happens to be called 2", "state", "TX", SEED_AT, SEED_AT);

    const found = await findDemoBids({ database: testDb.db });

    expect(found.map((bid) => bid.id)).toEqual(["1", "al_state_procurement_demo_readiness", "wa_state_procurement_demo_readiness"]);
  });

  it("plans exact per-table counts without writing anything", async () => {
    seedSqlite(testDb);
    const before = totalChanges(sqlite);
    const tableCounts = rowCounts(sqlite, [...DEPENDENT_TABLES, "bids", "knowledge_items"]);

    const plan = await planDemoPurge({ database: testDb.db });

    expect(plan.bids.map((bid) => bid.id)).toEqual(["1", "2", "al_state_procurement_demo_readiness", "wa_state_procurement_demo_readiness"]);
    expect(plan.dependents).toEqual(EXPECTED_DEMO_DEPENDENTS);
    expect(plan.knowledgeItemsToDetach).toBe(EXPECTED_KNOWLEDGE_ITEMS_TO_DETACH);
    expect(plan.detachments).toEqual(EXPECTED_DEMO_DETACHMENTS);
    expect(totalChanges(sqlite)).toBe(before);
    expect(rowCounts(sqlite, [...DEPENDENT_TABLES, "bids", "knowledge_items"])).toEqual(tableCounts);
  });

  it("keeps the table list and the expected counts in step with each other", () => {
    expect(Object.keys(EXPECTED_DEMO_DEPENDENTS).sort()).toEqual([...DEPENDENT_TABLES].sort());
    const seeded = buildDemoPurgeSeed().filter((row) => isDemoOwned(row) && DEPENDENT_TABLES.includes(row.table));
    const perTable: Record<string, number> = {};
    for (const row of seeded) perTable[row.table] = (perTable[row.table] ?? 0) + 1;
    expect(perTable).toEqual(EXPECTED_DEMO_DEPENDENTS);
  });

  it("is a dry run unless apply is set: same plan, applied false, nothing written", async () => {
    const rows = buildDemoPurgeSeed();
    seedSqlite(testDb, rows);
    const before = totalChanges(sqlite);

    const result = await purgeDemoBids({ database: testDb.db }, { apply: false });

    expect(result.applied).toBe(false);
    expect(result.dependents).toEqual(EXPECTED_DEMO_DEPENDENTS);
    expect(result.detachments).toEqual(EXPECTED_DEMO_DETACHMENTS);
    expect(result.bids).toHaveLength(4);
    expect(Object.values(result.deleted).every((count) => count === 0)).toBe(true);
    expect(Object.values(result.detached).every((count) => count === 0)).toBe(true);
    expect(Object.keys(result.detached)).toEqual(Object.keys(EXPECTED_DEMO_DETACHMENTS));
    expect(totalChanges(sqlite)).toBe(before);
    expectSeedState(sqlite, rows, { purged: false });
  });

  it("removes exactly the four demo bids and every dependent row, and nothing else", async () => {
    const rows = buildDemoPurgeSeed();
    seedSqlite(testDb, rows);
    const links = knowledgeLinks(sqlite);

    const result = await purgeDemoBids({ database: testDb.db }, { apply: true });

    expect(result.applied).toBe(true);
    expect(result.bids.map((bid) => bid.id)).toEqual(["1", "2", "al_state_procurement_demo_readiness", "wa_state_procurement_demo_readiness"]);
    expect(result.dependents).toEqual(EXPECTED_DEMO_DEPENDENTS);
    expect(result.knowledgeItemsToDetach).toBe(EXPECTED_KNOWLEDGE_ITEMS_TO_DETACH);
    expect(result.deleted).toEqual({ ...EXPECTED_DEMO_DEPENDENTS, bids: 4 });
    expect(result.detached).toEqual(EXPECTED_DEMO_DETACHMENTS);

    expectSeedState(sqlite, rows, { purged: true });
    expect(presentKeys(sqlite, "bids")).toEqual(new Set(SURVIVOR_BID_IDS));
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);

    // Knowledge items stay; the ones that pointed at a demo bid or intent lose exactly that link.
    const after = knowledgeLinks(sqlite);
    expect(Object.keys(after).sort()).toEqual(Object.keys(links).sort());
    for (const row of rows.filter((candidate) => candidate.table === "knowledge_items")) {
      const id = String(row.values.id);
      expect(after[id]).toEqual(isDemoOwned(row) ? { bid: null, intent: null } : links[id]);
    }
    expect(after.ki_unrelated).toEqual({ bid: null, intent: null });
    expect(after[`knowledge_${seedTag(REAL_BID_ID)}`]).toEqual({ bid: REAL_BID_ID, intent: `intent_${seedTag(REAL_BID_ID)}` });
  });

  it("finds nothing to do on a second apply and writes nothing", async () => {
    seedSqlite(testDb);
    await purgeDemoBids({ database: testDb.db }, { apply: true });
    const before = totalChanges(sqlite);

    const second = await purgeDemoBids({ database: testDb.db }, { apply: true });

    expect(second.bids).toEqual([]);
    expect(second.applied).toBe(false);
    expect(second.knowledgeItemsToDetach).toBe(0);
    expect(Object.values(second.dependents).every((count) => count === 0)).toBe(true);
    expect(Object.values(second.detachments).every((count) => count === 0)).toBe(true);
    expect(Object.values(second.deleted).every((count) => count === 0)).toBe(true);
    expect(Object.values(second.detached).every((count) => count === 0)).toBe(true);
    expect(second.deleted.bids).toBe(0);
    expect(totalChanges(sqlite)).toBe(before);
  });

  it("removes every row that references a purged row through any column, as a cascade would, and detaches SET NULL links", async () => {
    const rows = buildDemoPurgeSeed();
    seedSqlite(testDb, rows);
    const survivorIntent = `intent_${seedTag(REAL_BID_ID)}`;
    const survivorItem = `item_${seedTag(REAL_BID_ID)}_1`;
    const survivorAward = `award_${seedTag(REAL_BID_ID)}`;
    const demoItem = "item_1_1";
    const demoArtifact = "artifact_1";
    // A survivor's award outcome borrowed a demo artifact; a survivor's intent commented on a demo workspace item;
    // a survivor's workspace item links a demo artifact.
    sqlite.prepare("UPDATE award_outcomes SET tabulation_artifact_id = ? WHERE id = ?").run(demoArtifact, survivorAward);
    sqlite.prepare(
      "INSERT INTO response_workspace_comments (id, intent_id, item_id, author_user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("comment_cross", survivorIntent, demoItem, "u_alice", "Cross link", SEED_AT, SEED_AT);
    sqlite.prepare(
      "INSERT INTO response_workspace_item_artifacts (item_id, artifact_id, created_at) VALUES (?, ?, ?)",
    ).run(survivorItem, demoArtifact, SEED_AT);

    const plan = await planDemoPurge({ database: testDb.db });
    expect(plan.dependents).toEqual({
      ...EXPECTED_DEMO_DEPENDENTS,
      response_workspace_comments: EXPECTED_DEMO_DEPENDENTS.response_workspace_comments + 1,
      response_workspace_item_artifacts: EXPECTED_DEMO_DEPENDENTS.response_workspace_item_artifacts + 1,
    });
    // The survivor's award outcome stays, so the plan announces its lost link; the four demo award outcomes, which
    // name their own artifacts, are deleted and are not counted as links that merely lose their target.
    expect(plan.detachments).toEqual({ ...EXPECTED_DEMO_DETACHMENTS, "award_outcomes.tabulation_artifact_id": 1 });

    const result = await purgeDemoBids({ database: testDb.db }, { apply: true });

    expect(result.deleted).toEqual({ ...plan.dependents, bids: 4 });
    expect(result.detached).toEqual(plan.detachments);
    expect(presentKeys(sqlite, "response_workspace_comments").has("comment_cross")).toBe(false);
    expect(presentKeys(sqlite, "response_workspace_item_artifacts").has(`${survivorItem}|${demoArtifact}`)).toBe(false);
    expect(sqlite.prepare("SELECT tabulation_artifact_id FROM award_outcomes WHERE id = ?").get(survivorAward)).toEqual({
      tabulation_artifact_id: null,
    });
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("rolls everything back when the foreign key check finds a reference the purge created", async () => {
    const rows = buildDemoPurgeSeed();
    seedSqlite(testDb, rows);
    // A table the purge list does not know, checked only at commit: deleting the bid makes its row dangle.
    sqlite.exec("CREATE TABLE unlisted_child (id TEXT PRIMARY KEY, bid_id TEXT REFERENCES bids(id) DEFERRABLE INITIALLY DEFERRED)");
    sqlite.prepare("INSERT INTO unlisted_child (id, bid_id) VALUES (?, ?)").run("u1", "1");

    const failure = await purgeDemoBids({ database: testDb.db }, { apply: true }).then(() => undefined, (error: unknown) => error);

    expect(failure).toBeInstanceOf(DemoPurgeError);
    expect((failure as DemoPurgeError).code).toBe("INTEGRITY_CHECK_FAILED");
    expect((failure as DemoPurgeError).message).toContain("unlisted_child");
    expectSeedState(sqlite, rows, { purged: false });
    expect(knowledgeLinks(sqlite)[`knowledge_${seedTag(REAL_BID_ID)}`]).toEqual({ bid: REAL_BID_ID, intent: `intent_${seedTag(REAL_BID_ID)}` });
    expect(knowledgeLinks(sqlite).knowledge_1).toEqual({ bid: "1", intent: "intent_1" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM unlisted_child").get()).toEqual({ n: 1 });
  });

  it("is not blocked by a foreign key violation that was already there", async () => {
    const rows = buildDemoPurgeSeed();
    seedSqlite(testDb, rows);
    sqlite.exec("CREATE TABLE legacy_child (id TEXT PRIMARY KEY, bid_id TEXT REFERENCES bids(id))");
    sqlite.pragma("foreign_keys = OFF");
    sqlite.prepare("INSERT INTO legacy_child (id, bid_id) VALUES (?, ?)").run("l1", "a_bid_that_never_existed");
    sqlite.pragma("foreign_keys = ON");
    expect(sqlite.pragma("foreign_key_check")).toHaveLength(1);

    const result = await purgeDemoBids({ database: testDb.db }, { apply: true });

    expect(result.applied).toBe(true);
    expectSeedState(sqlite, rows, { purged: true });
    expect(sqlite.pragma("foreign_key_check")).toHaveLength(1);
  });

  it("purges the real data's size: 50 demo-readiness and 6 mock bids with every dependent", async () => {
    const rows = buildDemoPurgeSeed({ extraDemoReadiness: 48, extraMock: 4 });
    seedSqlite(testDb, rows);

    const plan = await planDemoPurge({ database: testDb.db });
    expect(plan.bids).toHaveLength(56);
    expect(plan.bids.filter((bid) => bid.kind === "demo_readiness")).toHaveLength(50);
    expect(plan.bids.filter((bid) => bid.kind === "mock_seed")).toHaveLength(6);
    expect(plan.dependents).toEqual(expectedDemoDependents(56));
    expect(plan.knowledgeItemsToDetach).toBe(2 * 56);
    expect(plan.detachments).toEqual(expectedDemoDetachments(56));

    const result = await purgeDemoBids({ database: testDb.db }, { apply: true });

    expect(result.deleted).toEqual({ ...expectedDemoDependents(56), bids: 56 });
    expect(result.detached).toEqual(expectedDemoDetachments(56));
    expectSeedState(sqlite, rows, { purged: true });
    expect(presentKeys(sqlite, "bids")).toEqual(new Set(SURVIVOR_BID_IDS));
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("shows in a dry run every write the apply makes", async () => {
    seedSqlite(testDb);
    // A kept award outcome that borrowed a demo artifact, so every kind of write is in the plan.
    sqlite.prepare("UPDATE award_outcomes SET tabulation_artifact_id = ? WHERE id = ?").run("artifact_1", `award_${seedTag(REAL_BID_ID)}`);
    const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, count) => total + count, 0);
    const plan = await planDemoPurge({ database: testDb.db });
    const planned = sum(plan.dependents) + plan.bids.length + sum(plan.detachments);
    const before = totalChanges(sqlite);

    const result = await purgeDemoBids({ database: testDb.db }, { apply: true });

    // SQLite counts the rows its own foreign key actions change as well, so a write that the plan did not announce
    // (a cascade, a SET NULL the purge did not count) would make this number larger than the plan.
    expect(totalChanges(sqlite) - before).toBe(planned);
    expect(result.deleted).toEqual({ ...plan.dependents, bids: plan.bids.length });
    expect(result.detached).toEqual(plan.detachments);
    expect(Object.keys(plan.detachments)).toEqual(DEMO_PURGE_DETACHMENTS.map((entry) => `${entry.table}.${entry.column}`));
  });

  /** `count` mock bids that match the rule and have no dependents; ids 1000 and up. */
  function insertBulkMockBids(count: number) {
    const insert = sqlite.prepare(
      `INSERT INTO bids (id, source, source_bid_id, dedupe_key, title, description, issuer_name, issuer_type, state_code,
         source_url, first_seen_at, last_seen_at, created_at, updated_at)
       VALUES (?, 'Bulk', ?, ?, 't', 'd', 'i', 'state', 'OH', 'https://example.test', ?, ?, ?, ?)`,
    );
    sqlite.transaction(() => {
      for (let n = 0; n < count; n += 1) {
        const id = String(1000 + n);
        insert.run(id, `mock:${id}`, `bulk:${id}`, SEED_AT, SEED_AT, SEED_AT, SEED_AT);
      }
    })();
  }

  it("handles the largest match it accepts", async () => {
    insertBulkMockBids(DEMO_PURGE_MAX_BIDS);

    const plan = await planDemoPurge({ database: testDb.db });
    expect(plan.bids).toHaveLength(DEMO_PURGE_MAX_BIDS);
    const result = await purgeDemoBids({ database: testDb.db }, { apply: true });

    expect(result.applied).toBe(true);
    expect(result.deleted.bids).toBe(DEMO_PURGE_MAX_BIDS);
    expect(rowCounts(sqlite, ["bids"])).toEqual({ bids: 0 });
  });

  it("refuses to touch an unexpectedly large match", async () => {
    seedSqlite(testDb);
    insertBulkMockBids(DEMO_PURGE_MAX_BIDS + 1);
    const before = totalChanges(sqlite);

    for (const attempt of [
      () => planDemoPurge({ database: testDb.db }),
      () => purgeDemoBids({ database: testDb.db }, { apply: false }),
      () => purgeDemoBids({ database: testDb.db }, { apply: true }),
    ]) {
      const failure = await attempt().then(() => undefined, (error: unknown) => error);
      expect(failure).toBeInstanceOf(DemoPurgeError);
      expect((failure as DemoPurgeError).code).toBe("TOO_MANY_DEMO_BIDS");
    }
    expect(totalChanges(sqlite)).toBe(before);
  });
});

/* -------------------------------------------------------------------------------------------------------------- */
/* The static table list, checked against the REFERENCES clauses of migrate.ts                                    */
/* -------------------------------------------------------------------------------------------------------------- */

interface ParsedReference {
  table: string;
  column: string;
  parent: string;
  parentColumn: string;
  onDelete: string | null;
}

const migrateSource = readFileSync(fileURLToPath(new URL("../db/migrate.ts", import.meta.url)), "utf8");
// The same block src/server/db/mysql.ts translates: a table or foreign key declared anywhere else never reaches MySQL.
const createTableBlock = migrateSource.match(/sqlite\.exec\(`([\s\S]*?)`\);/)?.[1] ?? "";

function parseReferences(sql: string): ParsedReference[] {
  const found: ParsedReference[] = [];
  for (const statement of sql.split(";")) {
    const create = statement.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*)\)\s*$/);
    if (!create) continue;
    const [, table, body] = create;
    for (const line of body.split("\n")) {
      const inline = line.match(/^\s*(\w+)\s+(?:TEXT|INTEGER)\b.*?\bREFERENCES\s+(\w+)\s*\(\s*(\w+)\s*\)(?:\s+ON\s+DELETE\s+(CASCADE|SET NULL|RESTRICT|NO ACTION))?/i);
      if (inline) {
        found.push({ table, column: inline[1], parent: inline[2], parentColumn: inline[3], onDelete: inline[4]?.toUpperCase() ?? null });
        continue;
      }
      const tableLevel = line.match(/FOREIGN KEY\s*\(\s*(\w+)\s*\)\s*REFERENCES\s+(\w+)\s*\(\s*(\w+)\s*\)(?:\s+ON\s+DELETE\s+(CASCADE|SET NULL|RESTRICT|NO ACTION))?/i);
      if (tableLevel) {
        found.push({ table, column: tableLevel[1], parent: tableLevel[2], parentColumn: tableLevel[3], onDelete: tableLevel[4]?.toUpperCase() ?? null });
      }
    }
  }
  return found;
}

/** Tables from which a chain of REFERENCES (any ON DELETE action) leads to `bids`, and the references of that chain. */
function tablesReaching(references: readonly ParsedReference[], root: string): Set<string> {
  const reached = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const reference of references) {
      if (reached.has(reference.parent) && !reached.has(reference.table)) {
        reached.add(reference.table);
        grew = true;
      }
    }
  }
  reached.delete(root);
  return reached;
}

/**
 * What is wrong with the references of the tables the purge does NOT list (it only detaches them, or has never heard of
 * them). Their rows survive the purge, so every reference they have into the graph must be an ON DELETE SET NULL that
 * the purge detaches. A CASCADE would have SQLite delete rows behind the purge's back and outside its counts (and leave
 * them in MySQL), and a reference without an action, or RESTRICT, would refuse the delete of the parent.
 */
function referencesOfUnlistedTables(
  references: readonly ParsedReference[],
  listed: ReadonlySet<string>,
  inGraph: ReadonlySet<string>,
  detachments: readonly { table: string; column: string; parent: string }[],
): string[] {
  const detached = new Set(detachments.map((entry) => `${entry.table}.${entry.column} -> ${entry.parent}`));
  const problems: string[] = [];
  for (const reference of references) {
    if (listed.has(reference.table) || !inGraph.has(reference.parent)) continue;
    const link = `${reference.table}.${reference.column} -> ${reference.parent}`;
    if (reference.onDelete !== "SET NULL") {
      problems.push(`${link} is ON DELETE ${reference.onDelete ?? "NO ACTION"}, but ${reference.table} is not purged: only ON DELETE SET NULL may point into the graph`);
    } else if (!detached.has(link)) {
      problems.push(`${link} is ON DELETE SET NULL but not in DEMO_PURGE_DETACHMENTS, so MySQL would leave it dangling`);
    }
  }
  return problems;
}

describe("the demo purge table list against the REFERENCES clauses of migrate.ts", () => {
  const references = parseReferences(createTableBlock);
  const reached = tablesReaching(references, "bids");
  const listed = new Set(DEMO_PURGE_TABLES.map((entry) => entry.table));
  const detached = new Set(DEMO_PURGE_DETACHMENTS.map((entry) => entry.table));
  const inGraph = new Set([...reached, "bids"]);
  const listIndex = new Map(DEMO_PURGE_TABLES.map((entry, index) => [entry.table, index]));

  it("reads every REFERENCES clause of the CREATE TABLE block (a format the parser cannot read must fail here, not hide)", () => {
    expect(createTableBlock.length).toBeGreaterThan(1000);
    expect(references.length).toBe((createTableBlock.match(/\bREFERENCES\b/g) ?? []).length);
    // Sanity: the chains this task is about are visible to the parser.
    for (const table of [
      "bid_attachments", "intent_to_bid", "response_workspace_items", "supplier_artifacts", "submission_confirmations",
      "response_workspace_comments", "response_workspace_activity", "response_workspace_item_artifacts",
      "quote_request_artifacts", "response_package_export_review_events", "knowledge_items",
    ]) {
      expect(reached.has(table), table).toBe(true);
    }
    expect(reached.has("users")).toBe(false);
    expect(reached.has("sourcing_partners")).toBe(false);
  });

  it("covers every table whose REFERENCES chain reaches bids", () => {
    const missing = [...reached].filter((table) => !listed.has(table) && !detached.has(table)).sort();
    expect(missing, `tables that reference bids (directly or through another table) but are neither purged nor detached: ${missing.join(", ")}`).toEqual([]);
  });

  it("lists no table that does not reach bids, and no table twice", () => {
    expect([...listed, ...detached].filter((table) => !reached.has(table))).toEqual([]);
    expect(DEMO_PURGE_TABLES.length).toBe(listed.size);
  });

  it("carries, for every listed table, exactly the references that point at bids or at another listed table", () => {
    for (const entry of DEMO_PURGE_TABLES) {
      const expected = references
        .filter((reference) => reference.table === entry.table && inGraph.has(reference.parent) && reference.onDelete !== "SET NULL")
        .map((reference) => `${reference.column} -> ${reference.parent}`)
        .sort();
      expect(entry.references.map((reference) => `${reference.column} -> ${reference.parent}`).sort(), entry.table).toEqual(expected);
      expect(expected.length, `${entry.table} has no reference that deletes it with a bid`).toBeGreaterThan(0);
    }
  });

  it("detaches, and only detaches, the ON DELETE SET NULL references into the graph", () => {
    const expected = references
      .filter((reference) => inGraph.has(reference.parent) && reference.onDelete === "SET NULL")
      .map((reference) => `${reference.table}.${reference.column} -> ${reference.parent}`)
      .sort();
    expect(DEMO_PURGE_DETACHMENTS.map((entry) => `${entry.table}.${entry.column} -> ${entry.parent}`).sort()).toEqual(expected);
  });

  it("lets a table the purge keeps reference the graph only through ON DELETE SET NULL links that the purge detaches", () => {
    expect(referencesOfUnlistedTables(references, listed, inGraph, DEMO_PURGE_DETACHMENTS)).toEqual([]);
    // knowledge_items is the table this is about: it is detached, never deleted, and has exactly those two links.
    expect(references.filter((reference) => reference.table === "knowledge_items" && inGraph.has(reference.parent)).map((reference) => reference.onDelete))
      .toEqual(["SET NULL", "SET NULL"]);
  });

  it("reports a reference that would delete, or block, rows of a table the purge keeps", () => {
    const added = (over: Partial<ParsedReference>): ParsedReference => ({
      table: "knowledge_items", column: "legacy_bid_id", parent: "bids", parentColumn: "id", onDelete: "CASCADE", ...over,
    });
    const problems = (extra: ParsedReference) => referencesOfUnlistedTables([...references, extra], listed, inGraph, DEMO_PURGE_DETACHMENTS);

    // CASCADE: SQLite would delete these rows with the bid, behind the purge's back and outside its counts.
    expect(problems(added({}))).toEqual([expect.stringContaining("knowledge_items.legacy_bid_id -> bids")]);
    expect(problems(added({ parent: "intent_to_bid" }))).toEqual([expect.stringContaining("knowledge_items.legacy_bid_id -> intent_to_bid")]);
    // No ON DELETE clause (NO ACTION) and RESTRICT would refuse the delete of the parent.
    expect(problems(added({ onDelete: null }))).toEqual([expect.stringContaining("NO ACTION")]);
    expect(problems(added({ onDelete: "RESTRICT" }))).toEqual([expect.stringContaining("RESTRICT")]);
    // SET NULL is the one acceptable action, and only when the purge detaches that very column.
    expect(problems(added({ onDelete: "SET NULL" }))).toEqual([expect.stringContaining("not in DEMO_PURGE_DETACHMENTS")]);
    expect(problems(added({ column: "source_bid_id", onDelete: "SET NULL" }))).toEqual([]);
    // A table that is new to the graph is reported the same way.
    expect(problems(added({ table: "bid_notes" }))).toEqual([expect.stringContaining("bid_notes.legacy_bid_id -> bids")]);
    // Not its business: a reference outside the graph, or one of a table the purge lists (checked by its own test).
    expect(problems(added({ table: "audit_log", parent: "users" }))).toEqual([]);
    expect(problems(added({ table: "bid_attachments" }))).toEqual([]);
  });

  it("only references parents through their id column", () => {
    for (const reference of references.filter((candidate) => inGraph.has(candidate.parent))) {
      expect(reference.parentColumn, `${reference.table}.${reference.column}`).toBe("id");
    }
  });

  it("deletes children before the tables they reference", () => {
    for (const entry of DEMO_PURGE_TABLES) {
      for (const reference of entry.references) {
        if (reference.parent === "bids") continue;
        expect(listIndex.has(reference.parent), `${entry.table} references ${reference.parent}, which is not listed`).toBe(true);
        expect(listIndex.get(entry.table)!, `${entry.table} must be purged before ${reference.parent}`).toBeLessThan(listIndex.get(reference.parent)!);
      }
    }
    for (const detachment of DEMO_PURGE_DETACHMENTS) {
      expect(detachment.parent === "bids" || listIndex.has(detachment.parent)).toBe(true);
    }
  });

  it("finds no REFERENCES outside the CREATE TABLE block that point into the graph", () => {
    const outside = migrateSource.replace(createTableBlock, "");
    const parents = [...outside.matchAll(/\bREFERENCES\s+(\w+)\s*\(/g)].map((match) => match[1]);
    expect(parents.filter((parent) => inGraph.has(parent))).toEqual([]);
  });
});

/* -------------------------------------------------------------------------------------------------------------- */
/* The MySQL branch against a scripted pool (the real server is exercised by demo-purge.mysql.integration.test.ts) */
/* -------------------------------------------------------------------------------------------------------------- */

/** The ids a purge removes from each parent table other than `bids`, unless a test says otherwise. */
const DEFAULT_REMOVED_IDS: Partial<Record<DemoPurgeParent, string[]>> = {
  intent_to_bid: ["intent-1", "intent-2"],
  response_workspace_items: ["item-1", "item-2", "item-3"],
  supplier_artifacts: ["artifact-1"],
  quote_requests: ["quote-1"],
  response_package_snapshots: ["snapshot-1"],
  response_package_exports: ["export-1"],
};
const FAKE_BID_IDS = ["1", "al_state_procurement_demo_readiness"];

interface FakeMysqlOptions {
  registered?: string[];
  candidates?: Array<{ id: string; source_bid_id: string }>;
  /**
   * Rows per dependent table (a plan count, and the affected rows of its DELETE); per `table.column` for a
   * detachment (the plan count, and the affected rows of its UPDATE); `knowledge_items` is the distinct plan count.
   */
  counts?: Record<string, number>;
  /** The ids the purge removes from each parent table other than `bids`. */
  removed?: Partial<Record<DemoPurgeParent, string[]>>;
  /** Rows of a relationship (`child.column -> parent`) that still reference one of the ids a check binds. */
  dangling?: (relationship: string, ids: unknown[]) => number;
}

const relationshipLabel = (child: string, column: string) =>
  DEMO_PURGE_RELATIONSHIPS.find((relationship) => relationship.child === child && relationship.column === column)?.label ?? `${child}.${column}`;

function createFakeMysql(options: FakeMysqlOptions = {}) {
  const events: string[] = [];
  /** Everything the purge asked for, in order: `collect <parent>`, `write <sql>`, `check <relationship>`. */
  const calls: string[] = [];
  const executed: string[] = [];
  const executedValues: unknown[][] = [];
  const checks: Array<{ label: string; ids: unknown[] }> = [];
  let transactionOpen = false;
  let poolQueriesInTransaction = 0;
  const candidates = options.candidates ?? [
    { id: "1", source_bid_id: "mock:1" },
    { id: "al_state_procurement_demo_readiness", source_bid_id: "demo:al_state_procurement" },
    { id: "ca_caleprocure:RFQ-1", source_bid_id: "demo:not-a-demo-bid" },
  ];

  /** The key a plan count or an affected-rows count is scripted under. */
  const countKey = (sql: string, table: string, firstColumn: string) => {
    if (table === "knowledge_items") return / OR source_intent_id IN \(/.test(sql) && firstColumn === "source_bid_id" ? "knowledge_items" : `knowledge_items.${firstColumn}`;
    return DEMO_PURGE_DETACHMENTS.some((entry) => entry.table === table && entry.column === firstColumn) ? `${table}.${firstColumn}` : table;
  };

  const answer = (sql: string, values: unknown[]): unknown[] => {
    if (/FROM data_sources/.test(sql)) return (options.registered ?? ["ca_caleprocure"]).map((id) => ({ id }));
    if (/FROM bids WHERE source_bid_id LIKE/.test(sql)) {
      return candidates.map((row) => ({ ...row, title: `Bid ${row.id}`, state_code: "XX", lifecycle_status: "open" }));
    }
    const collect = sql.match(/^SELECT id FROM (\w+) WHERE /);
    if (collect) {
      calls.push(`collect ${collect[1]}`);
      return (options.removed?.[collect[1] as DemoPurgeParent] ?? DEFAULT_REMOVED_IDS[collect[1] as DemoPurgeParent] ?? []).map((id) => ({ id }));
    }
    const check = sql.match(/^SELECT COUNT\(\*\) AS n FROM `(\w+)` WHERE `(\w+)` IN \(/);
    if (check) {
      const label = relationshipLabel(check[1], check[2]);
      calls.push(`check ${label}`);
      checks.push({ label, ids: values });
      return [{ n: options.dangling?.(label, values) ?? 0 }];
    }
    const count = sql.match(/^SELECT COUNT\(\*\) AS n FROM (\w+) WHERE (\w+) IN \(/);
    if (count) return [{ n: options.counts?.[countKey(sql, count[1], count[2])] ?? 0 }];
    throw new Error(`unscripted query: ${sql}`);
  };

  const connection = {
    query: async (sql: string, values: unknown[] = []) => [answer(sql, values)],
    execute: async (sql: string, values: unknown[] = []) => {
      calls.push(`write ${sql}`);
      executed.push(sql);
      executedValues.push(values);
      const detach = sql.match(/^UPDATE (\w+) SET (\w+) = NULL/);
      const table = sql.match(/^DELETE FROM (\w+)/)?.[1] ?? "";
      const key = detach ? `${detach[1]}.${detach[2]}` : table;
      return [{ affectedRows: sql.startsWith("DELETE FROM bids") ? FAKE_BID_IDS.length : (options.counts?.[key] ?? 0), insertId: 0 }];
    },
    beginTransaction: async () => { events.push("begin"); transactionOpen = true; },
    commit: async () => { events.push("commit"); transactionOpen = false; },
    rollback: async () => { events.push("rollback"); transactionOpen = false; },
    release: () => { events.push("release"); },
  };
  const pool = {
    query: async (sql: string, values: unknown[] = []) => {
      if (transactionOpen) poolQueriesInTransaction += 1;
      return [answer(sql, values)];
    },
    getConnection: async () => connection,
  };
  return {
    pool: pool as unknown as DemoPurgeMysql,
    events,
    calls,
    executed,
    executedValues,
    checks,
    get poolQueriesInTransaction() { return poolQueriesInTransaction; },
  };
}

const verbAndTable = (sql: string) => sql.match(/^(DELETE FROM|UPDATE) (\w+)/)!.slice(1).join(" ");
const removedIdsOf = (parent: DemoPurgeParent, removed: FakeMysqlOptions["removed"] = {}) =>
  parent === "bids" ? FAKE_BID_IDS : (removed[parent] ?? DEFAULT_REMOVED_IDS[parent] ?? []);

describe("demo and seed bid purge on MySQL, with a scripted pool", () => {
  it("plans without a transaction and without writing, every detachment included", async () => {
    const fake = createFakeMysql({
      counts: {
        bid_attachments: 3, intent_to_bid: 2, knowledge_items: 1,
        "knowledge_items.source_bid_id": 1, "knowledge_items.source_intent_id": 1, "award_outcomes.tabulation_artifact_id": 2,
      },
    });

    const result = await purgeDemoBids({ mysql: fake.pool }, { apply: false });

    expect(result.applied).toBe(false);
    expect(result.bids.map((bid) => [bid.id, bid.kind])).toEqual([["1", "mock_seed"], ["al_state_procurement_demo_readiness", "demo_readiness"]]);
    expect(result.dependents.bid_attachments).toBe(3);
    expect(result.dependents.intent_to_bid).toBe(2);
    expect(result.knowledgeItemsToDetach).toBe(1);
    expect(result.detachments).toEqual({
      "knowledge_items.source_bid_id": 1, "knowledge_items.source_intent_id": 1, "award_outcomes.tabulation_artifact_id": 2,
    });
    expect(Object.keys(result.dependents)).toEqual(DEMO_PURGE_TABLES.map((entry) => entry.table));
    expect(Object.keys(result.detachments)).toEqual(DEMO_PURGE_DETACHMENTS.map((entry) => `${entry.table}.${entry.column}`));
    expect(fake.events).toEqual([]);
    expect(fake.executed).toEqual([]);
  });

  it("detaches first, deletes dependents children first, deletes the bids last, commits once, and reports what it wrote", async () => {
    const fake = createFakeMysql({ counts: { bid_attachments: 3, "award_outcomes.tabulation_artifact_id": 2, award_outcomes: 5 } });

    const result = await purgeDemoBids({ mysql: fake.pool }, { apply: true });

    expect(fake.events).toEqual(["begin", "commit", "release"]);
    expect(fake.executed.map(verbAndTable)).toEqual([
      ...DEMO_PURGE_DETACHMENTS.map((entry) => `UPDATE ${entry.table}`),
      ...DEMO_PURGE_TABLES.map((entry) => `DELETE FROM ${entry.table}`),
      "DELETE FROM bids",
    ]);
    expect(result.applied).toBe(true);
    expect(result.deleted.bid_attachments).toBe(3);
    expect(result.deleted.award_outcomes).toBe(5);
    expect(result.deleted.bids).toBe(2);
    expect(result.detached).toEqual({
      "knowledge_items.source_bid_id": 0, "knowledge_items.source_intent_id": 0, "award_outcomes.tabulation_artifact_id": 2,
    });
    // Everything inside the transaction goes through its own connection (a pool of one would otherwise deadlock).
    expect(fake.poolQueriesInTransaction).toBe(0);
  });

  it("does not count, or null, the link of an award outcome that the same purge deletes", async () => {
    const fake = createFakeMysql();

    await purgeDemoBids({ mysql: fake.pool }, { apply: true });

    const update = fake.executed.find((sql) => sql.startsWith("UPDATE award_outcomes"))!;
    expect(update).toMatch(/WHERE tabulation_artifact_id IN \(SELECT id FROM supplier_artifacts WHERE .*\) AND NOT \(intent_id IN \(.*\) OR bid_id IN \(.*\)\)$/);
    // Rows of a table that is not purged have no such exclusion.
    expect(fake.executed.find((sql) => sql.startsWith("UPDATE knowledge_items SET source_bid_id"))).not.toContain("AND NOT");
  });

  it("binds only the demo bids that the rule accepts", async () => {
    const fake = createFakeMysql();

    await purgeDemoBids({ mysql: fake.pool }, { apply: true });

    // The last statement deletes the bids; the third candidate carries a demo: source_bid_id but a registered prefix.
    expect(fake.executedValues.at(-1)).toEqual(FAKE_BID_IDS);
    expect(fake.executedValues.flat()).not.toContain("ca_caleprocure:RFQ-1");
  });

  it("collects the ids it removes before its first write, and checks them after its last", async () => {
    const fake = createFakeMysql();

    await purgeDemoBids({ mysql: fake.pool }, { apply: true });

    const firstWrite = fake.calls.findIndex((call) => call.startsWith("write "));
    const lastWrite = fake.calls.findLastIndex((call) => call.startsWith("write "));
    const collects = fake.calls.flatMap((call, index) => (call.startsWith("collect ") ? [index] : []));
    const checks = fake.calls.flatMap((call, index) => (call.startsWith("check ") ? [index] : []));
    const parents = [...new Set(DEMO_PURGE_RELATIONSHIPS.map((relationship) => relationship.parent))].filter((parent) => parent !== "bids");
    expect(fake.calls.filter((call) => call.startsWith("collect ")).sort()).toEqual(parents.map((parent) => `collect ${parent}`).sort());
    expect(Math.max(...collects)).toBeLessThan(firstWrite);
    expect(Math.min(...checks)).toBeGreaterThan(lastWrite);
  });

  it("checks every relationship of the list, plus every detachment, against exactly the ids removed from its parent", async () => {
    const fake = createFakeMysql();

    await purgeDemoBids({ mysql: fake.pool }, { apply: true });

    expect(DEMO_PURGE_RELATIONSHIPS.length).toBe(
      DEMO_PURGE_TABLES.reduce((total, entry) => total + entry.references.length, 0) + DEMO_PURGE_DETACHMENTS.length,
    );
    for (const relationship of DEMO_PURGE_RELATIONSHIPS) {
      expect(fake.checks.filter((check) => check.label === relationship.label), relationship.label)
        .toEqual([{ label: relationship.label, ids: removedIdsOf(relationship.parent) }]);
    }
    expect(fake.checks).toHaveLength(DEMO_PURGE_RELATIONSHIPS.length);
  });

  it("rolls back, and does not commit, when a row still references a purged id", async () => {
    const fake = createFakeMysql({
      dangling: (relationship) => (relationship === "response_workspace_comments.item_id -> response_workspace_items" ? 2 : 0),
    });

    const failure = await purgeDemoBids({ mysql: fake.pool }, { apply: true }).then(() => undefined, (error: unknown) => error);

    expect(failure).toBeInstanceOf(DemoPurgeError);
    expect((failure as DemoPurgeError).code).toBe("INTEGRITY_CHECK_FAILED");
    expect((failure as DemoPurgeError).message).toContain("response_workspace_comments.item_id -> response_workspace_items (2 rows still reference purged rows)");
    expect(fake.events).toEqual(["begin", "rollback", "release"]);
  });

  it("names every relationship that still has a row pointing at a purged id", async () => {
    const fake = createFakeMysql({
      dangling: (relationship) => (["bid_attachments.bid_id -> bids", "submission_confirmations.intent_id -> intent_to_bid"].includes(relationship) ? 1 : 0),
    });

    const failure = await purgeDemoBids({ mysql: fake.pool }, { apply: true }).then(() => undefined, (error: unknown) => error);

    expect((failure as DemoPurgeError).message).toContain("bid_attachments.bid_id -> bids (1 rows");
    expect((failure as DemoPurgeError).message).toContain("submission_confirmations.intent_id -> intent_to_bid (1 rows");
    expect((failure as DemoPurgeError).message).not.toContain("saved_bids");
  });

  it("does not query a relationship whose parent lost no row", async () => {
    const fake = createFakeMysql({ removed: { quote_requests: [], response_package_exports: [] } });

    const result = await purgeDemoBids({ mysql: fake.pool }, { apply: true });

    expect(result.applied).toBe(true);
    const asked = new Set(fake.checks.map((check) => check.label));
    expect(asked.has("quote_request_artifacts.quote_request_id -> quote_requests")).toBe(false);
    expect(asked.has("response_package_export_review_events.export_id -> response_package_exports")).toBe(false);
    // ...while the other relationships of the same tables are still checked.
    expect(asked.has("quote_request_artifacts.artifact_id -> supplier_artifacts")).toBe(true);
    expect(asked.has("response_package_export_review_events.snapshot_id -> response_package_snapshots")).toBe(true);
    for (const check of fake.checks) expect(check.ids.length, check.label).toBeGreaterThan(0);
  });

  it("splits a long id list so that no check binds more than 500 ids, and adds up what every piece finds", async () => {
    const manyIntents = Array.from({ length: 1201 }, (_, index) => `intent-${index}`);
    const fake = createFakeMysql({
      removed: { intent_to_bid: manyIntents },
      // The second piece of every intent relationship finds one row.
      dangling: (relationship, ids) => (relationship === "submission_confirmations.intent_id -> intent_to_bid" && ids[0] === "intent-500" ? 3 : 0),
    });

    const failure = await purgeDemoBids({ mysql: fake.pool }, { apply: true }).then(() => undefined, (error: unknown) => error);

    const intentChecks = fake.checks.filter((check) => check.label === "submission_confirmations.intent_id -> intent_to_bid");
    expect(intentChecks.map((check) => check.ids.length)).toEqual([500, 500, 201]);
    expect(intentChecks.flatMap((check) => check.ids)).toEqual(manyIntents);
    expect(Math.max(...fake.checks.map((check) => check.ids.length))).toBeLessThanOrEqual(500);
    expect((failure as DemoPurgeError).message).toContain("submission_confirmations.intent_id -> intent_to_bid (3 rows still reference purged rows)");
    expect(fake.events).toEqual(["begin", "rollback", "release"]);
  });

  it("finds nothing to do when no row matches: no transaction, nothing written", async () => {
    const fake = createFakeMysql({ candidates: [] });

    const result = await purgeDemoBids({ mysql: fake.pool }, { apply: true });

    expect(result.applied).toBe(false);
    expect(result.bids).toEqual([]);
    expect(fake.events).toEqual([]);
    expect(fake.executed).toEqual([]);
  });
});
