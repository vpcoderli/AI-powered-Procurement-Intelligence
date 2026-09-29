import type { AppDatabase } from "@/server/db/client";
import { mysqlSelectMany } from "@/server/db/mysql-runtime";

export type SqlValue = string | number;
export type MysqlSqlReader = Parameters<typeof mysqlSelectMany>[0];

/**
 * Runs one dialect-neutral SELECT on either runtime (plan decision 2). The admin overview, source
 * list, index and detail build their SQL once and execute it through this, so SQLite and MySQL
 * share the exact text.
 */
export interface AdminSqlRunner {
  all<T>(sql: string, values?: readonly SqlValue[]): Promise<T[]>;
}

export function sqliteSqlRunner(db: AppDatabase): AdminSqlRunner {
  return {
    async all<T>(sql: string, values: readonly SqlValue[] = []) {
      return db.$client.prepare(sql).all(...values) as T[];
    },
  };
}

export function mysqlSqlRunner(mysql: MysqlSqlReader): AdminSqlRunner {
  return {
    all<T>(sql: string, values: readonly SqlValue[] = []) {
      return mysqlSelectMany<T>(mysql, sql, [...values]);
    },
  };
}

/** COUNT/SUM come back as numbers from better-sqlite3 and as numbers or decimal strings from mysql2. */
export function sqlCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
