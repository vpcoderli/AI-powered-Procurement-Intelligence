import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { enableWalMode, isSqliteLockContention, sleepSync, WAL_RETRY_BUDGET_MS, type WalConnection } from "./sqlite-wal";

/** What better-sqlite3 throws: an Error named SqliteError with the SQLite result code on `code`. */
function sqliteError(code: string, message = "database is locked"): Error {
  return Object.assign(new Error(message), { name: "SqliteError", code });
}

/**
 * A connection that answers each `PRAGMA journal_mode = WAL` from a script: an Error in the script is thrown, anything else
 * is returned as the pragma's value. The last answer repeats once the script runs out.
 */
function scriptedConnection(script: unknown[], extra: Partial<WalConnection> = {}) {
  const calls: string[] = [];
  const connection: WalConnection = {
    ...extra,
    pragma(source) {
      calls.push(source);
      const answer = script[Math.min(calls.length, script.length) - 1];
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { connection, calls };
}

/** A clock that only moves when the code under test sleeps, so a retry budget of seconds costs no time. */
function fakeClock() {
  const start = 1_000_000;
  let time = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => time,
    sleep: (milliseconds: number) => {
      sleeps.push(milliseconds);
      time += milliseconds;
    },
    elapsed: () => time - start,
  };
}

describe("enableWalMode", () => {
  it("retries SQLITE_BUSY until the switch goes through", () => {
    const { connection, calls } = scriptedConnection([sqliteError("SQLITE_BUSY"), sqliteError("SQLITE_BUSY"), "wal"]);
    const clock = fakeClock();

    expect(() => enableWalMode(connection, clock)).not.toThrow();

    expect(calls).toEqual(["journal_mode = WAL", "journal_mode = WAL", "journal_mode = WAL"]);
    expect(clock.sleeps).toHaveLength(2);
  });

  it("makes one attempt and never sleeps when nothing is contended", () => {
    const { connection, calls } = scriptedConnection(["wal"]);
    const clock = fakeClock();

    enableWalMode(connection, clock);

    expect(calls).toHaveLength(1);
    expect(clock.sleeps).toEqual([]);
  });

  it.each(["SQLITE_BUSY", "SQLITE_BUSY_RECOVERY", "SQLITE_BUSY_SNAPSHOT", "SQLITE_BUSY_TIMEOUT", "SQLITE_LOCKED", "SQLITE_LOCKED_SHAREDCACHE"])(
    "retries %s",
    (code) => {
      const { connection, calls } = scriptedConnection([sqliteError(code), "wal"]);

      enableWalMode(connection, fakeClock());

      expect(calls).toHaveLength(2);
    },
  );

  it("retries an error that only kept its message", () => {
    const { connection, calls } = scriptedConnection([new Error("database is locked"), "wal"]);

    enableWalMode(connection, fakeClock());

    expect(calls).toHaveLength(2);
  });

  it("gives up once the budget is spent and throws the last error", () => {
    const thrown: Error[] = [];
    const clock = fakeClock();
    const connection: WalConnection = {
      pragma() {
        const error = sqliteError("SQLITE_BUSY", `database is locked (attempt ${thrown.length + 1})`);
        thrown.push(error);
        throw error;
      },
    };

    let caught: unknown;
    try {
      enableWalMode(connection, { ...clock, random: () => 0.5 });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(thrown[thrown.length - 1]);
    expect(clock.elapsed()).toBeGreaterThanOrEqual(WAL_RETRY_BUDGET_MS);
    expect(clock.elapsed()).toBeLessThanOrEqual(WAL_RETRY_BUDGET_MS + 1_000);
    // A backoff, not a spin: some dozens of attempts spread over the budget.
    expect(thrown.length).toBeGreaterThan(10);
    expect(thrown.length).toBeLessThan(200);
  });

  it("backs off from a few milliseconds to a cap, never longer than what is left of the budget", () => {
    const clock = fakeClock();
    const { connection } = scriptedConnection([sqliteError("SQLITE_BUSY")]);

    expect(() => enableWalMode(connection, { ...clock, budgetMs: 3_000, random: () => 0.999 })).toThrow(/database is locked/);

    const { sleeps } = clock;
    expect(sleeps[0]).toBeLessThanOrEqual(5);
    expect(sleeps[1]).toBeGreaterThan(sleeps[0]);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(200);
    // Growing until the cap; the final sleep is trimmed to the time that is left.
    const untrimmed = sleeps.slice(0, -1);
    expect(untrimmed.every((value, index) => index === 0 || value >= untrimmed[index - 1])).toBe(true);
    expect(clock.elapsed()).toBe(3_000);
  });

  it("spreads the delay of colliding processes: the same attempt waits less when the random draw is low", () => {
    const lowClock = fakeClock();
    const highClock = fakeClock();

    expect(() => enableWalMode(scriptedConnection([sqliteError("SQLITE_BUSY")]).connection, { ...lowClock, budgetMs: 500, random: () => 0 })).toThrow();
    expect(() => enableWalMode(scriptedConnection([sqliteError("SQLITE_BUSY")]).connection, { ...highClock, budgetMs: 500, random: () => 0.999 })).toThrow();

    expect(lowClock.sleeps[0]).toBeLessThan(highClock.sleeps[0]);
    expect(lowClock.sleeps[0]).toBeGreaterThanOrEqual(1);
  });

  it("honors a budget on the real clock", () => {
    const { connection } = scriptedConnection([sqliteError("SQLITE_BUSY")]);

    const started = Date.now();
    expect(() => enableWalMode(connection, { budgetMs: 60 })).toThrow(/database is locked/);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(55);
    expect(elapsed).toBeLessThan(5_000);
  });

  it("does not retry an error that is not lock contention", () => {
    const errors = [sqliteError("SQLITE_CORRUPT", "database disk image is malformed"), sqliteError("SQLITE_NOTADB", "file is not a database"), new Error("boom")];

    for (const error of errors) {
      const { connection, calls } = scriptedConnection([error, "wal"]);
      const clock = fakeClock();

      expect(() => enableWalMode(connection, clock)).toThrow(error);

      expect(calls).toHaveLength(1);
      expect(clock.sleeps).toEqual([]);
    }
  });

  it("retries when SQLite answers another journal mode instead of raising an error, then gives up naming it", () => {
    const recovers = scriptedConnection(["delete", "delete", "wal"]);
    enableWalMode(recovers.connection, fakeClock());
    expect(recovers.calls).toHaveLength(3);

    const stuck = scriptedConnection(["delete"]);
    expect(() => enableWalMode(stuck.connection, fakeClock())).toThrow(/did not switch.*WAL.*"delete"/);
  });

  it("accepts the mode an in-memory database reports, which can never be WAL", () => {
    const { connection, calls } = scriptedConnection(["memory"], { memory: true });
    const clock = fakeClock();

    enableWalMode(connection, clock);

    expect(calls).toHaveLength(1);
    expect(clock.sleeps).toEqual([]);
  });

  it("does not take an answer other than WAL from a database file for success", () => {
    const { connection } = scriptedConnection(["memory"], { memory: false });

    expect(() => enableWalMode(connection, fakeClock())).toThrow(/"memory"/);
  });
});

describe("enableWalMode on real SQLite databases", () => {
  const directories: string[] = [];
  const handles: Database.Database[] = [];

  afterEach(() => {
    for (const handle of handles.splice(0)) handle.close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function scratchDirectory() {
    const directory = mkdtempSync(path.join(tmpdir(), "apsi-wal-"));
    directories.push(directory);
    return directory;
  }

  function open(file: string) {
    const handle = new Database(file);
    handles.push(handle);
    return handle;
  }

  it("switches a new file to WAL, and again without trouble", () => {
    const handle = open(path.join(scratchDirectory(), "fresh.sqlite"));
    expect(handle.pragma("journal_mode", { simple: true })).toBe("delete");

    enableWalMode(handle);
    expect(handle.pragma("journal_mode", { simple: true })).toBe("wal");

    enableWalMode(handle);
    expect(handle.pragma("journal_mode", { simple: true })).toBe("wal");
  });

  it("accepts a real in-memory database", () => {
    const handle = open(":memory:");

    expect(() => enableWalMode(handle)).not.toThrow();
    expect(handle.pragma("journal_mode", { simple: true })).toBe("memory");
  });

  it("throws a file that is not a database at once instead of retrying it", () => {
    const file = path.join(scratchDirectory(), "text.sqlite");
    writeFileSync(file, "this is not a SQLite database file, ".repeat(40));
    const handle = open(file);

    const started = Date.now();
    expect(() => enableWalMode(handle)).toThrow(/not a database/);
    expect(Date.now() - started).toBeLessThan(WAL_RETRY_BUDGET_MS / 2);
  });
});

describe("isSqliteLockContention", () => {
  it.each([
    { name: "SQLITE_BUSY", error: sqliteError("SQLITE_BUSY") },
    { name: "SQLITE_BUSY_RECOVERY", error: sqliteError("SQLITE_BUSY_RECOVERY") },
    { name: "SQLITE_BUSY_SNAPSHOT", error: sqliteError("SQLITE_BUSY_SNAPSHOT") },
    { name: "SQLITE_BUSY_TIMEOUT", error: sqliteError("SQLITE_BUSY_TIMEOUT") },
    { name: "SQLITE_LOCKED", error: sqliteError("SQLITE_LOCKED", "database table is locked") },
    { name: "SQLITE_LOCKED_SHAREDCACHE", error: sqliteError("SQLITE_LOCKED_SHAREDCACHE", "database table is locked") },
    { name: "a bare code with no message", error: { code: "SQLITE_BUSY" } },
    { name: "a message without a code (database is locked)", error: new Error("SqliteError: database is locked") },
    { name: "a message without a code (database table is locked)", error: new Error("Database table is locked") },
  ])("is true for $name", ({ error }) => {
    expect(isSqliteLockContention(error)).toBe(true);
  });

  it.each([
    { name: "SQLITE_CORRUPT", error: sqliteError("SQLITE_CORRUPT", "database disk image is malformed") },
    { name: "SQLITE_READONLY", error: sqliteError("SQLITE_READONLY", "attempt to write a readonly database") },
    { name: "SQLITE_CANTOPEN", error: sqliteError("SQLITE_CANTOPEN", "unable to open database file") },
    { name: "SQLITE_CONSTRAINT_PRIMARYKEY", error: sqliteError("SQLITE_CONSTRAINT_PRIMARYKEY", "UNIQUE constraint failed") },
    { name: "an unrelated Error", error: new Error("boom") },
    { name: "an Error that merely mentions a lock", error: new Error("the lock file is stale") },
    { name: "a string", error: "database is locked" },
    { name: "null", error: null },
    { name: "undefined", error: undefined },
    { name: "a number", error: 42 },
  ])("is false for $name", ({ error }) => {
    expect(isSqliteLockContention(error)).toBe(false);
  });
});

describe("sleepSync", () => {
  it("blocks the calling thread for about as long as it is told to", () => {
    const started = performance.now();
    sleepSync(30);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(25);
    expect(elapsed).toBeLessThan(2_000);
  });
});
