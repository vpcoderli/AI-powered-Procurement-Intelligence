import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMysqlPoolForTests } from "@/server/db/mysql";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  FRONTEND_DIRECTORY,
  IntegrityUsageError,
  openIntegrityTarget,
  openResolvedTarget,
  resolveIntegrityTarget,
} from "./open-target";

const env = (values: Record<string, string> = {}): NodeJS.ProcessEnv => ({ NODE_ENV: "test", DATABASE_URL: "", MYSQL_DATABASE_URL: "", ...values });

describe("the directory a relative DATABASE_PATH is read from", () => {
  it("is the frontend directory: the one that holds package.json and the scripts", () => {
    expect(existsSync(path.join(FRONTEND_DIRECTORY, "package.json"))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(FRONTEND_DIRECTORY, "package.json"), "utf8")).name).toBe("frontend");
    expect(existsSync(path.join(FRONTEND_DIRECTORY, "scripts", "data-integrity.ts"))).toBe(true);
    expect(existsSync(path.join(FRONTEND_DIRECTORY, "scripts", "purge-demo-bids.ts"))).toBe(true);
    // Without a trailing separator, so that path.join(FRONTEND_DIRECTORY, ...) reads well in messages.
    expect(FRONTEND_DIRECTORY).toBe(path.resolve(fileURLToPath(new URL("../../..", import.meta.url))));
    expect(FRONTEND_DIRECTORY.endsWith(path.sep)).toBe(false);
  });
});

describe("resolveIntegrityTarget", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is MySQL when a mysql:// URL is set, DATABASE_URL first", () => {
    expect(resolveIntegrityTarget(env({ DATABASE_URL: "mysql://u:p@h:3306/d" }))).toEqual({ kind: "mysql", databaseUrl: "mysql://u:p@h:3306/d" });
    expect(resolveIntegrityTarget(env({ MYSQL_DATABASE_URL: "mysql2://u:p@h/d" }))).toEqual({ kind: "mysql", databaseUrl: "mysql://u:p@h/d" });
    expect(resolveIntegrityTarget(env({ DATABASE_URL: "mysql://first/d", MYSQL_DATABASE_URL: "mysql://second/d" }))).toEqual({ kind: "mysql", databaseUrl: "mysql://first/d" });
  });

  it("is the SQLite file DATABASE_PATH names, a relative path read from the frontend directory, default data/apsi.sqlite there", () => {
    expect(resolveIntegrityTarget(env())).toEqual({ kind: "sqlite", databasePath: path.join(FRONTEND_DIRECTORY, "data", "apsi.sqlite") });
    expect(resolveIntegrityTarget(env({ DATABASE_PATH: " " }))).toEqual({ kind: "sqlite", databasePath: path.join(FRONTEND_DIRECTORY, "data", "apsi.sqlite") });
    expect(resolveIntegrityTarget(env({ DATABASE_PATH: "elsewhere/x.sqlite" }))).toEqual({
      kind: "sqlite", databasePath: path.join(FRONTEND_DIRECTORY, "elsewhere", "x.sqlite"),
    });
    expect(resolveIntegrityTarget(env({ DATABASE_PATH: "/var/db/x.sqlite" }))).toEqual({ kind: "sqlite", databasePath: "/var/db/x.sqlite" });
  });

  it("does not depend on the working directory: a stray data/apsi.sqlite elsewhere is never the target", () => {
    vi.spyOn(process, "cwd").mockReturnValue("/a/stray/checkout");

    expect(resolveIntegrityTarget(env())).toEqual({ kind: "sqlite", databasePath: path.join(FRONTEND_DIRECTORY, "data", "apsi.sqlite") });
    expect(resolveIntegrityTarget(env({ DATABASE_PATH: "x.sqlite" }))).toEqual({ kind: "sqlite", databasePath: path.join(FRONTEND_DIRECTORY, "x.sqlite") });
  });
});

