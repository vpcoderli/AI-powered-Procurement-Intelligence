import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../src/server/db/test-utils";
import { buildIntegrityReport, parseIntegritySnapshot, type IntegrityReport } from "../src/server/integrity/data-integrity";
import { EXPECTED_LEVELS, INTEGRITY_NOW, buildIntegritySeed, insertSql } from "../src/server/integrity/data-integrity.fixtures";
import {
  DataIntegrityUsageError,
  formatDataIntegrityHelp,
  formatIntegrityReport,
  openTarget,
  parseDataIntegrityArgs,
  resolveTarget,
  runDataIntegrity,
} from "./data-integrity";

describe("data-integrity arguments", () => {
  it("is a plain report by default", () => {
    expect(parseDataIntegrityArgs([])).toEqual({ json: false, snapshot: null, compare: null, allowRemoved: [], help: false });
  });

  it("reads every flag, in both spellings, and --allow-removed more than once", () => {
    expect(parseDataIntegrityArgs(["--json", "--snapshot", "before.json"])).toMatchObject({ json: true, snapshot: "before.json" });
    expect(parseDataIntegrityArgs(["--snapshot=before.json"]).snapshot).toBe("before.json");
    expect(parseDataIntegrityArgs(["--compare", "before.json", "--allow-removed", "^ny_", "--allow-removed=^tx_"])).toMatchObject({
      compare: "before.json", allowRemoved: ["^ny_", "^tx_"],
    });
    expect(parseDataIntegrityArgs(["--compare=before.json"]).compare).toBe("before.json");
    expect(parseDataIntegrityArgs(["-h"]).help).toBe(true);
    expect(parseDataIntegrityArgs(["--help"]).help).toBe(true);
  });

  it("allows a snapshot to be written in the same run as a compare", () => {
    expect(parseDataIntegrityArgs(["--compare", "a.json", "--snapshot", "b.json"])).toMatchObject({ compare: "a.json", snapshot: "b.json" });
  });

  it("rejects what it does not know, a flag without its value, a flag given twice, and a pattern that is not a regular expression", () => {
    expect(() => parseDataIntegrityArgs(["--apply"])).toThrow(DataIntegrityUsageError);
    expect(() => parseDataIntegrityArgs(["--apply"])).toThrow("Unknown argument: --apply");
    expect(() => parseDataIntegrityArgs(["--snapshot"])).toThrow("--snapshot requires a file path");
    expect(() => parseDataIntegrityArgs(["--snapshot", "--json"])).toThrow("--snapshot requires a file path");
    expect(() => parseDataIntegrityArgs(["--compare="])).toThrow("--compare requires a file path");
    expect(() => parseDataIntegrityArgs(["--compare", "a.json", "--allow-removed"])).toThrow("--allow-removed requires a regular expression");
    expect(() => parseDataIntegrityArgs(["--snapshot", "a", "--snapshot", "b"])).toThrow("--snapshot was given twice");
    expect(() => parseDataIntegrityArgs(["--compare", "a", "--compare", "b"])).toThrow("--compare was given twice");
    expect(() => parseDataIntegrityArgs(["--compare", "a", "--allow-removed", "("])).toThrow("not a valid regular expression");
  });

  it("refuses --allow-removed without --compare, where there is nothing to allow", () => {
    expect(() => parseDataIntegrityArgs(["--allow-removed", "^ny_"])).toThrow("--allow-removed only applies with --compare");
  });

  it("documents the flags, the exit codes, the rules of the compare, the read-only promise and the metrics", () => {
    const help = formatDataIntegrityHelp();
    for (const text of [
      "--json", "--snapshot", "--compare", "--allow-removed", "repeatable", "Exit codes: 0", "1 ", "2 usage",
      "never writes to the database", "removed", "visibility regression", "identityMismatch", "warns",
      "DATABASE_PATH", "data/apsi.sqlite", "READ ONLY", "will not overwrite", "demoLike", "detailLockedAtSource",
      "malformedNyIds", "openVisible", "unanchored",
    ]) {
      expect(help, text).toContain(text);
    }
  });
});

