import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const DEFAULT_DATABASE_PATH = path.join(process.cwd(), "data", "apsi.sqlite");

export type AppDatabase = ReturnType<typeof createDatabase>;

export function createDatabase(databasePath = DEFAULT_DATABASE_PATH) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  return drizzle(sqlite, { schema });
}

export const db = createDatabase();
