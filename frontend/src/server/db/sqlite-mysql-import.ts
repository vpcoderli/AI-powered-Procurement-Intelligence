import Database from "better-sqlite3";
import { mysqlExecute } from "./mysql-runtime";

interface MysqlImportStore {
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

export interface SqliteMysqlImportTableResult {
  tableName: string;
  rowsCopied: number;
}

export interface SqliteMysqlImportResult {
  tables: SqliteMysqlImportTableResult[];
  totalRowsCopied: number;
}

export interface SqliteMysqlImportOptions {
  tables?: string[];
  batchSize?: number;
}

interface SqliteTableInfoRow {
  name: string;
}

interface SqliteColumnInfoRow {
  name: string;
}

function quoteMysqlIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }

  return `\`${identifier}\``;
}

function listSqliteTables(sqlite: Database.Database) {
  return sqlite
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name ASC
    `)
    .all() as SqliteTableInfoRow[];
}

function listSqliteColumns(sqlite: Database.Database, tableName: string) {
  return (sqlite.prepare(`PRAGMA table_info(${quoteMysqlIdentifier(tableName)})`).all() as SqliteColumnInfoRow[])
    .map((column) => column.name);
}

function selectedTables(sqlite: Database.Database, options: SqliteMysqlImportOptions) {
  const available = new Set(listSqliteTables(sqlite).map((table) => table.name));
  if (!options.tables || options.tables.length === 0) {
    return [...available];
  }

  return options.tables.filter((tableName) => available.has(tableName));
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function rowValues(row: Record<string, unknown>, columns: string[]) {
  return columns.map((column) => row[column] ?? null);
}

function buildUpsertSql(tableName: string, columns: string[], rowCount: number) {
  const quotedColumns = columns.map(quoteMysqlIdentifier);
  const placeholders = `(${columns.map(() => "?").join(", ")})`;
  const valuePlaceholders = Array.from({ length: rowCount }, () => placeholders).join(", ");
  const updateColumns = quotedColumns.length > 1 ? quotedColumns.slice(1) : quotedColumns;

  return `
    INSERT INTO ${quoteMysqlIdentifier(tableName)} (${quotedColumns.join(", ")})
    VALUES ${valuePlaceholders}
    ON DUPLICATE KEY UPDATE ${updateColumns.map((column) => `${column} = VALUES(${column})`).join(", ")}
  `;
}

export async function importSqliteDatabaseIntoMysql(
  mysql: MysqlImportStore,
  sqlitePath: string,
  options: SqliteMysqlImportOptions = {},
): Promise<SqliteMysqlImportResult> {
  const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 100, 500));

  try {
    const tables: SqliteMysqlImportTableResult[] = [];

    for (const tableName of selectedTables(sqlite, options)) {
      const columns = listSqliteColumns(sqlite, tableName);
      if (columns.length === 0) {
        tables.push({ tableName, rowsCopied: 0 });
        continue;
      }

      const rows = sqlite
        .prepare(`SELECT ${columns.map(quoteMysqlIdentifier).join(", ")} FROM ${quoteMysqlIdentifier(tableName)}`)
        .all() as Record<string, unknown>[];

      for (const rowBatch of chunk(rows, batchSize)) {
        if (rowBatch.length === 0) continue;
        await mysqlExecute(
          mysql,
          buildUpsertSql(tableName, columns, rowBatch.length),
          rowBatch.flatMap((row) => rowValues(row, columns)),
        );
      }

      tables.push({ tableName, rowsCopied: rows.length });
    }

    return {
      tables,
      totalRowsCopied: tables.reduce((total, table) => total + table.rowsCopied, 0),
    };
  } finally {
    sqlite.close();
  }
}