describe("data-integrity target", () => {
  it("is MySQL when a mysql:// URL is set, otherwise the SQLite file DATABASE_PATH names (default data/apsi.sqlite)", () => {
    const env = (values: Record<string, string>): NodeJS.ProcessEnv => ({ NODE_ENV: "test", ...values });
    expect(resolveTarget(env({ DATABASE_URL: "mysql://u:p@h:3306/d" }))).toEqual({ kind: "mysql", databaseUrl: "mysql://u:p@h:3306/d" });
    expect(resolveTarget(env({ MYSQL_DATABASE_URL: "mysql2://u:p@h/d" }))).toEqual({ kind: "mysql", databaseUrl: "mysql://u:p@h/d" });
    expect(resolveTarget(env({ DATABASE_PATH: "elsewhere/x.sqlite" }))).toEqual({ kind: "sqlite", databasePath: path.resolve(process.cwd(), "elsewhere/x.sqlite") });
    expect(resolveTarget(env({ DATABASE_PATH: " " }))).toEqual({ kind: "sqlite", databasePath: path.resolve(process.cwd(), "data", "apsi.sqlite") });
  });
});

describe("data-integrity", () => {
  let directory: string;
  let testDb: TestDatabase;
  let out: string[];
  let err: string[];
  const io = () => ({ stdout: (text: string) => out.push(text), stderr: (text: string) => err.push(text) });
  const clock = { now: () => INTEGRITY_NOW };
  // Blank MySQL URLs: whatever the developer's shell exports, these tests only ever touch the temporary SQLite file.
  const testEnv = (databasePath: string): NodeJS.ProcessEnv => ({
    NODE_ENV: "test", DATABASE_URL: "", MYSQL_DATABASE_URL: "", DATABASE_PATH: databasePath,
  });
  const env = () => testEnv(testDb.databasePath);
  const run = (argv: string[]) => runDataIntegrity(argv, env(), io(), clock);
  const sqlite = () => testDb.db.$client;
  const file = (name: string) => path.join(directory, name);

  beforeEach(async () => {
    directory = mkdtempSync(path.join(tmpdir(), "apsi-data-integrity-"));
    testDb = await createTestDatabase();
    for (const statement of buildIntegritySeed()) {
      const { sql, params } = insertSql(statement);
      sqlite().prepare(sql).run(...params);
    }
    out = [];
    err = [];
  });

  afterEach(async () => {
    await testDb.cleanup();
    rmSync(directory, { recursive: true, force: true });
  });

  function dump() {
    return { bids: sqlite().prepare("SELECT * FROM bids ORDER BY id").all(), sources: sqlite().prepare("SELECT * FROM data_sources ORDER BY id").all() };
  }

  async function takeSnapshot(name = "before.json") {
    expect(await run(["--snapshot", file(name)])).toBe(0);
    out.length = 0;
    err.length = 0;
    return file(name);
  }

  describe("the report", () => {
    it("prints the help and exits 0", async () => {
      expect(await run(["--help"])).toBe(0);
      expect(out.join("\n")).toContain("Data integrity");
      expect(err).toEqual([]);
    });

    it("exits 2 on a bad command line without opening the database", async () => {
      expect(await runDataIntegrity(["--wat"], testEnv(path.join(directory, "nope.sqlite")), io(), clock)).toBe(2);
      expect(err.join("\n")).toContain("Unknown argument: --wat");
      expect(out).toEqual([]);
      expect(existsSync(path.join(directory, "nope.sqlite"))).toBe(false);
    });

    it("prints a per-level table, and names the target on stderr as soon as it is opened", async () => {
      expect(await run([])).toBe(0);

      const text = out.join("\n");
      expect(err).toEqual([`Target: sqlite ${testDb.databasePath}`]);
      expect(text).toContain(`Target: sqlite ${testDb.databasePath}`);
      const header = text.split("\n").find((line) => line.includes("special_district") && line.includes("federal"));
      expect(header).toBeDefined();
      expect(header!.trim().split(/\s+/)).toEqual(["state", "county", "city", "township", "special_district", "federal", "other", "total"]);
      const rowOf = (label: string) => text.split("\n").find((line) => line.trim().startsWith(`${label} `))!.trim().split(/\s+/).slice(1).map(Number);
      expect(rowOf("total")).toEqual([13, 4, 3, 1, 0, 1, 1, 23]);
      expect(rowOf("open")).toEqual([11, 3, 2, 1, 0, 1, 1, 19]);
      expect(rowOf("openVisible")).toEqual([5, 2, 2, 1, 0, 1, 0, 11]);
      expect(rowOf("openHidden")).toEqual([6, 1, 0, 0, 0, 0, 1, 8]);
      expect(rowOf("identityMismatch")).toEqual([1, 1, 0, 0, 0, 0, 1, 3]);
      expect(rowOf("demoLike")).toEqual([2, 0, 0, 0, 0, 0, 0, 2]);
      expect(rowOf("detailLockedAtSource")).toEqual([0, 1, 0, 1, 0, 0, 0, 2]);
      expect(rowOf("expiredOpen")).toEqual([1, 0, 1, 0, 0, 0, 0, 2]);
      expect(text).toContain("invalid_issuer 2");
      expect(text).toContain("registered_source_mismatch 3");
      expect(text).toMatch(/ny_contract_reporter:% Company:%.*: 1/);
      expect(text).toContain("2026-10-13T08:00:00.000Z");
    });

    it("prints the same report as JSON, on stdout alone", async () => {
      expect(await run(["--json"])).toBe(0);

      expect(err).toEqual([`Target: sqlite ${testDb.databasePath}`]);
      expect(out).toHaveLength(1);
      const printed = JSON.parse(out[0]);
      expect(printed.target).toBe(`sqlite ${testDb.databasePath}`);
      expect(printed.mode).toBe("report");
      const expected: IntegrityReport = await buildIntegrityReport({ database: testDb.db }, { now: INTEGRITY_NOW });
      expect(printed.report).toEqual(JSON.parse(JSON.stringify(expected)));
      expect(printed.report.levels.state).toEqual(JSON.parse(JSON.stringify(EXPECTED_LEVELS.state)));
    });

    it("exits 2 with a clear message, and creates nothing, when the database file is not there", async () => {
      const elsewhere = path.join(directory, "elsewhere");
      mkdirSync(elsewhere);
      const missing = path.join(elsewhere, "apsi.sqlite");

      expect(await runDataIntegrity([], testEnv(missing), io(), clock)).toBe(2);
      expect(await runDataIntegrity(["--snapshot", file("s.json")], testEnv(missing), io(), clock)).toBe(2);

      expect(err).toHaveLength(2);
      for (const line of err) {
        expect(line).toContain(`SQLite database not found: ${missing}`);
        expect(line).toContain("DATABASE_PATH");
        expect(line).toContain("Nothing was created");
      }
      expect(out).toEqual([]);
      expect(readdirSync(elsewhere)).toEqual([]);
      expect(existsSync(file("s.json"))).toBe(false);
    });

    it("says which database it hit before it reads, so even a failed run names it", async () => {
      const empty = path.join(directory, "empty.sqlite");
      writeFileSync(empty, "");

      expect(await runDataIntegrity([], testEnv(empty), io(), clock)).toBe(1);

      expect(err).toEqual([`Target: sqlite ${empty}`, "no such table: data_sources"]);
      expect(out).toEqual([]);
    });

    it("exits 2 when DATABASE_PATH is a directory", async () => {
      expect(await runDataIntegrity([], testEnv(directory), io(), clock)).toBe(2);

      expect(err.join("\n")).toContain("is a directory");
      expect(out).toEqual([]);
    });

    // A root process ignores directory permissions, so there is nothing to refuse.
    it.skipIf(process.getuid?.() === 0)("explains a WAL database it cannot open read-only because its directory cannot be written to", async () => {
      const readOnlyDirectory = path.join(directory, "frozen");
      mkdirSync(readOnlyDirectory);
      const copy = path.join(readOnlyDirectory, "apsi.sqlite");
      // A copy of the database with no -wal or -shm beside it, as a backup file is.
      sqlite().pragma("wal_checkpoint(TRUNCATE)");
      writeFileSync(copy, readFileSync(testDb.databasePath));
      chmodSync(readOnlyDirectory, 0o555);
      try {
        expect(await runDataIntegrity([], testEnv(copy), io(), clock)).toBe(1);
      } finally {
        chmodSync(readOnlyDirectory, 0o755);
      }

      expect(err[0]).toBe(`Target: sqlite ${copy}`);
      expect(err.join("\n")).toContain("attempt to write a readonly database");
      expect(err.join("\n")).toContain("directory you can write to");
      expect(out).toEqual([]);
    });

    it("opens the SQLite file read-only", async () => {
      const opened = await openTarget({ kind: "sqlite", databasePath: testDb.databasePath });
      try {
        expect("database" in opened.target && opened.target.database.$client.readonly).toBe(true);
        expect(() => ("database" in opened.target ? opened.target.database.$client.exec("DELETE FROM bids") : undefined)).toThrow(/readonly/i);
      } finally {
        await opened.close();
      }
      expect(sqlite().prepare("SELECT COUNT(*) AS n FROM bids").get()).toEqual({ n: 23 });
    });

    it("never writes: the bids and sources are exactly what they were after any run", async () => {
      const before = dump();

      expect(await run([])).toBe(0);
      expect(await run(["--json"])).toBe(0);
      const snapshotFile = await takeSnapshot();
      expect(await run(["--compare", snapshotFile])).toBe(0);
      expect(await run(["--compare", snapshotFile, "--json"])).toBe(0);

      expect(dump()).toEqual(before);
    });

    it("tells the user how to read the report in the output, not only in the help", async () => {
      expect(await run([])).toBe(0);

      const text = out.join("\n");
      expect(text).toContain("open and shown by search");
      expect(text).toContain("npm run data:integrity -- --snapshot");
    });
  });

  describe("--snapshot", () => {
    it("writes a snapshot a later run can read, and says where and how big", async () => {
      expect(await run(["--snapshot", file("before.json")])).toBe(0);

      const text = readFileSync(file("before.json"), "utf8");
      const snapshot = parseIntegritySnapshot(text);
      expect(Object.keys(snapshot.rows)).toHaveLength(23);
      expect(snapshot.dialect).toBe("sqlite");
      expect(snapshot.takenAt).toBe("2026-10-13T12:00:00.000Z");
      expect(out.join("\n")).toContain(`Snapshot written: ${file("before.json")}`);
      expect(out.join("\n")).toContain("23 bids");
      expect(out.join("\n")).toContain("state");
    });

    it("reports the snapshot in the JSON as well", async () => {
      expect(await run(["--snapshot", file("before.json"), "--json"])).toBe(0);

      expect(out).toHaveLength(1);
      const printed = JSON.parse(out[0]);
      expect(printed.mode).toBe("snapshot");
      expect(printed.snapshot).toEqual({ file: file("before.json"), bids: 23, bytes: readFileSync(file("before.json")).length });
      expect(printed.report.totals.total).toBe(23);
    });

    it("will not overwrite a snapshot that is there, and exits 2 before it reads anything", async () => {
      writeFileSync(file("before.json"), "the baseline");

      expect(await run(["--snapshot", file("before.json")])).toBe(2);

      expect(err.join("\n")).toContain("will not overwrite");
      expect(err.join("\n")).toContain(file("before.json"));
      expect(readFileSync(file("before.json"), "utf8")).toBe("the baseline");
      expect(out).toEqual([]);
      expect(err.join("\n")).not.toContain("Target:");
    });

    it("will not overwrite a file that appears while it reads, either", async () => {
      // The clock is read after the pre-check and before the snapshot is written: the file shows up in between.
      const raced = { now: () => { writeFileSync(file("before.json"), "written meanwhile"); return INTEGRITY_NOW; } };

      expect(await runDataIntegrity(["--snapshot", file("before.json")], env(), io(), raced)).toBe(2);

      expect(readFileSync(file("before.json"), "utf8")).toBe("written meanwhile");
      expect(err.join("\n")).toContain("will not overwrite");
      expect(out).toEqual([]);
    });

    it("exits 2 when the directory for the snapshot is not there", async () => {
      expect(await run(["--snapshot", path.join(directory, "missing", "before.json")])).toBe(2);

      expect(err.join("\n")).toContain("directory");
      expect(existsSync(path.join(directory, "missing"))).toBe(false);
    });
  });

  describe("--compare", () => {
    it("passes, and says so, when nothing changed", async () => {
      const snapshotFile = await takeSnapshot();

      expect(await run(["--compare", snapshotFile])).toBe(0);

      const text = out.join("\n");
      expect(text).toContain("Data integrity compare: OK");
      expect(text).toContain("No unexplained removal, visibility regression or rise in identity mismatches.");
      expect(err).toEqual([`Target: sqlite ${testDb.databasePath}`]);
    });

    it("exits 1 and names the removed bid when a bid is gone", async () => {
      const snapshotFile = await takeSnapshot();
      sqlite().prepare("DELETE FROM bids WHERE id = 'ca_caleprocure:RFQ-2'").run();

      expect(await run(["--compare", snapshotFile])).toBe(1);

      const text = out.join("\n");
      expect(text).toContain("Data integrity compare: REGRESSION");
      expect(text).toContain("removed_unexplained");
      expect(text).toContain("ca_caleprocure:RFQ-2");
      expect(text).toContain("removed 1");
    });

    it("exits 0 when --allow-removed covers the deletion, however many patterns are given", async () => {
      const snapshotFile = await takeSnapshot();
      sqlite().prepare("DELETE FROM bids WHERE id = 'ca_caleprocure:RFQ-2'").run();

      expect(await run(["--compare", snapshotFile, "--allow-removed", "^ca_caleprocure:RFQ-2$"])).toBe(0);
      expect(await run(["--compare", snapshotFile, "--allow-removed", "^nothing$", "--allow-removed", "RFQ-2"])).toBe(0);
      expect(await run(["--compare", snapshotFile, "--allow-removed", "^nothing$"])).toBe(1);
    });

    it("exits 1 and names the bid when an open visible bid went hidden", async () => {
      const snapshotFile = await takeSnapshot();
      sqlite().prepare("UPDATE bids SET issuer_name = 'Unknown x' WHERE id = 'ca_caleprocure:RFQ-1'").run();

      expect(await run(["--compare", snapshotFile])).toBe(1);

      expect(out.join("\n")).toContain("visibility_regression");
      expect(out.join("\n")).toContain("ca_caleprocure:RFQ-1");
    });

    it("exits 1 when a level's identity mismatches rose", async () => {
      const snapshotFile = await takeSnapshot();
      sqlite().prepare("UPDATE bids SET fips_code = '08099' WHERE id = 'bidnet_co_boulder:114'").run();

      expect(await run(["--compare", snapshotFile])).toBe(1);

      expect(out.join("\n")).toContain("identity_mismatch_increased");
      expect(out.join("\n")).toContain("county: identityMismatch rose 1 -> 2");
    });

    it("exits 0 and shows a retype by its transition", async () => {
      const snapshotFile = await takeSnapshot();
      sqlite().prepare("UPDATE bids SET issuer_type = 'city', jurisdiction_level = 'city', fips_code = '0804000' WHERE id = 'bidnet_co_aurora:202'").run();

      expect(await run(["--compare", snapshotFile])).toBe(0);

      const text = out.join("\n");
      expect(text).toContain("issuer_type state→city: 1");
      expect(text).toContain("bidnet_co_aurora:202");
      expect(text).toMatch(/state\s+identityMismatch\s+1\s+0\s+-1/);
    });

    it("warns, without failing, about a bid closed with no reason on record", async () => {
      const snapshotFile = await takeSnapshot();
      sqlite().prepare("UPDATE bids SET lifecycle_status = 'closed', is_active = 0 WHERE id = 'ca_caleprocure:RFQ-1'").run();

      expect(await run(["--compare", snapshotFile])).toBe(0);

      expect(out.join("\n")).toContain("closed_without_reason");
      expect(out.join("\n")).toContain("Data integrity compare: OK (with warnings)");
    });

    it("prints the comparison as JSON, on stdout alone", async () => {
      const snapshotFile = await takeSnapshot();
      sqlite().prepare("DELETE FROM bids WHERE id = 'ca_caleprocure:RFQ-2'").run();

      expect(await run(["--compare", snapshotFile, "--json"])).toBe(1);

      expect(err).toEqual([`Target: sqlite ${testDb.databasePath}`]);
      expect(out).toHaveLength(1);
      const printed = JSON.parse(out[0]);
      expect(printed.mode).toBe("compare");
      expect(printed.comparison.ok).toBe(false);
      expect(printed.comparison.removed.unexpected).toEqual(["ca_caleprocure:RFQ-2"]);
      expect(printed.comparison.failures[0].code).toBe("removed_unexplained");
      expect(printed.report.totals.total).toBe(22);
    });

    it("can write the state it just read as the next baseline", async () => {
      const snapshotFile = await takeSnapshot();
      sqlite().prepare("UPDATE bids SET issuer_type = 'city', jurisdiction_level = 'city', fips_code = '0804000' WHERE id = 'bidnet_co_aurora:202'").run();

      expect(await run(["--compare", snapshotFile, "--snapshot", file("after.json")])).toBe(0);

      expect(out.join("\n")).toContain(`Snapshot written: ${file("after.json")}`);
      const after = parseIntegritySnapshot(readFileSync(file("after.json"), "utf8"));
      expect(after.rows["bidnet_co_aurora:202"].level).toBe("city");
      out.length = 0;
      expect(await run(["--compare", file("after.json")])).toBe(0);
      expect(out.join("\n")).toContain("changed 0");
    });

    it("keeps the first baseline's file when the same name is given for the new one", async () => {
      const snapshotFile = await takeSnapshot();
      const before = readFileSync(snapshotFile, "utf8");

      expect(await run(["--compare", snapshotFile, "--snapshot", snapshotFile])).toBe(2);

      expect(readFileSync(snapshotFile, "utf8")).toBe(before);
    });

    it("exits 2 when the snapshot file is missing, empty, not JSON, or not a snapshot, without opening the database", async () => {
      writeFileSync(file("empty.json"), "");
      writeFileSync(file("other.json"), JSON.stringify({ hello: "world" }));
      writeFileSync(file("future.json"), JSON.stringify({ version: 2 }));

      for (const name of ["missing.json", "empty.json", "other.json", "future.json"]) {
        err.length = 0;
        expect(await run(["--compare", file(name)]), name).toBe(2);
        expect(err.join("\n"), name).not.toContain("Target:");
        expect(out, name).toEqual([]);
      }
      expect((await runDataIntegrity(["--compare", file("missing.json")], env(), io(), clock))).toBe(2);
      expect(err.join("\n")).toContain("Snapshot file not found");
    });

    it("exits 2 on --allow-removed without --compare, and for a pattern that is not a regular expression", async () => {
      expect(await run(["--allow-removed", "^ny_"])).toBe(2);
      expect(await run(["--compare", file("x.json"), "--allow-removed", "("])).toBe(2);
      expect(err.join("\n")).toContain("--allow-removed only applies with --compare");
      expect(err.join("\n")).toContain("not a valid regular expression");
    });
  });
});

