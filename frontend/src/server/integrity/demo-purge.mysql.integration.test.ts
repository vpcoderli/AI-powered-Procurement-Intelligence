import { randomUUID } from "node:crypto";
import { createPool, type Pool } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMysqlPool, runMysqlMigrations } from "@/server/db/mysql";
import {
  DEMO_PURGE_RELATIONSHIPS,
  DEMO_PURGE_TABLES,
  DemoPurgeError,
  findDemoBids,
  orphanCountSql,
  planDemoPurge,
  purgeDemoBids,
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

const DEMO_IDS_SORTED = ["1", "2", "al_state_procurement_demo_readiness", "wa_state_procurement_demo_readiness"];

describe.runIf(Boolean(process.env.CRAWLER_INTEGRATION_MYSQL_URL))("demo and seed bid purge on real MySQL", () => {
  const databaseName = `apsi_crawler_test_${randomUUID().replaceAll("-", "")}`;
  let admin: ReturnType<typeof createMysqlPool>;
  // One connection: anything the purge ran on the pool while its transaction holds that connection would wait forever.
  let mysql: Pool;
  const seedTables = [...new Set(buildDemoPurgeSeed().map((row) => row.table))];

  beforeAll(async () => {
    // Always a new isolated schema; never migrate or clear the supplied database.
    const url = new URL(process.env.CRAWLER_INTEGRATION_MYSQL_URL!);
    url.pathname = "/";
    admin = createMysqlPool(url.toString());
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    url.pathname = `/${databaseName}`;
    mysql = createPool({ uri: url.toString(), connectionLimit: 1 });
    await runMysqlMigrations(mysql);
  }, 60_000);

  afterAll(async () => {
    if (mysql) await mysql.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await admin.end();
    }
  });

  beforeEach(async () => {
    // MySQL has no foreign keys, so the order of these deletes does not matter.
    for (const table of seedTables) await mysql.query(`DELETE FROM ${table}`);
  });

  async function seed(rows: readonly SeedRow[] = buildDemoPurgeSeed()) {
    for (const row of rows) {
      const { sql, params } = insertStatement(row);
      await mysql.query(sql, params);
    }
  }

  async function presentKeys(table: string): Promise<Set<string>> {
    const columns = seedKeyColumns(table);
    const [rows] = await mysql.query(`SELECT ${columns.join(", ")} FROM ${table}`);
    return new Set((rows as Record<string, unknown>[]).map((row) => columns.map((column) => String(row[column])).join("|")));
  }

  async function expectSeedState(rows: readonly SeedRow[], { purged }: { purged: boolean }) {
    const present = new Map<string, Set<string>>();
    for (const table of seedTables) present.set(table, await presentKeys(table));
    for (const { table, key, present: shouldBePresent } of expectedPresence(rows, { purged })) {
      expect({ table, key, present: present.get(table)!.has(key) }).toEqual({ table, key, present: shouldBePresent });
    }
  }

  async function knowledgeLinks(): Promise<Record<string, { bid: string | null; intent: string | null }>> {
    const [rows] = await mysql.query("SELECT id, source_bid_id, source_intent_id FROM knowledge_items");
    return Object.fromEntries((rows as Array<{ id: string; source_bid_id: string | null; source_intent_id: string | null }>)
      .map((row) => [row.id, { bid: row.source_bid_id, intent: row.source_intent_id }]));
  }

  async function orphanCounts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const relationship of DEMO_PURGE_RELATIONSHIPS) {
      const [rows] = await mysql.query(orphanCountSql(relationship));
      counts[relationship.label] = Number((rows as Array<{ n: number | string }>)[0].n);
    }
    return counts;
  }

  async function countAll(tables: readonly string[]): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const [rows] = await mysql.query(`SELECT COUNT(*) AS n FROM ${table}`);
      counts[table] = Number((rows as Array<{ n: number | string }>)[0].n);
    }
    return counts;
  }

  const target = () => ({ mysql });

  it("finds exactly the four demo bids", async () => {
    await seed();

    const found = await findDemoBids(target());

    expect(found.map((bid) => [bid.id, bid.kind])).toEqual([
      ["1", "mock_seed"],
      ["2", "mock_seed"],
      ["al_state_procurement_demo_readiness", "demo_readiness"],
      ["wa_state_procurement_demo_readiness", "demo_readiness"],
    ]);
  });

  it("plans exact per-table counts, writes nothing, and a dry run changes nothing", async () => {
    const rows = buildDemoPurgeSeed();
    await seed(rows);
    const tables = [...seedTables];
    const before = await countAll(tables);

    const plan = await planDemoPurge(target());
    const dry = await purgeDemoBids(target(), { apply: false });

    expect(plan.bids.map((bid) => bid.id)).toEqual(DEMO_IDS_SORTED);
    expect(plan.dependents).toEqual(EXPECTED_DEMO_DEPENDENTS);
    expect(plan.knowledgeItemsToDetach).toBe(EXPECTED_KNOWLEDGE_ITEMS_TO_DETACH);
    expect(dry.applied).toBe(false);
    expect(dry.dependents).toEqual(plan.dependents);
    expect(await countAll(tables)).toEqual(before);
    await expectSeedState(rows, { purged: false });
  });

  it("removes exactly the demo bids and every dependent row, leaves zero orphans, and a second apply does nothing", async () => {
    const rows = buildDemoPurgeSeed();
    await seed(rows);
    const links = await knowledgeLinks();
    expect(await orphanCounts()).toEqual(Object.fromEntries(DEMO_PURGE_RELATIONSHIPS.map((relationship) => [relationship.label, 0])));

    const result = await purgeDemoBids(target(), { apply: true });

    expect(result.applied).toBe(true);
    expect(result.bids.map((bid) => bid.id)).toEqual(DEMO_IDS_SORTED);
    expect(result.dependents).toEqual(EXPECTED_DEMO_DEPENDENTS);
    expect(result.knowledgeItemsToDetach).toBe(EXPECTED_KNOWLEDGE_ITEMS_TO_DETACH);
    expect(result.deleted).toEqual({ ...EXPECTED_DEMO_DEPENDENTS, bids: 4 });

    await expectSeedState(rows, { purged: true });
    expect(await presentKeys("bids")).toEqual(new Set(SURVIVOR_BID_IDS));
    expect(await orphanCounts()).toEqual(Object.fromEntries(DEMO_PURGE_RELATIONSHIPS.map((relationship) => [relationship.label, 0])));

    // MySQL has no ON DELETE SET NULL; the purge nulls the links itself.
    const after = await knowledgeLinks();
    expect(Object.keys(after).sort()).toEqual(Object.keys(links).sort());
    for (const row of rows.filter((candidate) => candidate.table === "knowledge_items")) {
      const id = String(row.values.id);
      expect(after[id], id).toEqual(isDemoOwned(row) ? { bid: null, intent: null } : links[id]);
    }
    expect(after[`knowledge_${seedTag(REAL_BID_ID)}`]).toEqual({ bid: REAL_BID_ID, intent: `intent_${seedTag(REAL_BID_ID)}` });

    const tables = [...seedTables];
    const counts = await countAll(tables);
    const second = await purgeDemoBids(target(), { apply: true });
    expect(second.applied).toBe(false);
    expect(second.bids).toEqual([]);
    expect(Object.values(second.deleted).every((count) => count === 0)).toBe(true);
    expect(await countAll(tables)).toEqual(counts);
  });

  it("removes every row that references a purged row through any column and detaches SET NULL links", async () => {
    const rows = buildDemoPurgeSeed();
    await seed(rows);
    const survivorIntent = `intent_${seedTag(REAL_BID_ID)}`;
    const survivorItem = `item_${seedTag(REAL_BID_ID)}_1`;
    const survivorAward = `award_${seedTag(REAL_BID_ID)}`;
    await mysql.query("UPDATE award_outcomes SET tabulation_artifact_id = ? WHERE id = ?", ["artifact_1", survivorAward]);
    await mysql.query(
      "INSERT INTO response_workspace_comments (id, intent_id, item_id, author_user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["comment_cross", survivorIntent, "item_1_1", "u_alice", "Cross link", SEED_AT, SEED_AT],
    );
    await mysql.query(
      "INSERT INTO response_workspace_item_artifacts (item_id, artifact_id, created_at) VALUES (?, ?, ?)",
      [survivorItem, "artifact_1", SEED_AT],
    );

    const result = await purgeDemoBids(target(), { apply: true });

    expect(result.deleted).toEqual({
      ...EXPECTED_DEMO_DEPENDENTS,
      response_workspace_comments: EXPECTED_DEMO_DEPENDENTS.response_workspace_comments + 1,
      response_workspace_item_artifacts: EXPECTED_DEMO_DEPENDENTS.response_workspace_item_artifacts + 1,
      bids: 4,
    });
    expect((await presentKeys("response_workspace_comments")).has("comment_cross")).toBe(false);
    expect((await presentKeys("response_workspace_item_artifacts")).has(`${survivorItem}|artifact_1`)).toBe(false);
    const [award] = await mysql.query("SELECT tabulation_artifact_id FROM award_outcomes WHERE id = ?", [survivorAward]);
    expect(award).toEqual([{ tabulation_artifact_id: null }]);
    expect(Object.values(await orphanCounts()).every((count) => count === 0)).toBe(true);
  });

  it("is not blocked by an orphan that was already there", async () => {
    const rows = buildDemoPurgeSeed();
    await seed(rows);
    await mysql.query(
      "INSERT INTO bid_attachments (id, bid_id, name, url, created_at) VALUES (?, ?, ?, ?, ?)",
      ["attachment_ghost", "a_bid_that_never_existed", "Ghost.pdf", "https://example.test/ghost.pdf", SEED_AT],
    );

    const result = await purgeDemoBids(target(), { apply: true });

    expect(result.applied).toBe(true);
    expect((await presentKeys("bid_attachments")).has("attachment_ghost")).toBe(true);
    expect((await orphanCounts())["bid_attachments.bid_id -> bids"]).toBe(1);
  });

  it("rolls the whole purge back when it would leave an orphan behind", async () => {
    const rows = buildDemoPurgeSeed();
    await seed(rows);
    // A trigger that re-creates an attachment for every bid that is deleted: the one thing a purge cannot undo
    // by itself, standing in for a writer that adds a row for a demo bid while the purge runs.
    await mysql.query("DROP TRIGGER IF EXISTS demo_purge_resurrect");
    await mysql.query(
      `CREATE TRIGGER demo_purge_resurrect AFTER DELETE ON bids FOR EACH ROW
         INSERT INTO bid_attachments (id, bid_id, name, url, created_at)
         VALUES (CONCAT('resurrected_', OLD.id), OLD.id, 'Late.pdf', 'https://example.test/late.pdf', OLD.created_at)`,
    );

    try {
      const failure = await purgeDemoBids(target(), { apply: true }).then(() => undefined, (error: unknown) => error);

      expect(failure).toBeInstanceOf(DemoPurgeError);
      expect((failure as DemoPurgeError).code).toBe("INTEGRITY_CHECK_FAILED");
      expect((failure as DemoPurgeError).message).toContain("bid_attachments.bid_id -> bids");
      await expectSeedState(rows, { purged: false });
      expect(await presentKeys("bids")).toEqual(new Set([...SURVIVOR_BID_IDS, ...DEMO_IDS_SORTED]));
      expect((await knowledgeLinks()).knowledge_1).toEqual({ bid: "1", intent: "intent_1" });
    } finally {
      await mysql.query("DROP TRIGGER IF EXISTS demo_purge_resurrect");
    }
  });

  it("purges the real data's size: 50 demo-readiness and 6 mock bids with every dependent", async () => {
    const rows = buildDemoPurgeSeed({ extraDemoReadiness: 48, extraMock: 4 });
    await seed(rows);

    const plan = await planDemoPurge(target());
    expect(plan.bids).toHaveLength(56);
    expect(plan.bids.filter((bid) => bid.kind === "demo_readiness")).toHaveLength(50);
    expect(plan.dependents).toEqual(expectedDemoDependents(56));
    expect(plan.knowledgeItemsToDetach).toBe(2 * 56);

    const result = await purgeDemoBids(target(), { apply: true });

    expect(result.deleted).toEqual({ ...expectedDemoDependents(56), bids: 56 });
    await expectSeedState(rows, { purged: true });
    expect(await presentKeys("bids")).toEqual(new Set(SURVIVOR_BID_IDS));
    expect(Object.values(await orphanCounts()).every((count) => count === 0)).toBe(true);
  }, 60_000);

  it("lists every dependent table the plan reports", async () => {
    await seed();

    const plan = await planDemoPurge(target());

    expect(Object.keys(plan.dependents)).toEqual(DEMO_PURGE_TABLES.map((entry) => entry.table));
  });
});
