import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bids } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { openResolvedTarget } from "@/server/integrity/open-target";
import { formatSweepUsage, runSweepBidLifecycle, type SweepBidLifecycleOpen } from "./sweep-bid-lifecycle";

/**
 * The sweep script on a SQLite file, in a process of its own and in this one: its flags, its output, its exit status, and
 * what it may and may not touch. The sweep's own behavior is covered where it lives (src/server/bids/lifecycle-sweep*.test.ts);
 * how it reaches MySQL, and that it exits when MySQL refuses it, is covered by mysql-pool-exit.test.ts.
 */

const frontendDir = fileURLToPath(new URL("..", import.meta.url));
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const SEEDED_AT = "2026-01-01T00:00:00.000Z";
const NOW = new Date("2026-10-13T12:00:00.000Z");

/** Deadlines far from any clock this suite will run on: long past, far ahead, and unreadable. */
const ROWS = [
  { id: "state_a:1", issuerType: "state", deadline: "01/01/2020" },
  { id: "state_a:2", issuerType: "state", deadline: "2020-06-30" },
  { id: "county_b:1", issuerType: "county", deadline: "03/15/20" },
  { id: "state_a:3", issuerType: "state", deadline: "01/01/2090" },
  { id: "state_a:4", issuerType: "state", deadline: "Not Available" },
  { id: "state_a:5", issuerType: "state", deadline: null },
];

function insertBid(testDb: TestDatabase, row: { id: string; issuerType: string; deadline: string | null }, extra: Partial<typeof bids.$inferInsert> = {}) {
  testDb.db.insert(bids).values({
    id: row.id, source: row.id.split(":")[0], sourceBidId: row.id, dedupeKey: row.id, title: "Road repair", description: "Repair the road.",
    deadlineDate: row.deadline, issuerName: "Agency", issuerType: row.issuerType, stateCode: "CO", sourceUrl: `https://portal.example.gov/${row.id}`,
    rawPayload: JSON.stringify({ id: row.id }), firstSeenAt: SEEDED_AT, lastSeenAt: SEEDED_AT, createdAt: SEEDED_AT, updatedAt: SEEDED_AT,
    ...extra,
  }).run();
}

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** What a process printed, one string per stream (the two pipes are read independently: never look at them as one text). */
interface ProcessRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** The script in a fresh process started in `cwd`, which importing the app's db/client would leave a data/apsi.sqlite in. */
function runIn(cwd: string, args: string[], env: Record<string, string> = {}): Promise<ProcessRun> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", tsxLoader, path.join(frontendDir, "scripts", "sweep-bid-lifecycle.ts"), ...args], {
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
    const deadline = setTimeout(() => child.kill("SIGKILL"), 40_000);
    child.on("close", (status) => {
      clearTimeout(deadline);
      resolve({ status, stdout, stderr });
    });
  });
}

/** A directory below `root` that is deeper than the frontend directory is. */
function deepWorkingDirectory(root: string): string {
  const depth = frontendDir.split(path.sep).filter(Boolean).length + 2;
  const deep = path.join(root, ...Array.from({ length: depth }, () => "d"));
  mkdirSync(deep, { recursive: true });
  return deep;
}

describe("scripts/sweep-bid-lifecycle.ts", () => {
  let testDb: TestDatabase;
  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    for (const row of ROWS) insertBid(testDb, row);
  });
  afterEach(async () => { await testDb.cleanup(); });

  function run(...flags: string[]) {
    const child = spawnSync(process.execPath, ["--import", "tsx", "scripts/sweep-bid-lifecycle.ts", ...flags], {
      cwd: frontendDir,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, NODE_ENV: "test", DATABASE_PATH: testDb.databasePath, DATABASE_URL: "", MYSQL_DATABASE_URL: "" },
    });
    return { status: child.status, stdout: child.stdout, stderr: child.stderr };
  }
  const statuses = () => Object.fromEntries(testDb.db.select().from(bids).all().map((row) => [row.id, row.lifecycleStatus]));

  it("prints what it would close on --dry-run --json and writes nothing", () => {
    const { status, stdout } = run("--dry-run", "--json");

    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ scanned: 6, closed: 3, unparseable: 1, closedByIssuerType: { state: 2, county: 1 }, dryRun: true });
    expect(Object.values(statuses()).every((value) => value === "open")).toBe(true);
  });

  it("closes the expired bids and prints a summary of scanned, closed, unparseable and the issuer types", () => {
    const { status, stdout } = run();

    expect(status).toBe(0);
    expect(stdout).toContain("scanned: 6");
    expect(stdout).toContain("closed: 3");
    expect(stdout).toContain("unparseable: 1");
    expect(stdout).toMatch(/closed by issuer type:\n {2}state: 2\n {2}county: 1/);
    expect(stdout).not.toContain("dry run");
    expect(statuses()).toEqual({ "state_a:1": "closed", "state_a:2": "closed", "county_b:1": "closed", "state_a:3": "open", "state_a:4": "open", "state_a:5": "open" });
    const closed = testDb.db.select().from(bids).where(eq(bids.id, "state_a:1")).get()!;
    expect(JSON.parse(closed.rawPayload!)).toMatchObject({ id: "state_a:1", lifecycle: { closed_reason: "deadline_passed", deadline: "01/01/2020" } });
  });

  it("says so in the summary when it is a dry run", () => {
    const { status, stdout } = run("--dry-run");

    expect(status).toBe(0);
    expect(stdout).toContain("dry run");
    expect(stdout).toContain("closed: 3 (would be closed)");
  });

  it("finds nothing to close on a second run and reports that as JSON", () => {
    expect(run().status).toBe(0);
    const { status, stdout } = run("--json");

    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ scanned: 3, closed: 0, unparseable: 1, closedByIssuerType: {}, dryRun: false });
  });

  it("refuses an option it does not know instead of sweeping for real, and exits 1", () => {
    const { status, stdout, stderr } = run("--dryrun");

    expect(status).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("Unknown option --dryrun");
    expect(Object.values(statuses()).every((value) => value === "open")).toBe(true);
  });
});

