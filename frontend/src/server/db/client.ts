import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { isMysqlDatabaseUrlConfigured } from "./mysql";
import * as schema from "./schema";

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
  // Several processes can open a fresh file at once (next build's page-data workers, parallel
  // scripts). Without a busy timeout the losers of the journal-mode switch fail with SQLITE_BUSY.
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

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
