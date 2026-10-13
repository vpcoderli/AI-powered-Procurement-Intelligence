import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { isMysqlDatabaseUrlConfigured } from "./mysql";
import * as schema from "./schema";
import { enableWalMode } from "./sqlite-wal";

const DEFAULT_DATABASE_PATH = path.join(process.cwd(), "data", "apsi.sqlite");

export type AppDatabase = ReturnType<typeof createDatabase>;

export class MysqlRuntimeDatabaseGuardError extends Error {
  constructor(property: PropertyKey) {
    super(
      `MySQL is configured, so the runtime SQLite database is disabled. ` +
        `Migrate this code path before using db.${String(property)}.`,
    );
    this.name = "MysqlRuntimeDatabaseGuardError";
  }
}

export function createDatabase(databasePath = DEFAULT_DATABASE_PATH) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  try {
    // Several processes can open a fresh file at once (parallel Vitest workers, next build's page-data
    // workers, workers started together). The busy timeout covers ordinary lock waits, but the journal-mode
    // switch needs an exclusive lock and SQLite answers SQLITE_BUSY to the loser at once, without calling the
    // busy handler (waiting could deadlock). enableWalMode retries it until the winner has switched the file.
    // No other pragma here takes a lock: busy_timeout and foreign_keys only set a flag on this connection.
    sqlite.pragma("busy_timeout = 5000");
    enableWalMode(sqlite);
    sqlite.pragma("foreign_keys = ON");
  } catch (error) {
    sqlite.close();
    throw error;
  }

  return drizzle(sqlite, { schema });
}

function createMysqlRuntimeDatabaseGuard(): AppDatabase {
  return new Proxy({}, {
    get(_target, property) {
      if (property === Symbol.toStringTag) return "MysqlRuntimeDatabaseGuard";
      throw new MysqlRuntimeDatabaseGuardError(property);
    },
  }) as AppDatabase;
}

export function createRuntimeDatabase() {
  return isMysqlDatabaseUrlConfigured()
    ? createMysqlRuntimeDatabaseGuard()
    : createDatabase();
}

export const db = createRuntimeDatabase();