describe("the sweep script, run in this process", () => {
  let testDb: TestDatabase;
  let scratch: string;
  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    for (const row of ROWS) insertBid(testDb, row);
    scratch = mkdtempSync(path.join(tmpdir(), "apsi-sweep-scratch-"));
  });
  afterEach(async () => {
    await testDb.cleanup();
    rmSync(scratch, { recursive: true, force: true });
  });

  async function inProcess(argv: string[], env: Record<string, string>, open?: SweepBidLifecycleOpen) {
    const out: string[] = [];
    const err: string[] = [];
    const status = await runSweepBidLifecycle(
      argv,
      { NODE_ENV: "test", DATABASE_URL: "", MYSQL_DATABASE_URL: "", ...env },
      { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
      { now: () => NOW },
      open,
    );
    return { status, out, err, stdout: out.join("\n"), stderr: err.join("\n") };
  }

  /** The real opener, with a look at the connection it hands out: whether it can write, and how many rows it changed by the end. */
  function observing() {
    const seen: { readonly?: boolean; totalChanges?: number } = {};
    const open: SweepBidLifecycleOpen = async (resolved, options) => {
      const opened = await openResolvedTarget(resolved, options);
      const client = (opened.target as { database: { $client: Database.Database } }).database.$client;
      seen.readonly = client.readonly;
      return {
        ...opened,
        close: async () => {
          seen.totalChanges = (client.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
          await opened.close();
        },
      };
    };
    return { seen, open };
  }

  describe("on SQLite", () => {
    it("opens the file read-only on --dry-run and leaves it as it was: no change, no byte, no growth of the -wal", async () => {
      // Everything the setup wrote is in the main file, so that anything the run writes shows up there or in the -wal.
      testDb.db.$client.pragma("wal_checkpoint(TRUNCATE)");
      const wal = `${testDb.databasePath}-wal`;
      const before = { hash: sha256(testDb.databasePath), size: statSync(testDb.databasePath).size, wal: existsSync(wal) ? statSync(wal).size : 0 };
      const { seen, open } = observing();

      const result = await inProcess(["--dry-run", "--json"], { DATABASE_PATH: testDb.databasePath }, open);

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ scanned: 6, closed: 3, unparseable: 1, closedByIssuerType: { state: 2, county: 1 }, dryRun: true });
      expect(seen.readonly).toBe(true);
      expect(seen.totalChanges).toBe(0);
      expect({ hash: sha256(testDb.databasePath), size: statSync(testDb.databasePath).size, wal: existsSync(wal) ? statSync(wal).size : 0 }).toEqual(before);
    });

    it("opens it writable for the real sweep, which changes exactly the rows it closes", async () => {
      const { seen, open } = observing();

      const result = await inProcess(["--json"], { DATABASE_PATH: testDb.databasePath }, open);

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ closed: 3, dryRun: false });
      expect(seen.readonly).toBe(false);
      expect(seen.totalChanges).toBe(3);
    });

    it("names its target on stderr, first and as the other integrity tools do, and keeps stdout to the result alone", async () => {
      const result = await inProcess(["--dry-run", "--json"], { DATABASE_PATH: testDb.databasePath });

      expect(result.err[0]).toBe(`Target: sqlite ${testDb.databasePath}`);
      expect(JSON.parse(result.stdout).scanned).toBe(6);
    });

    it.each([
      ["a database with no tables", (file: string) => writeFileSync(file, "")],
      ["a bids table from before the lifecycle columns", (file: string) => {
        const old = new Database(file);
        old.exec("CREATE TABLE bids (id TEXT PRIMARY KEY, title TEXT, deadline_date TEXT)");
        old.close();
      }],
    ])("exits 2 on %s, says to run the migration first, and leaves the file and its directory exactly as they were", async (_name, build) => {
      const directory = mkdtempSync(path.join(scratch, "unmigrated-"));
      const file = path.join(directory, "apsi.sqlite");
      build(file);
      const before = { hash: sha256(file), size: statSync(file).size, files: readdirSync(directory) };

      for (const argv of [["--dry-run"], []]) {
        const result = await inProcess(argv, { DATABASE_PATH: file });

        expect(result.status).toBe(2);
        expect(result.stderr).toContain("npm run db:migrate");
        expect(result.stderr).toContain("never migrates");
        expect(result.stdout).toBe("");
        expect({ hash: sha256(file), size: statSync(file).size, files: readdirSync(directory) }).toEqual(before);
      }
    });

    it("exits 2 on a file that is not there, and creates nothing", async () => {
      const missing = path.join(scratch, "nope.sqlite");

      for (const argv of [["--dry-run"], []]) {
        const result = await inProcess(argv, { DATABASE_PATH: missing });

        expect(result.status).toBe(2);
        expect(result.stderr).toContain(`SQLite database not found: ${missing}`);
        expect(result.stderr).toContain("Nothing was created");
        expect(result.stdout).toBe("");
        expect(readdirSync(scratch)).toEqual([]);
      }
    });

    it("exits 2 when DATABASE_PATH is a directory", async () => {
      const result = await inProcess([], { DATABASE_PATH: scratch });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("is a directory");
    });
  });

  describe("on MySQL, with a pool that records what it is sent", () => {
    const MYSQL_ENV = { DATABASE_URL: "mysql://sweeper:secret@127.0.0.1:1/apsi" };
    const OPEN_ROWS = [
      { id: "state_a:1", deadline_date: "01/01/2020", issuer_type: "state" },
      { id: "state_a:3", deadline_date: "01/01/2090", issuer_type: "state" },
    ];

    /** A pool and its connection, which keep every statement they are sent, and how many connections were taken. */
    function recordingPool(failWith?: Error) {
      const statements: Array<{ through: "pool" | "connection"; sql: string }> = [];
      let connections = 0;
      const connection = {
        beginTransaction: async () => { statements.push({ through: "connection", sql: "BEGIN" }); },
        commit: async () => { statements.push({ through: "connection", sql: "COMMIT" }); },
        rollback: async () => { statements.push({ through: "connection", sql: "ROLLBACK" }); },
        release: () => undefined,
        // The read under the lock: the expired bid, with its payload.
        query: async (sql: string) => { statements.push({ through: "connection", sql }); return [[{ ...OPEN_ROWS[0], raw_payload: JSON.stringify({ id: "state_a:1" }) }], undefined]; },
        execute: async (sql: string) => { statements.push({ through: "connection", sql }); return [{ affectedRows: 1, insertId: 0 }, undefined]; },
      };
      const pool = {
        query: async (sql: string) => {
          statements.push({ through: "pool", sql });
          if (failWith) throw failWith;
          return [OPEN_ROWS, undefined];
        },
        getConnection: async () => { connections += 1; return connection; },
      };
      return { pool, statements, connections: () => connections };
    }

    const standIn = (pool: unknown): SweepBidLifecycleOpen => async (resolved) => {
      expect(resolved.kind).toBe("mysql");
      return { target: { mysql: pool as never }, description: "mysql mysql://sweeper:***@127.0.0.1:1/apsi", close: async () => undefined };
    };

    it("issues nothing but SELECTs on --dry-run, and never takes a connection to open a transaction on", async () => {
      const { pool, statements, connections } = recordingPool();

      const result = await inProcess(["--dry-run", "--json"], MYSQL_ENV, standIn(pool));

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ scanned: 2, closed: 1, dryRun: true });
      expect(statements.length).toBeGreaterThan(0);
      expect(statements.every(({ through, sql }) => through === "pool" && /^\s*SELECT\b/i.test(sql))).toBe(true);
      expect(connections()).toBe(0);
      expect(result.err[0]).toBe("Target: mysql mysql://sweeper:***@127.0.0.1:1/apsi");
    });

    it("writes, inside one transaction, only without --dry-run (so the recording above would see a write)", async () => {
      const { pool, statements, connections } = recordingPool();

      const result = await inProcess(["--json"], MYSQL_ENV, standIn(pool));

      expect(result.status).toBe(0);
      expect(connections()).toBe(1);
      const written = statements.filter(({ sql }) => !/^\s*SELECT\b/i.test(sql)).map(({ sql }) => sql.split(" ").slice(0, 3).join(" "));
      expect(written).toEqual(["BEGIN", "UPDATE bids SET", "COMMIT"]);
    });

    it("exits 1 when MySQL refuses the connection, and 2 when its schema is not migrated, saying which migration to run", async () => {
      const refused = await inProcess(["--dry-run"], MYSQL_ENV, standIn(recordingPool(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" })).pool));
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("ECONNREFUSED");

      for (const code of ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"]) {
        const unmigrated = await inProcess(["--dry-run"], MYSQL_ENV, standIn(recordingPool(Object.assign(new Error("Unknown column 'lifecycle_status' in 'where clause'"), { code })).pool));
        expect(unmigrated.status, code).toBe(2);
        expect(unmigrated.stderr, code).toContain("npm run db:mysql:migrate");
        expect(unmigrated.stderr, code).toContain("never migrates");
      }
    });
  });

  it("says in its usage text what the options do, how the target is chosen and what the exit codes are", () => {
    const usage = formatSweepUsage().replace(/\s+/g, " ");

    for (const text of ["--dry-run", "--json", "read-only", "only SELECT", "never migrates", "npm run db:migrate", "npm run db:mysql:migrate",
      "frontend/", "Exit codes: 0", "1 ", "2 "]) {
      expect(usage, text).toContain(text);
    }
  });
});

