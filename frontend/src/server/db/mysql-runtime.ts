interface MysqlQueryable {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
}

interface MysqlExecutable {
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

interface MysqlTransactionConnection extends MysqlQueryable, MysqlExecutable {
  beginTransaction: () => Promise<void>;
  commit: () => Promise<void>;
  rollback: () => Promise<void>;
  release: () => void;
}

interface MysqlTransactionPool {
  getConnection: () => Promise<MysqlTransactionConnection>;
}

export interface MysqlExecuteResult {
  affectedRows: number;
  insertId: number;
}

export async function mysqlSelectMany<T>(pool: MysqlQueryable, sql: string, values: unknown[] = []): Promise<T[]> {
  const [rows] = await pool.query(sql, values);
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export async function mysqlSelectOne<T>(pool: MysqlQueryable, sql: string, values: unknown[] = []): Promise<T | null> {
  const rows = await mysqlSelectMany<T>(pool, sql, values);
  return rows[0] ?? null;
}

export async function mysqlExecute(
  pool: MysqlExecutable,
  sql: string,
  values: unknown[] = [],
): Promise<MysqlExecuteResult> {
  const [result] = await pool.execute(sql, values as never[]);
  const record = result as { affectedRows?: unknown; insertId?: unknown };

  return {
    affectedRows: Number(record.affectedRows ?? 0),
    insertId: Number(record.insertId ?? 0),
  };
}

export function expandMysqlInClause(values: readonly unknown[]) {
  if (values.length === 0) {
    throw new Error("MySQL IN clause expansion requires at least one value.");
  }

  return {
    placeholders: values.map(() => "?").join(", "),
    values: [...values],
  };
}

export async function mysqlTransaction<T>(
  pool: MysqlTransactionPool,
  callback: (connection: MysqlTransactionConnection) => Promise<T>,
): Promise<T> {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function normalizeMysqlString(value: string | null | undefined) {
  return value ?? "";
}

export function normalizeMysqlNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  return Number(value);
}

export function normalizeMysqlBoolean(value: number | string | boolean | null | undefined) {
  return value === true || value === 1 || value === "1";
}
