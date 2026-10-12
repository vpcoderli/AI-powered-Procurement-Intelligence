import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../src/server/db/test-utils";
import { DEMO_PURGE_TABLES } from "../src/server/integrity/demo-purge";
import {
  EXPECTED_DEMO_DEPENDENTS,
  SURVIVOR_BID_IDS,
  buildDemoPurgeSeed,
  insertStatement,
} from "../src/server/integrity/demo-purge.fixtures";
import {
  PurgeDemoBidsUsageError,
  backupFileProblem,
  formatPurgeDemoBidsHelp,
  parsePurgeDemoBidsArgs,
  runPurgeDemoBids,
} from "./purge-demo-bids";

describe("purge-demo-bids arguments", () => {
  it("is a dry run by default", () => {
    expect(parsePurgeDemoBidsArgs([])).toEqual({ apply: false, backupFile: null, json: false, help: false });
  });

  it("reads --apply, --json and the backup file in both spellings", () => {
    expect(parsePurgeDemoBidsArgs(["--apply", "--json", "--backup-file", "dump.sql"])).toEqual({
      apply: true, backupFile: "dump.sql", json: true, help: false,
    });
    expect(parsePurgeDemoBidsArgs(["--backup-file=/tmp/dump.sql"]).backupFile).toBe("/tmp/dump.sql");
    expect(parsePurgeDemoBidsArgs(["-h"]).help).toBe(true);
    expect(parsePurgeDemoBidsArgs(["--help"]).help).toBe(true);
  });

  it("rejects what it does not know, and a backup flag without a path", () => {
    expect(() => parsePurgeDemoBidsArgs(["--force"])).toThrow(PurgeDemoBidsUsageError);
    expect(() => parsePurgeDemoBidsArgs(["--backup-file"])).toThrow("--backup-file requires a path");
    expect(() => parsePurgeDemoBidsArgs(["--backup-file", "--apply"])).toThrow("--backup-file requires a path");
    expect(() => parsePurgeDemoBidsArgs(["--backup-file="])).toThrow("--backup-file requires a path");
  });

  it("documents the flags, the exit codes, the history it leaves and the commands that re-create demo data", () => {
    const help = formatPurgeDemoBidsHelp();
    for (const text of [
      "--apply", "--backup-file", "--json", "Exit codes: 0 done, 1 error", "2 usage", "npm run db:backup", "mysqldump",
      "notification_outbox.matched_bid_ids", "search_alert_digest_runs.matched_bid_ids_json", "event_log.target_id",
      "ai_call_logs.metadata_json", "crawler_logs.metadata", "storage_path", "npm run demo:prepare",
      "npm run db:seed", "npm run db:mysql:import-sqlite", "winbids", "knowledge_items are kept",
    ]) {
      expect(help, text).toContain(text);
    }
  });
});

