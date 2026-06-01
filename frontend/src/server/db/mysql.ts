import { readFileSync } from "node:fs";
import path from "node:path";
import mysql, { type Pool } from "mysql2/promise";

export interface MysqlMigrationResult {
  appliedStatements: number;
  skippedStatements: number;
}

const duplicateIndexErrors = new Set(["ER_DUP_KEYNAME", "ER_DUP_ENTRY"]);
const textKeyColumnType = "VARCHAR(191)";
const longTextColumnType = "LONGTEXT";
let defaultMysqlPool: Pool | undefined;

export function requireMysqlDatabaseUrl(env = process.env) {
  const value = env.DATABASE_URL?.trim() || env.MYSQL_DATABASE_URL?.trim();
  if (!value) {
    throw new Error("DATABASE_URL or MYSQL_DATABASE_URL is required for MySQL operations.");
  }

  if (!value.startsWith("mysql://") && !value.startsWith("mysql2://")) {
    throw new Error("MySQL database URL must start with mysql:// or mysql2://.");
  }

  return value.replace(/^mysql2:\/\//, "mysql://");
}

export function isMysqlDatabaseUrlConfigured(env = process.env) {
  const value = env.DATABASE_URL?.trim() || env.MYSQL_DATABASE_URL?.trim();
  return Boolean(value && (value.startsWith("mysql://") || value.startsWith("mysql2://")));
}

export function createMysqlPool(databaseUrl = requireMysqlDatabaseUrl()): Pool {
  return mysql.createPool({
    uri: databaseUrl,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT ?? 10),
    multipleStatements: false,
    namedPlaceholders: false,
  });
}

export function resolveMysqlPool(databaseUrl = requireMysqlDatabaseUrl()): Pool {
  if (!defaultMysqlPool) {
    defaultMysqlPool = createMysqlPool(databaseUrl);
  }

  return defaultMysqlPool;
}

export function resetMysqlPoolForTests() {
  defaultMysqlPool = undefined;
}

export async function closeResolvedMysqlPool() {
  if (!defaultMysqlPool) return;
  const pool = defaultMysqlPool;
  defaultMysqlPool = undefined;
  await pool.end();
}

function sourceMigrationPath() {
  return path.join(process.cwd(), "src", "server", "db", "migrate.ts");
}

function extractSqliteMigrationSql() {
  const source = readFileSync(sourceMigrationPath(), "utf8");
  const match = source.match(/sqlite\.exec\(`([\s\S]*?)`\);/);
  if (!match) {
    throw new Error("Unable to extract SQLite migration SQL from src/server/db/migrate.ts.");
  }

  return match[1];
}

function stripInlineReferences(statement: string) {
  return statement.replace(/\s+REFERENCES\s+[A-Za-z_][A-Za-z0-9_]*(?:\([^)]+\))?(?:\s+ON\s+DELETE\s+(?:CASCADE|SET\s+NULL))?/gi, "");
}

function tableNameFromCreateStatement(statement: string) {
  return statement.match(/CREATE TABLE IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)/i)?.[1];
}

function primaryKeyColumnsFromCreateStatement(statement: string) {
  const columns = new Set<string>();

  for (const match of statement.matchAll(/PRIMARY KEY\s*\(([^)]+)\)/gi)) {
    for (const column of match[1].split(",")) {
      columns.add(column.trim().replace(/[`"']/g, ""));
    }
  }

  return columns;
}

function indexedTextColumnsByTable(sqliteMigrationSql: string) {
  const byTable = new Map<string, Set<string>>();

  for (const rawStatement of sqliteMigrationSql.split(";")) {
    const statement = rawStatement.trim();
    if (!statement.startsWith("CREATE INDEX") && !statement.startsWith("CREATE UNIQUE INDEX")) continue;
    if (statement.includes("COALESCE(scope_id")) continue;

    const match = statement.match(/ON\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]+)\)/i);
    if (!match) continue;

    const tableName = match[1];
    const columns = byTable.get(tableName) ?? new Set<string>();

    for (const rawColumn of match[2].split(",")) {
      const column = rawColumn.trim().replace(/[`"']/g, "");
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) {
        columns.add(column);
      }
    }

    byTable.set(tableName, columns);
  }

  return byTable;
}

function convertTextDefaultForLongText(rest: string) {
  return rest.replace(/DEFAULT\s+('[^']*')/i, "DEFAULT ($1)");
}

function convertCreateTableStatement(statement: string, indexedColumns = new Set<string>()) {
  const stripped = stripInlineReferences(statement)
    .replace(/\bINTEGER\b/g, "INT")
    .replace(/CREATE TABLE IF NOT EXISTS/g, "CREATE TABLE IF NOT EXISTS")
    .trim();

  const primaryKeyColumns = primaryKeyColumnsFromCreateStatement(stripped);

  return stripped
    .split("\n")
    .map((line) => {
      const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s+TEXT\b(.*)$/i);
      if (!match) return line;

      const [, indent, columnName, rest] = match;
      const keySizedText = rest.includes("PRIMARY KEY") || primaryKeyColumns.has(columnName) || indexedColumns.has(columnName);
      const columnType = keySizedText ? textKeyColumnType : longTextColumnType;
      const convertedRest = keySizedText ? rest : convertTextDefaultForLongText(rest);

      return `${indent}${columnName} ${columnType}${convertedRest}`;
    })
    .join("\n");
}

function convertIndexStatement(statement: string) {
  if (statement.includes("COALESCE(scope_id")) {
    return null;
  }

  return statement
    .replace(/CREATE UNIQUE INDEX IF NOT EXISTS/g, "CREATE UNIQUE INDEX")
    .replace(/CREATE INDEX IF NOT EXISTS/g, "CREATE INDEX")
    .trim();
}

export function mysqlMigrationStatements(sqliteMigrationSql = extractSqliteMigrationSql()) {
  const indexedColumns = indexedTextColumnsByTable(sqliteMigrationSql);

  return sqliteMigrationSql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .flatMap((statement) => {
      if (statement.startsWith("CREATE TABLE")) {
        const tableName = tableNameFromCreateStatement(statement);
        return [convertCreateTableStatement(statement, tableName ? indexedColumns.get(tableName) : undefined)];
      }
      if (statement.startsWith("CREATE INDEX") || statement.startsWith("CREATE UNIQUE INDEX")) {
        const converted = convertIndexStatement(statement);
        return converted ? [converted] : [];
      }

      return [];
    });
}

export async function runMysqlMigrations(pool: Pool = createMysqlPool()): Promise<MysqlMigrationResult> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mysql_migrations (
      id VARCHAR(191) PRIMARY KEY,
      applied_at VARCHAR(64) NOT NULL
    )
  `);

  let appliedStatements = 0;
  let skippedStatements = 0;

  for (const statement of mysqlMigrationStatements()) {
    try {
      await pool.query(statement);
      appliedStatements += 1;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        duplicateIndexErrors.has(String((error as { code?: unknown }).code))
      ) {
        skippedStatements += 1;
        continue;
      }

      throw error;
    }
  }

  await pool.query(
    "INSERT INTO mysql_migrations (id, applied_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE applied_at = VALUES(applied_at)",
    ["sqlite-ddl-compat-v1", new Date().toISOString()],
  );

  return {
    appliedStatements,
    skippedStatements,
  };
}