describe("openResolvedTarget on SQLite", () => {
  let directory: string;
  let testDb: TestDatabase;

  beforeEach(async () => {
    directory = mkdtempSync(path.join(tmpdir(), "apsi-open-target-"));
    testDb = await createTestDatabase();
  });

  afterEach(async () => {
    await testDb.cleanup();
    rmSync(directory, { recursive: true, force: true });
  });

  it("opens an existing file, names it, and closes it", async () => {
    const opened = await openResolvedTarget({ kind: "sqlite", databasePath: testDb.databasePath }, { readonly: false });

    expect(opened.description).toBe(`sqlite ${testDb.databasePath}`);
    expect("database" in opened.target).toBe(true);
    const handle = "database" in opened.target ? opened.target.database.$client : null;
    expect(handle?.open).toBe(true);
    await opened.close();
    expect(handle?.open).toBe(false);
  });

  it("opens it writable, with the foreign keys on, for a tool that writes", async () => {
    const opened = await openResolvedTarget({ kind: "sqlite", databasePath: testDb.databasePath }, { readonly: false });
    try {
      const handle = "database" in opened.target ? opened.target.database.$client : null;
      expect(handle?.readonly).toBe(false);
      expect(handle?.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(handle?.pragma("busy_timeout", { simple: true })).toBe(5000);
    } finally {
      await opened.close();
    }
  });

  it("opens it read-only for a tool that must not write: the connection itself refuses a write", async () => {
    const opened = await openResolvedTarget({ kind: "sqlite", databasePath: testDb.databasePath }, { readonly: true });
    try {
      const handle = "database" in opened.target ? opened.target.database.$client : null;
      expect(handle?.readonly).toBe(true);
      expect(handle?.pragma("busy_timeout", { simple: true })).toBe(5000);
      expect(() => handle?.exec("CREATE TABLE should_not_exist (id TEXT)")).toThrow(/readonly/i);
    } finally {
      await opened.close();
    }
  });

  it("refuses a file that is not there, creates nothing, and says how to point at the right one", async () => {
    const elsewhere = path.join(directory, "elsewhere");
    mkdirSync(elsewhere);
    const missing = path.join(elsewhere, "apsi.sqlite");

    for (const readonly of [false, true]) {
      const failure = await openResolvedTarget({ kind: "sqlite", databasePath: missing }, { readonly }).then(() => undefined, (error: unknown) => error);
      expect(failure, String(readonly)).toBeInstanceOf(IntegrityUsageError);
      const message = (failure as Error).message;
      expect(message).toContain(`SQLite database not found: ${missing}`);
      expect(message).toContain("Nothing was created");
      expect(message).toContain("DATABASE_PATH");
      expect(message).toContain("frontend/ directory");
    }
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("refuses a directory", async () => {
    const failure = await openResolvedTarget({ kind: "sqlite", databasePath: directory }, { readonly: false }).then(() => undefined, (error: unknown) => error);

    expect(failure).toBeInstanceOf(IntegrityUsageError);
    expect((failure as Error).message).toContain(`DATABASE_PATH is a directory, not a SQLite file: ${directory}`);
  });

  it("resolves and opens in one call from an environment", async () => {
    const opened = await openIntegrityTarget(env({ DATABASE_PATH: testDb.databasePath }), { readonly: true });
    try {
      expect(opened.description).toBe(`sqlite ${testDb.databasePath}`);
    } finally {
      await opened.close();
    }
  });
});

describe("openResolvedTarget on MySQL", () => {
  afterEach(() => {
    resetMysqlPoolForTests();
  });

  it("names the target with the password masked, hands out the shared pool, and ends it on close", async () => {
    const opened = await openResolvedTarget({ kind: "mysql", databaseUrl: "mysql://user:secret@127.0.0.1:1/none" }, { readonly: true });

    expect(opened.description).toBe("mysql mysql://user:***@127.0.0.1:1/none");
    expect(opened.description).not.toContain("secret");
    expect("mysql" in opened.target).toBe(true);
    expect((globalThis as { __apsiMysqlPool?: unknown }).__apsiMysqlPool).toBeDefined();
    await opened.close();
    expect((globalThis as { __apsiMysqlPool?: unknown }).__apsiMysqlPool).toBeUndefined();
  });
});

/* A fresh process in a directory of its own: loading the app's db/client creates <cwd>/data/apsi.sqlite when
 * process.env does not select MySQL, and only a real process can show that opening a MySQL target does not load it. */

const frontendDir = fileURLToPath(new URL("../../..", import.meta.url));
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

function runModuleCode(cwd: string, code: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", tsxLoader, "--input-type=module", "-e", code], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "test", DATABASE_URL: "", MYSQL_DATABASE_URL: "", TSX_TSCONFIG_PATH: path.join(frontendDir, "tsconfig.json") },
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

describe("opening a MySQL target in a process of its own", () => {
  let workingDirectory: string;

  beforeEach(() => {
    workingDirectory = mkdtempSync(path.join(tmpdir(), "apsi-open-target-cwd-"));
  });

  afterEach(() => {
    rmSync(workingDirectory, { recursive: true, force: true });
  });

  it("creates nothing in the working directory, even when the environment it was given is not the process environment", async () => {
    // process.env selects SQLite (no MySQL URL); the environment handed to the opener selects MySQL. Loading db/client
    // under the first would create <cwd>/data/apsi.sqlite.
    const modulePath = pathToFileURL(path.join(frontendDir, "src", "server", "integrity", "open-target.ts")).href;
    const code = `
      const { openIntegrityTarget } = await import(${JSON.stringify(modulePath)});
      const opened = await openIntegrityTarget({ NODE_ENV: "test", DATABASE_URL: "mysql://user:secret@127.0.0.1:1/none" }, { readonly: true });
      console.log(opened.description);
      await opened.close();
    `;

    const run = await runModuleCode(workingDirectory, code);

    expect(run.stderr).toBe("");
    expect(run.stdout.trim()).toBe("mysql mysql://user:***@127.0.0.1:1/none");
    expect(run.status).toBe(0);
    expect(readdirSync(workingDirectory)).toEqual([]);
  }, 60_000);

  it("reads a relative DATABASE_PATH from the frontend directory, from whatever directory it runs in", async () => {
    const testDb = await createTestDatabase();
    try {
      writeFileSync(path.join(workingDirectory, "decoy.sqlite"), "");
      const modulePath = pathToFileURL(path.join(frontendDir, "src", "server", "integrity", "open-target.ts")).href;
      const relative = path.relative(frontendDir, testDb.databasePath);
      const code = `
        const { openIntegrityTarget } = await import(${JSON.stringify(modulePath)});
        const opened = await openIntegrityTarget({ NODE_ENV: "test", DATABASE_PATH: ${JSON.stringify(relative)} }, { readonly: true });
        console.log(opened.description);
        await opened.close();
      `;

      // Run from a directory deeper than the frontend directory: the ".." segments of the relative path then cannot climb
      // out of it onto the right file by luck (they stop at the root), as they could from a shallow one.
      const depth = frontendDir.split(path.sep).filter(Boolean).length + 2;
      const deep = path.join(workingDirectory, ...Array.from({ length: depth }, () => "d"));
      mkdirSync(deep, { recursive: true });
      expect(path.resolve(deep, relative)).not.toBe(testDb.databasePath);

      const run = await runModuleCode(deep, code);

      expect(run.stderr).toBe("");
      expect(run.stdout.trim()).toBe(`sqlite ${testDb.databasePath}`);
      expect(run.status).toBe(0);
      expect(readdirSync(workingDirectory).sort()).toEqual(["d", "decoy.sqlite"]);
    } finally {
      await testDb.cleanup();
    }
  }, 60_000);
});