describe("purge-demo-bids", () => {
  let directory: string;
  let testDb: TestDatabase;
  let out: string[];
  let err: string[];
  const io = () => ({ stdout: (text: string) => out.push(text), stderr: (text: string) => err.push(text) });
  // Blank MySQL URLs: whatever the developer's shell exports, these tests only ever touch the temporary SQLite file.
  const testEnv = (databasePath: string): NodeJS.ProcessEnv => ({
    NODE_ENV: "test", DATABASE_URL: "", MYSQL_DATABASE_URL: "", DATABASE_PATH: databasePath,
  });
  const env = () => testEnv(testDb.databasePath);

  function backup(content = "-- dump\n") {
    const file = path.join(directory, "backup.sql");
    writeFileSync(file, content);
    return file;
  }

  function bidIds(): string[] {
    return (testDb.db.$client.prepare("SELECT id FROM bids ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id);
  }

  beforeEach(async () => {
    directory = mkdtempSync(path.join(tmpdir(), "apsi-purge-demo-"));
    testDb = await createTestDatabase();
    for (const row of buildDemoPurgeSeed()) {
      const { sql, params } = insertStatement(row);
      testDb.db.$client.prepare(sql).run(...params);
    }
    out = [];
    err = [];
  });

  afterEach(async () => {
    await testDb.cleanup();
    rmSync(directory, { recursive: true, force: true });
  });

  describe("backupFileProblem", () => {
    it("accepts only an existing, non-empty file", () => {
      expect(backupFileProblem(null)).toContain("--backup-file <path>");
      expect(backupFileProblem(null)).toContain("npm run db:backup");
      expect(backupFileProblem(path.join(directory, "missing.sql"))).toContain("does not exist");
      expect(backupFileProblem(directory)).toContain("is not a file");
      expect(backupFileProblem(backup(""))).toContain("is empty");
      expect(backupFileProblem(backup("-- dump\n"))).toBeNull();
    });
  });

  it("prints the help and exits 0", async () => {
    expect(await runPurgeDemoBids(["--help"], env(), io())).toBe(0);
    expect(out.join("\n")).toContain("Demo and seed bid purge");
  });

  it("exits 2 on a bad command line without opening the database", async () => {
    expect(await runPurgeDemoBids(["--wat"], testEnv(path.join(directory, "nope.sqlite")), io())).toBe(2);
    expect(err.join("\n")).toContain("Unknown argument: --wat");
    expect(out).toEqual([]);
  });

  it("exits 2 when --apply has no backup file, or one that is missing or empty, and changes nothing", async () => {
    const before = bidIds();

    expect(await runPurgeDemoBids(["--apply"], env(), io())).toBe(2);
    expect(err.join("\n")).toContain("Take a backup first");
    expect(err.join("\n")).toContain("npm run db:backup");

    err.length = 0;
    expect(await runPurgeDemoBids(["--apply", "--backup-file", path.join(directory, "missing.sql")], env(), io())).toBe(2);
    expect(err.join("\n")).toContain("does not exist");

    err.length = 0;
    expect(await runPurgeDemoBids(["--apply", "--backup-file", backup("")], env(), io())).toBe(2);
    expect(err.join("\n")).toContain("is empty");

    expect(bidIds()).toEqual(before);
    expect(out).toEqual([]);
  });

  it("prints the plan on a dry run and writes nothing", async () => {
    const before = bidIds();

    const code = await runPurgeDemoBids([], env(), io());

    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("dry run, nothing was written");
    expect(text).toContain(`Target: sqlite ${testDb.databasePath}`);
    expect(text).toContain("Demo bids: 4 (demo_readiness 2, mock_seed 2)");
    expect(text).toMatch(/bid_attachments\s+8\b/);
    expect(text).toMatch(/response_workspace_items\s+8\b/);
    expect(text).toMatch(/intent_to_bid\s+4\b/);
    expect(text).toContain("Knowledge items that lose a link to a demo bid or intent (kept): 8");
    expect(text).toContain("--apply --backup-file");
    expect(text).toContain("npm run db:backup");
    expect(text).toContain("notification_outbox.matched_bid_ids");
    expect(err).toEqual([]);
    expect(bidIds()).toEqual(before);
  });

  it("lists every table of the purge in the report, a table without rows included", async () => {
    // Nothing but one demo bid, with no dependents at all: every dependent table has zero rows.
    testDb.db.$client.exec(`
      DELETE FROM bids WHERE id <> '1';
      DELETE FROM intent_to_bid;
      DELETE FROM bid_attachments;
      DELETE FROM bid_field_corrections;
      DELETE FROM saved_bids;
    `);

    expect(await runPurgeDemoBids([], env(), io())).toBe(0);

    const text = out.join("\n");
    expect(text).toContain("Demo bids: 1 (demo_readiness 0, mock_seed 1)");
    for (const entry of DEMO_PURGE_TABLES) expect(text, entry.table).toMatch(new RegExp(`\\n  ${entry.table}\\s+\\d+\\n`));
    expect(text).toMatch(/\n  response_package_export_review_events\s+0\n/);
  });

  it("prints the same plan as JSON", async () => {
    const code = await runPurgeDemoBids(["--json"], env(), io());

    expect(code).toBe(0);
    const report = JSON.parse(out.join("\n"));
    expect(report).toMatchObject({
      target: `sqlite ${testDb.databasePath}`,
      mode: "dry-run",
      applied: false,
      byKind: { demo_readiness: 2, mock_seed: 2 },
      knowledgeItemsToDetach: 8,
      dependents: EXPECTED_DEMO_DEPENDENTS,
    });
    expect(report.bids.map((bid: { id: string }) => bid.id)).toEqual(["1", "2", "al_state_procurement_demo_readiness", "wa_state_procurement_demo_readiness"]);
    expect(report.deleted.bids).toBe(0);
  });

  it("applies with a backup file: deletes the demo bids and their dependents, and says so", async () => {
    const code = await runPurgeDemoBids(["--apply", "--backup-file", backup()], env(), io());

    expect(code).toBe(0);
    expect(bidIds().sort()).toEqual([...SURVIVOR_BID_IDS].sort());
    expect(testDb.db.$client.pragma("foreign_key_check")).toEqual([]);
    const text = out.join("\n");
    expect(text).toContain("APPLIED");
    expect(text).toContain("Rows deleted with them:");
    expect(text).toContain("Do not run npm run demo:prepare");
    expect(text).toMatch(/bid_attachments\s+8\b/);
    const dependentRows = Object.values(EXPECTED_DEMO_DEPENDENTS).reduce((sum, count) => sum + count, 0);
    expect(text).toContain(`Deleted 4 bids and ${dependentRows} dependent rows in one transaction.`);
  });

  it("applies as JSON, and a second apply finds nothing to do", async () => {
    expect(await runPurgeDemoBids(["--apply", "--json", "--backup-file", backup()], env(), io())).toBe(0);
    const applied = JSON.parse(out.join("\n"));
    expect(applied).toMatchObject({ mode: "apply", applied: true, deleted: { ...EXPECTED_DEMO_DEPENDENTS, bids: 4 } });

    out.length = 0;
    expect(await runPurgeDemoBids(["--apply", "--backup-file", backup()], env(), io())).toBe(0);
    expect(out.join("\n")).toContain("--apply found nothing to purge");
    expect(out.join("\n")).toContain("No demo or seed bids found; nothing to purge.");
    expect(out.join("\n")).not.toContain("dry run");
  });

  it("exits 1, with the reason on stderr, when the database file is not there", async () => {
    const missing = path.join(directory, "elsewhere", "apsi.sqlite");
    mkdirSync(path.dirname(missing));

    expect(await runPurgeDemoBids([], testEnv(missing), io())).toBe(1);
    expect(err.join("\n")).toContain(`SQLite database not found: ${missing}`);
    expect(out).toEqual([]);
  });

  it("exits 1 and changes nothing when the integrity check refuses the purge", async () => {
    const sqlite = testDb.db.$client;
    sqlite.exec("CREATE TABLE unlisted_child (id TEXT PRIMARY KEY, bid_id TEXT REFERENCES bids(id) DEFERRABLE INITIALLY DEFERRED)");
    sqlite.prepare("INSERT INTO unlisted_child (id, bid_id) VALUES (?, ?)").run("u1", "1");
    const before = bidIds();

    expect(await runPurgeDemoBids(["--apply", "--backup-file", backup()], env(), io())).toBe(1);

    expect(err.join("\n")).toContain("unlisted_child");
    expect(out).toEqual([]);
    expect(bidIds()).toEqual(before);
  });
});
