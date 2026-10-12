import { spawn } from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../src/server/db/test-utils";
import { DEMO_PURGE_TABLES } from "../src/server/integrity/demo-purge";
import {
  EXPECTED_DEMO_DEPENDENTS,
  EXPECTED_DEMO_DETACHMENTS,
  REAL_BID_ID,
  SURVIVOR_BID_IDS,
  buildDemoPurgeSeed,
  insertStatement,
  seedTag,
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

  // What --help and the header of demo-purge.ts must both say about the maintenance window, wording and all.
  const MAINTENANCE_WINDOW = [
    "A maintenance window is required on MySQL: stop the web app AND every worker first.",
    "MySQL has no foreign keys",
    "(a save, an intent, a workspace edit)",
    "would be an orphan",
    "SQLite is protected by",
    "BEGIN IMMEDIATE",
    "plus the foreign keys the app enforces",
  ];
  // Wordings that made one of the two texts contradict the other: a window for everyone, or none for SQLite.
  const CONTRADICTIONS = [
    "Run it in a maintenance window", "RUN IT IN A MAINTENANCE WINDOW", "needs no such window", "Run it with the workers stopped",
  ];

  it("says in --help that a maintenance window is required on MySQL, and that SQLite is protected without one", () => {
    const help = formatPurgeDemoBidsHelp().replace(/\s+/g, " ");

    for (const text of MAINTENANCE_WINDOW) expect(help, text).toContain(text);
    for (const text of CONTRADICTIONS) expect(help, text).not.toContain(text);
    expect(help).toContain("orphan after the commit");
  });

  it("says the same in the header of demo-purge.ts", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/server/integrity/demo-purge.ts", import.meta.url)), "utf8");
    const header = source.slice(0, source.indexOf("*/")).replace(/\n \*[ ]?/g, " ").replace(/\s+/g, " ");

    for (const text of MAINTENANCE_WINDOW) expect(header, text).toContain(text);
    for (const text of CONTRADICTIONS) expect(header, text).not.toContain(text);
    expect(header).toContain("`.immediate()`");
    expect(header).toContain("would be an orphan once the purge commits");
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

    it("refuses the SQLite database itself as the backup, however its path is spelled", () => {
      const database = testDb.databasePath;
      const itself = "is the SQLite database itself, not a backup of it";
      expect(backupFileProblem(database, database)).toContain(itself);
      expect(backupFileProblem(path.relative(process.cwd(), database), database)).toContain(itself);
      expect(backupFileProblem(path.join(path.dirname(database), ".", path.basename(database)), database)).toContain(itself);
      expect(backupFileProblem(database, database)).toContain("npm run db:backup");
      // A symbolic link and a hard link are the same file.
      const symbolic = path.join(directory, "symbolic.sqlite");
      symlinkSync(database, symbolic);
      expect(backupFileProblem(symbolic, database)).toContain(itself);
      const hard = path.join(directory, "hard.sqlite");
      linkSync(database, hard);
      expect(backupFileProblem(hard, database)).toContain(itself);
      // Any other non-empty file is accepted, and on MySQL there is no database file to compare with.
      expect(backupFileProblem(backup(), database)).toBeNull();
      expect(backupFileProblem(backup(), null)).toBeNull();
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

  it("exits 2 when --backup-file is the database itself, and changes nothing", async () => {
    const before = bidIds();

    expect(await runPurgeDemoBids(["--apply", "--backup-file", testDb.databasePath], env(), io())).toBe(2);

    expect(err.join("\n")).toContain("is the SQLite database itself, not a backup of it");
    expect(err.join("\n")).toContain("npm run db:backup");
    expect(out).toEqual([]);
    expect(bidIds()).toEqual(before);
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
    expect(text).toMatch(/Links set to NULL on rows that are kept:\n  knowledge_items\.source_bid_id\s+4\n  knowledge_items\.source_intent_id\s+8\n  award_outcomes\.tabulation_artifact_id\s+0\n/);
    expect(text).toContain("Knowledge items that lose a link to a demo bid or intent (kept): 8");
    expect(text).toContain("--apply --backup-file");
    expect(text).toContain("npm run db:backup");
    expect(text).toContain("notification_outbox.matched_bid_ids");
    expect(err).toEqual([`Target: sqlite ${testDb.databasePath}`]);
    expect(bidIds()).toEqual(before);
  });

  /** A kept award outcome that borrowed a demo artifact as its tabulation sheet. */
  function borrowDemoArtifact() {
    testDb.db.$client.prepare("UPDATE award_outcomes SET tabulation_artifact_id = ? WHERE id = ?")
      .run("artifact_1", `award_${seedTag(REAL_BID_ID)}`);
  }

  it("lists in a dry run the link of a kept award outcome that names a purged artifact", async () => {
    borrowDemoArtifact();

    expect(await runPurgeDemoBids([], env(), io())).toBe(0);
    expect(out.join("\n")).toMatch(/Links set to NULL on rows that are kept:\n[\s\S]*\n  award_outcomes\.tabulation_artifact_id\s+1\n/);

    out.length = 0;
    expect(await runPurgeDemoBids(["--json"], env(), io())).toBe(0);
    const planned = JSON.parse(out.join("\n"));
    expect(planned.detachments).toEqual({ ...EXPECTED_DEMO_DETACHMENTS, "award_outcomes.tabulation_artifact_id": 1 });
    expect(Object.values(planned.detached).every((count) => count === 0)).toBe(true);
  });

  it("reports the links it set to NULL on rows that stay, under the same heading as the plan", async () => {
    borrowDemoArtifact();

    expect(await runPurgeDemoBids(["--apply", "--backup-file", backup()], env(), io())).toBe(0);

    expect(out.join("\n")).toMatch(/Links set to NULL on rows that are kept:\n  knowledge_items\.source_bid_id\s+4\n  knowledge_items\.source_intent_id\s+8\n  award_outcomes\.tabulation_artifact_id\s+1\n/);
  });

  it("says which database it hit before it plans, so even a failed run names it", async () => {
    const empty = path.join(directory, "empty.sqlite");
    writeFileSync(empty, "");

    expect(await runPurgeDemoBids([], testEnv(empty), io())).toBe(1);

    expect(err).toEqual([`Target: sqlite ${empty}`, "no such table: data_sources"]);
    expect(out).toEqual([]);
  });

  it("keeps the target off stdout, so --json stays a single JSON document", async () => {
    expect(await runPurgeDemoBids(["--json"], env(), io())).toBe(0);

    expect(err).toEqual([`Target: sqlite ${testDb.databasePath}`]);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]).target).toBe(`sqlite ${testDb.databasePath}`);
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
    expect(applied).toMatchObject({
      mode: "apply", applied: true, deleted: { ...EXPECTED_DEMO_DEPENDENTS, bids: 4 }, detached: EXPECTED_DEMO_DETACHMENTS,
    });

    out.length = 0;
    expect(await runPurgeDemoBids(["--apply", "--backup-file", backup()], env(), io())).toBe(0);
    expect(out.join("\n")).toContain("--apply found nothing to purge");
    expect(out.join("\n")).toContain("No demo or seed bids found; nothing to purge.");
    expect(out.join("\n")).not.toContain("dry run");
  });

  it("exits 2 with a clear message, and creates nothing, when the database file is not there", async () => {
    const elsewhere = path.join(directory, "elsewhere");
    mkdirSync(elsewhere);
    const missing = path.join(elsewhere, "apsi.sqlite");

    expect(await runPurgeDemoBids([], testEnv(missing), io())).toBe(2);
    expect(await runPurgeDemoBids(["--apply", "--backup-file", backup()], testEnv(missing), io())).toBe(2);

    expect(err).toHaveLength(2);
    for (const line of err) {
      expect(line).toContain(`SQLite database not found: ${missing}`);
      expect(line).toContain("DATABASE_PATH");
      expect(line).toContain("Nothing was created");
    }
    expect(out).toEqual([]);
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("exits 1 and changes nothing when the integrity check refuses the purge", async () => {
    const sqlite = testDb.db.$client;
    sqlite.exec("CREATE TABLE unlisted_child (id TEXT PRIMARY KEY, bid_id TEXT REFERENCES bids(id) DEFERRABLE INITIALLY DEFERRED)");
    sqlite.prepare("INSERT INTO unlisted_child (id, bid_id) VALUES (?, ?)").run("u1", "1");
    const before = bidIds();

    expect(await runPurgeDemoBids(["--apply", "--backup-file", backup()], env(), io())).toBe(1);

    expect(err[0]).toBe(`Target: sqlite ${testDb.databasePath}`);
    expect(err.join("\n")).toContain("unlisted_child");
    expect(out).toEqual([]);
    expect(bidIds()).toEqual(before);
  });
});

/* A fresh process in a directory of its own: importing the app's db/client creates <cwd>/data/apsi.sqlite as a side
 * effect, and only a real process can show that the script no longer does. */

const frontendDir = fileURLToPath(new URL("..", import.meta.url));
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

/**
 * What a process printed, one string per stream. The two pipes are read independently, so no order between them is
 * defined: a test must never look at them as one text (a JSON document on stdout followed by the `Target:` line of
 * stderr is not JSON, and neither is it when stderr is read first).
 */
interface ProcessRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runScriptIn(cwd: string, args: string[], env: Record<string, string> = {}): Promise<ProcessRun> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", tsxLoader, path.join(frontendDir, "scripts", "purge-demo-bids.ts"), ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: "",
        MYSQL_DATABASE_URL: "",
        DATABASE_PATH: "",
        // tsx takes its tsconfig (the @/ alias) from the working directory, which has none: use the project's.
        TSX_TSCONFIG_PATH: path.join(frontendDir, "tsconfig.json"),
        ...env,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => (stdout += chunk));
    child.stderr?.on("data", (chunk: string) => (stderr += chunk));
    const deadline = setTimeout(() => child.kill("SIGKILL"), 25_000);
    // "close" comes after the process has exited and both pipes have ended, so both strings are complete.
    child.on("close", (status) => {
      clearTimeout(deadline);
      resolve({ status, stdout, stderr });
    });
  });
}