describe("formatIntegrityReport", () => {
  it("lists every level in a column and the total last", async () => {
    const testDb = await createTestDatabase();
    try {
      for (const statement of buildIntegritySeed()) {
        const { sql, params } = insertSql(statement);
        testDb.db.$client.prepare(sql).run(...params);
      }
      const report = await buildIntegrityReport({ database: testDb.db }, { now: INTEGRITY_NOW });

      const text = formatIntegrityReport(report, "sqlite somewhere");

      expect(text.split("\n")[0]).toBe("Data integrity report");
      expect(text).toContain("Target: sqlite somewhere");
      expect(text).toContain("Generated at: 2026-10-13T12:00:00.000Z");
      for (const label of ["total", "open", "closed", "awarded", "openVisible", "openHidden", "identityMismatch", "unregistered",
        "demoLike", "nonCanonicalId", "activeFlagMismatch", "withBody", "detailLockedAtSource", "bodyMissing", "withIssuer",
        "deadlineParseable", "withSourceUrl", "expiredOpen", "sources", "neverSucceeded", "succeededWithin2d", "succeededWithin7d", "failing"]) {
        expect(text, label).toMatch(new RegExp(`^ {2}${label} {2,}\\d`, "m"));
      }
    } finally {
      await testDb.cleanup();
    }
  });
});