describe("the sweep script as a process of its own", () => {
  let workingDirectory: string;
  let testDb: TestDatabase;
  beforeEach(async () => {
    workingDirectory = mkdtempSync(path.join(tmpdir(), "apsi-sweep-cwd-"));
    testDb = await createTestDatabase({ seed: false });
    for (const row of ROWS) insertBid(testDb, row);
  });
  afterEach(async () => {
    await testDb.cleanup();
    rmSync(workingDirectory, { recursive: true, force: true });
  });

  it("creates nothing in the directory it is run from, dry run or not: importing the app's db/client would leave data/apsi.sqlite there", async () => {
    for (const argv of [["--dry-run", "--json"], ["--json"]]) {
      const run = await runIn(workingDirectory, argv, { DATABASE_PATH: testDb.databasePath });

      expect(run.status, run.stderr).toBe(0);
      expect(readdirSync(workingDirectory)).toEqual([]);
    }
  }, 60_000);

  it("never migrates: a legacy row the migrations would fix is left as it is, by a dry run and by the real sweep", async () => {
    // runMigrations closes an open row that is not active (migrate.ts), whatever the flags. The sweep must not run it.
    insertBid(testDb, { id: "state_a:legacy", issuerType: "state", deadline: "01/01/2090" }, { isActive: 0, lifecycleStatus: "open" });
    const legacy = () => testDb.db.select().from(bids).where(eq(bids.id, "state_a:legacy")).get()!;

    for (const argv of [["--dry-run"], []]) {
      const run = await runIn(workingDirectory, argv, { DATABASE_PATH: testDb.databasePath });

      expect(run.status, run.stderr).toBe(0);
      expect(legacy()).toMatchObject({ lifecycleStatus: "open", isActive: 0, updatedAt: SEEDED_AT });
    }
  }, 60_000);

  it("exits 2 on a file that is not there and creates nothing, not even the file it was pointed at", async () => {
    const elsewhere = mkdtempSync(path.join(tmpdir(), "apsi-sweep-missing-"));
    const missing = path.join(elsewhere, "nope.sqlite");
    try {
      const run = await runIn(workingDirectory, [], { DATABASE_PATH: missing });

      expect(run.status).toBe(2);
      expect(run.stderr).toContain(`SQLite database not found: ${missing}`);
      expect(run.stdout).toBe("");
      expect(readdirSync(workingDirectory)).toEqual([]);
      expect(readdirSync(elsewhere)).toEqual([]);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  }, 60_000);

  it("reads a relative DATABASE_PATH from the frontend directory, whatever directory it is run from", async () => {
    const relative = path.relative(frontendDir, testDb.databasePath);
    expect(path.isAbsolute(relative)).toBe(false);
    // Deeper than the frontend directory, so that the ".." segments of the relative path cannot climb onto the right file by luck.
    const deep = deepWorkingDirectory(workingDirectory);
    expect(path.resolve(deep, relative)).not.toBe(testDb.databasePath);

    const run = await runIn(deep, ["--dry-run", "--json"], { DATABASE_PATH: relative });

    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).toContain(`Target: sqlite ${testDb.databasePath}`);
    expect(JSON.parse(run.stdout).scanned).toBe(6);
    expect(readdirSync(workingDirectory)).toEqual(["d"]);
  }, 60_000);
});