describe("purge-demo-bids as a process of its own", () => {
  let workingDirectory: string;

  beforeEach(() => {
    workingDirectory = mkdtempSync(path.join(tmpdir(), "apsi-purge-cwd-"));
  });

  afterEach(() => {
    rmSync(workingDirectory, { recursive: true, force: true });
  });

  it("exits 2 and leaves a directory without a database exactly as it was", async () => {
    const run = await runScriptIn(workingDirectory, []);

    // Importing the app's db/client would have created data/apsi.sqlite here by now.
    expect(readdirSync(workingDirectory)).toEqual([]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("SQLite database not found");
    expect(run.stderr).not.toContain("no such table");
    expect(run.stdout).toBe("");
  }, 40_000);

  it("leaves the working directory alone even when the database it was given exists", async () => {
    const testDb = await createTestDatabase();
    try {
      for (const row of buildDemoPurgeSeed()) {
        const { sql, params } = insertStatement(row);
        testDb.db.$client.prepare(sql).run(...params);
      }

      const run = await runScriptIn(workingDirectory, ["--json"], { DATABASE_PATH: testDb.databasePath });

      expect(readdirSync(workingDirectory)).toEqual([]);
      expect(run.status).toBe(0);
      // stdout alone is the report, one JSON document; the target is on stderr.
      const report = JSON.parse(run.stdout);
      expect(report.bids).toHaveLength(4);
      expect(report.target).toBe(`sqlite ${testDb.databasePath}`);
      expect(run.stderr).toContain(`Target: sqlite ${testDb.databasePath}`);
    } finally {
      await testDb.cleanup();
    }
  }, 40_000);
});