/* A fresh process in a directory of its own: importing the app's db/client creates <cwd>/data/apsi.sqlite as a side
 * effect, and only a real process can show that the script does not. */

const frontendDir = fileURLToPath(new URL("..", import.meta.url));
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

/**
 * What a process printed, one string per stream. The two pipes are read independently, so no order between them is
 * defined: a test must never look at them as one text.
 */
interface ProcessRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runScriptIn(cwd: string, args: string[], env: Record<string, string> = {}): Promise<ProcessRun> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", tsxLoader, path.join(frontendDir, "scripts", "data-integrity.ts"), ...args], {
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

describe("data-integrity as a process of its own", () => {
  let workingDirectory: string;

  beforeEach(() => {
    workingDirectory = mkdtempSync(path.join(tmpdir(), "apsi-data-integrity-cwd-"));
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
  }, 60_000);

  it("reports, snapshots and compares a database it was given, and leaves the working directory alone", async () => {
    const testDb = await createTestDatabase();
    try {
      for (const statement of buildIntegritySeed()) {
        const { sql, params } = insertSql(statement);
        testDb.db.$client.prepare(sql).run(...params);
      }
      const snapshotFile = path.join(workingDirectory, "before.json");
      const withDatabase = { DATABASE_PATH: testDb.databasePath };

      const report = await runScriptIn(workingDirectory, ["--json"], withDatabase);
      expect(report.status).toBe(0);
      // stdout alone is the report, one JSON document; the target is on stderr.
      expect(JSON.parse(report.stdout).report.totals.total).toBe(23);
      expect(report.stderr).toContain(`Target: sqlite ${testDb.databasePath}`);

      const snapshot = await runScriptIn(workingDirectory, ["--snapshot", snapshotFile], withDatabase);
      expect(snapshot.status).toBe(0);
      expect(readdirSync(workingDirectory)).toEqual(["before.json"]);

      const unchanged = await runScriptIn(workingDirectory, ["--compare", snapshotFile], withDatabase);
      expect(unchanged.status).toBe(0);
      expect(unchanged.stdout).toContain("Data integrity compare: OK");

      testDb.db.$client.prepare("DELETE FROM bids WHERE id = 'ca_caleprocure:RFQ-2'").run();
      const removed = await runScriptIn(workingDirectory, ["--compare", snapshotFile], withDatabase);
      expect(removed.status).toBe(1);
      expect(removed.stdout).toContain("ca_caleprocure:RFQ-2");
      const allowed = await runScriptIn(workingDirectory, ["--compare", snapshotFile, "--allow-removed", "RFQ-2$"], withDatabase);
      expect(allowed.status).toBe(0);
      const usage = await runScriptIn(workingDirectory, ["--compare", snapshotFile, "--allow-removed", "("], withDatabase);
      expect(usage.status).toBe(2);

      expect(readdirSync(workingDirectory)).toEqual(["before.json"]);
    } finally {
      await testDb.cleanup();
    }
  }, 120_000);
});
