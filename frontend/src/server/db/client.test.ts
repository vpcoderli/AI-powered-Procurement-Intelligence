import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase, createRuntimeDatabase, MysqlRuntimeDatabaseGuardError } from "./client";

describe("runtime database client", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalMysqlDatabaseUrl = process.env.MYSQL_DATABASE_URL;

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }

    if (originalMysqlDatabaseUrl === undefined) {
      delete process.env.MYSQL_DATABASE_URL;
    } else {
      process.env.MYSQL_DATABASE_URL = originalMysqlDatabaseUrl;
    }
  });

  it("uses an explicit guard instead of SQLite when MySQL is configured", () => {
    process.env.DATABASE_URL = "mysql://user:pass@localhost:3306/winbids";
    delete process.env.MYSQL_DATABASE_URL;

    const runtimeDb = createRuntimeDatabase();

    expect(() => runtimeDb.select()).toThrow(MysqlRuntimeDatabaseGuardError);
    expect(() => runtimeDb.insert({} as never)).toThrow(/MySQL is configured/);
  });
});

describe("createDatabase", () => {
  const directories: string[] = [];
  const handles: Database.Database[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const handle of handles.splice(0)) if (handle.open) handle.close();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function scratchDirectory() {
    const directory = mkdtempSync(path.join(tmpdir(), "apsi-client-"));
    directories.push(directory);
    return directory;
  }

  function create(databasePath: string) {
    const database = createDatabase(databasePath);
    handles.push(database.$client);
    return database;
  }

  it("opens a new file in WAL mode with foreign keys on and a five second busy timeout", () => {
    const database = create(path.join(scratchDirectory(), "nested", "new.sqlite"));

    expect(database.$client.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(database.$client.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(database.$client.pragma("busy_timeout", { simple: true })).toBe(5000);
  });

  it("opens a file that is already in WAL mode, and a second connection to the same file", () => {
    const file = path.join(scratchDirectory(), "twice.sqlite");
    create(file);

    const second = create(file);

    expect(second.$client.pragma("journal_mode", { simple: true })).toBe("wal");
  });

  it("still opens an in-memory database, which the MySQL-mode workers use for their unused SQLite handle", () => {
    const database = create(":memory:");

    expect(database.$client.memory).toBe(true);
    expect(database.$client.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("throws a file that is not a database at once, and closes the connection it opened", () => {
    const file = path.join(scratchDirectory(), "text.sqlite");
    writeFileSync(file, "this is not a SQLite database file, ".repeat(40));
    const close = vi.spyOn(Database.prototype, "close");

    const started = Date.now();
    expect(() => createDatabase(file)).toThrow(/not a database/);

    // No retry loop for an error waiting cannot fix, and no connection left open on the failed file.
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
