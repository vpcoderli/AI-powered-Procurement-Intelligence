import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  DEMO_PURGE_DETACHMENTS,
  DEMO_PURGE_MAX_BIDS,
  DEMO_PURGE_TABLES,
  DemoPurgeError,
  demoBidKind,
  findDemoBids,
  isDemoBidRow,
  planDemoPurge,
  purgeDemoBids,
  type DemoPurgeMysql,
} from "./demo-purge";
import {
  EXPECTED_DEMO_DEPENDENTS,
  EXPECTED_KNOWLEDGE_ITEMS_TO_DETACH,
  REAL_BID_ID,
  SEED_AT,
  SURVIVOR_BID_IDS,
  buildDemoPurgeSeed,
  expectedDemoDependents,
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
    expect(result.bids).toHaveLength(4);
    expect(Object.values(result.deleted).every((count) => count === 0)).toBe(true);
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
    expect(Object.values(second.deleted).every((count) => count === 0)).toBe(true);
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

    const result = await purgeDemoBids({ database: testDb.db }, { apply: true });

    expect(result.deleted).toEqual({ ...plan.dependents, bids: 4 });
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

    const result = await purgeDemoBids({ database: testDb.db }, { apply: true });

    expect(result.deleted).toEqual({ ...expectedDemoDependents(56), bids: 56 });
    expectSeedState(sqlite, rows, { purged: true });
    expect(presentKeys(sqlite, "bids")).toEqual(new Set(SURVIVOR_BID_IDS));
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
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

interface FakeMysqlOptions {
  registered?: string[];
  candidates?: Array<{ id: string; source_bid_id: string }>;
  /** Rows per dependent table, as a plan count and as the affected-rows count of its DELETE. */
  counts?: Record<string, number>;
  orphans?: (relationship: string, phase: "before" | "after") => number;
}

function createFakeMysql(options: FakeMysqlOptions = {}) {
  const events: string[] = [];
  const executed: string[] = [];
  const executedValues: unknown[][] = [];
  let transactionOpen = false;
  let poolQueriesInTransaction = 0;
  const candidates = options.candidates ?? [
    { id: "1", source_bid_id: "mock:1" },
    { id: "al_state_procurement_demo_readiness", source_bid_id: "demo:al_state_procurement" },
    { id: "ca_caleprocure:RFQ-1", source_bid_id: "demo:not-a-demo-bid" },
  ];

  const answer = (sql: string): unknown[] => {
    if (/FROM data_sources/.test(sql)) return (options.registered ?? ["ca_caleprocure"]).map((id) => ({ id }));
    if (/FROM bids WHERE source_bid_id LIKE/.test(sql)) {
      return candidates.map((row) => ({ ...row, title: `Bid ${row.id}`, state_code: "XX", lifecycle_status: "open" }));
    }
    const orphan = sql.match(/FROM `(\w+)` c LEFT JOIN `(\w+)` p ON p\.id = c\.`(\w+)`/);
    if (orphan) {
      const relationship = `${orphan[1]}.${orphan[3]} -> ${orphan[2]}`;
      return [{ n: options.orphans?.(relationship, executed.length === 0 ? "before" : "after") ?? 0 }];
    }
    const count = sql.match(/^SELECT COUNT\(\*\) AS n FROM (\w+) WHERE/);
    if (count) {
      const table = count[1];
      return [{ n: table === "knowledge_items" ? (options.counts?.knowledge_items ?? 0) : (options.counts?.[table] ?? 0) }];
    }
    throw new Error(`unscripted query: ${sql}`);
  };

  const connection = {
    query: async (sql: string) => [answer(sql)],
    execute: async (sql: string, values: unknown[] = []) => {
      executed.push(sql);
      executedValues.push(values);
      const table = sql.match(/^(?:DELETE FROM|UPDATE) (\w+)/)?.[1] ?? "";
      return [{ affectedRows: sql.startsWith("DELETE FROM bids") ? 2 : (options.counts?.[table] ?? 0), insertId: 0 }];
    },
    beginTransaction: async () => { events.push("begin"); transactionOpen = true; },
    commit: async () => { events.push("commit"); transactionOpen = false; },
    rollback: async () => { events.push("rollback"); transactionOpen = false; },
    release: () => { events.push("release"); },
  };
  const pool = {
    query: async (sql: string) => {
      if (transactionOpen) poolQueriesInTransaction += 1;
      return [answer(sql)];
    },
    getConnection: async () => connection,
  };
  return {
    pool: pool as unknown as DemoPurgeMysql,
    events,
    executed,
    executedValues,
    get poolQueriesInTransaction() { return poolQueriesInTransaction; },
  };
}

const verbAndTable = (sql: string) => sql.match(/^(DELETE FROM|UPDATE) (\w+)/)!.slice(1).join(" ");

describe("demo and seed bid purge on MySQL, with a scripted pool", () => {
  it("plans without a transaction and without writing", async () => {
    const fake = createFakeMysql({ counts: { bid_attachments: 3, intent_to_bid: 2, knowledge_items: 1 } });

    const result = await purgeDemoBids({ mysql: fake.pool }, { apply: false });

    expect(result.applied).toBe(false);
    expect(result.bids.map((bid) => [bid.id, bid.kind])).toEqual([["1", "mock_seed"], ["al_state_procurement_demo_readiness", "demo_readiness"]]);
    expect(result.dependents.bid_attachments).toBe(3);
    expect(result.dependents.intent_to_bid).toBe(2);
    expect(result.knowledgeItemsToDetach).toBe(1);
    expect(Object.keys(result.dependents)).toEqual(DEMO_PURGE_TABLES.map((entry) => entry.table));
    expect(fake.events).toEqual([]);
    expect(fake.executed).toEqual([]);
  });

  it("detaches first, deletes dependents children first, deletes the bids last, and commits once", async () => {
    const fake = createFakeMysql({ counts: { bid_attachments: 3 } });

    const result = await purgeDemoBids({ mysql: fake.pool }, { apply: true });

    expect(fake.events).toEqual(["begin", "commit", "release"]);
    expect(fake.executed.map(verbAndTable)).toEqual([
      ...DEMO_PURGE_DETACHMENTS.map((entry) => `UPDATE ${entry.table}`),
      ...DEMO_PURGE_TABLES.map((entry) => `DELETE FROM ${entry.table}`),
      "DELETE FROM bids",
    ]);
    expect(result.applied).toBe(true);
    expect(result.deleted.bid_attachments).toBe(3);
    expect(result.deleted.bids).toBe(2);
    // Everything inside the transaction goes through its own connection (a pool of one would otherwise deadlock).
    expect(fake.poolQueriesInTransaction).toBe(0);
  });

  it("binds only the demo bids that the rule accepts", async () => {
    const fake = createFakeMysql();

    await purgeDemoBids({ mysql: fake.pool }, { apply: true });

    // The last statement deletes the bids; the third candidate carries a demo: source_bid_id but a registered prefix.
    expect(fake.executedValues.at(-1)).toEqual(["1", "al_state_procurement_demo_readiness"]);
    expect(fake.executedValues.flat()).not.toContain("ca_caleprocure:RFQ-1");
  });

  it("rolls back, and does not commit, when a relationship has more orphans afterwards than before", async () => {
    const fake = createFakeMysql({
      orphans: (relationship, phase) => (relationship === "response_workspace_comments.item_id -> response_workspace_items" && phase === "after" ? 1 : 0),
    });

    const failure = await purgeDemoBids({ mysql: fake.pool }, { apply: true }).then(() => undefined, (error: unknown) => error);

    expect(failure).toBeInstanceOf(DemoPurgeError);
    expect((failure as DemoPurgeError).code).toBe("INTEGRITY_CHECK_FAILED");
    expect((failure as DemoPurgeError).message).toContain("response_workspace_comments.item_id -> response_workspace_items");
    expect(fake.events).toEqual(["begin", "rollback", "release"]);
  });

  it("does not let orphans that were already there block the purge", async () => {
    const fake = createFakeMysql({ orphans: (relationship) => (relationship === "bid_attachments.bid_id -> bids" ? 7 : 0) });

    const result = await purgeDemoBids({ mysql: fake.pool }, { apply: true });

    expect(result.applied).toBe(true);
    expect(fake.events).toEqual(["begin", "commit", "release"]);
  });

  it("checks every relationship of the list, plus every detachment, once before and once after", async () => {
    const asked: string[] = [];
    const fake = createFakeMysql({ orphans: (relationship, phase) => { asked.push(`${phase} ${relationship}`); return 0; } });

    await purgeDemoBids({ mysql: fake.pool }, { apply: true });

    const relationships = [
      ...DEMO_PURGE_TABLES.flatMap((entry) => entry.references.map((reference) => `${entry.table}.${reference.column} -> ${reference.parent}`)),
      ...DEMO_PURGE_DETACHMENTS.map((entry) => `${entry.table}.${entry.column} -> ${entry.parent}`),
    ];
    expect(new Set(relationships).size).toBe(relationships.length);
    expect(asked.filter((entry) => entry.startsWith("before ")).map((entry) => entry.slice(7)).sort()).toEqual([...relationships].sort());
    expect(asked.filter((entry) => entry.startsWith("after ")).map((entry) => entry.slice(6)).sort()).toEqual([...relationships].sort());
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
