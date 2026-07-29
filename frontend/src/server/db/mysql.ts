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

  // Column names that participate in any mysqlIndexMigrations entry are treated as key-style
  // identifiers wherever they appear (not just on the specific table an index is declared for):
  // e.g. fips_code is only formally indexed on bids in this phase, but it's the same short-code
  // value on data_sources too, and LONGTEXT can never be indexed later if we size it wrong now.
  const indexMigrationColumnNames = indexMigrationColumnNameSet();

  return sqliteMigrationSql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .flatMap((statement) => {
      if (statement.startsWith("CREATE TABLE")) {
        const tableName = tableNameFromCreateStatement(statement);
        const columns = new Set(tableName ? indexedColumns.get(tableName) ?? [] : []);
        for (const column of indexMigrationColumnNames) {
          columns.add(column);
        }
        return [convertCreateTableStatement(statement, columns)];
      }
      if (statement.startsWith("CREATE INDEX") || statement.startsWith("CREATE UNIQUE INDEX")) {
        const converted = convertIndexStatement(statement);
        return converted ? [converted] : [];
      }

      return [];
    });
}

interface MysqlColumnMigration {
  tableName: string;
  columnName: string;
  definition: string;
}

const mysqlColumnMigrations: MysqlColumnMigration[] = [
  {
    tableName: "submission_paths",
    columnName: "status",
    definition: "LONGTEXT NOT NULL DEFAULT ('draft')",
  },
  {
    tableName: "submission_confirmations",
    columnName: "evidence_snapshot_json",
    definition: "LONGTEXT NOT NULL DEFAULT ('{}')",
  },
  {
    tableName: "response_package_exports",
    columnName: "format",
    definition: "VARCHAR(32) NOT NULL DEFAULT 'markdown'",
  },
  {
    tableName: "response_package_exports",
    columnName: "review_status",
    definition: "LONGTEXT NOT NULL DEFAULT ('pending_review')",
  },
  {
    tableName: "response_package_exports",
    columnName: "reviewed_at",
    definition: "LONGTEXT",
  },
  {
    tableName: "response_package_exports",
    columnName: "reviewed_by_user_id",
    definition: "VARCHAR(191)",
  },
  {
    tableName: "response_package_exports",
    columnName: "review_notes",
    definition: "LONGTEXT NOT NULL DEFAULT ('')",
  },
  {
    tableName: "supplier_artifacts",
    columnName: "deleted_at",
    definition: "LONGTEXT",
  },
  {
    tableName: "supplier_artifacts",
    columnName: "deleted_by_user_id",
    definition: "VARCHAR(191)",
  },
  {
    tableName: "data_sources",
    columnName: "live_health_owner",
    definition: "LONGTEXT",
  },
  {
    tableName: "data_sources",
    columnName: "live_health_disposition",
    definition: "LONGTEXT",
  },
  {
    tableName: "data_sources",
    columnName: "live_health_next_review_at",
    definition: "LONGTEXT",
  },
  {
    tableName: "data_sources",
    columnName: "live_health_notes",
    definition: "LONGTEXT",
  },
  {
    tableName: "data_sources",
    columnName: "live_health_reviewed_at",
    definition: "LONGTEXT",
  },
  {
    tableName: "data_sources",
    columnName: "robots_txt_status",
    definition: "LONGTEXT",
  },
  {
    tableName: "data_sources",
    columnName: "robots_txt_checked_at",
    definition: "LONGTEXT",
  },
  {
    tableName: "data_sources",
    columnName: "robots_txt_hash",
    definition: "LONGTEXT",
  },
  {
    tableName: "data_sources",
    columnName: "robots_txt_disallows_crawled_paths",
    definition: "INT",
  },
  {
    tableName: "data_sources",
    columnName: "robots_txt_flag_reason",
    definition: "LONGTEXT",
  },
  {
    tableName: "data_sources",
    columnName: "tos_reviewed",
    definition: "INT",
  },
  {
    tableName: "data_sources",
    columnName: "tos_reviewed_at",
    definition: "LONGTEXT",
  },
  {
    tableName: "data_sources",
    columnName: "tos_url",
    definition: "LONGTEXT",
  },
  {
    tableName: "data_sources",
    columnName: "compliance_reviewer",
    definition: "LONGTEXT",
  },
  {
    tableName: "data_sources",
    columnName: "legal_opinion_reference",
    definition: "LONGTEXT",
  },
  {
    tableName: "data_sources",
    columnName: "compliance_review_due_at",
    definition: "LONGTEXT",
  },
  {
    tableName: "data_sources",
    columnName: "compliance_notes",
    definition: "LONGTEXT",
  },
  {
    tableName: "data_sources",
    columnName: "jurisdiction_level",
    definition: "VARCHAR(191)",
  },
  {
    tableName: "data_sources",
    columnName: "jurisdiction_name",
    definition: "LONGTEXT",
  },
  {
    tableName: "data_sources",
    columnName: "fips_code",
    definition: "VARCHAR(191)",
  },
  {
    tableName: "data_sources",
    columnName: "fetch_config",
    definition: "LONGTEXT",
  },
  {
    tableName: "bids",
    columnName: "jurisdiction_level",
    definition: "VARCHAR(191)",
  },
  {
    tableName: "bids",
    columnName: "jurisdiction_name",
    definition: "LONGTEXT",
  },
  {
    tableName: "bids",
    columnName: "fips_code",
    definition: "VARCHAR(191)",
  },
];

export function mysqlColumnMigrationStatements() {
  return mysqlColumnMigrations.map(
    (migration) =>
      `ALTER TABLE ${migration.tableName} ADD COLUMN ${migration.columnName} ${migration.definition}`,
  );
}

interface MysqlIndexMigration {
  tableName: string;
  indexName: string;
  columns: string[];
}

// Indexes on columns added after a table's initial CREATE TABLE statement can't live inside the
// first sqlite.exec() block (see migrate.ts): a pre-existing MySQL/SQLite database won't have the
// column yet when that block runs, so CREATE INDEX would fail before the column migration below
// gets a chance to add it. These are applied separately, after mysqlColumnMigrations, in
// runMysqlMigrations.
const mysqlIndexMigrations: MysqlIndexMigration[] = [
  {
    tableName: "data_sources",
    indexName: "idx_data_sources_jurisdiction",
    columns: ["jurisdiction_level", "state_code"],
  },
  {
    tableName: "bids",
    indexName: "idx_bids_fips_code",
    columns: ["fips_code"],
  },
];

export function mysqlIndexMigrationStatements() {
  return mysqlIndexMigrations.map(
    (migration) => `CREATE INDEX ${migration.indexName} ON ${migration.tableName}(${migration.columns.join(", ")})`,
  );
}

function indexMigrationColumnNameSet() {
  const columns = new Set<string>();

  for (const migration of mysqlIndexMigrations) {
    for (const column of migration.columns) {
      columns.add(column);
    }
  }

  return columns;
}

function assertMysqlIdentifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid MySQL identifier: ${value}`);
  }
}

async function addMysqlColumnIfMissing(pool: Pool, migration: MysqlColumnMigration) {
  assertMysqlIdentifier(migration.tableName);
  assertMysqlIdentifier(migration.columnName);

  const [rows] = await pool.query(
    `SHOW COLUMNS FROM ${migration.tableName} LIKE ?`,
    [migration.columnName],
  );
  if (Array.isArray(rows) && rows.length > 0) return false;

  await pool.query(`ALTER TABLE ${migration.tableName} ADD COLUMN ${migration.columnName} ${migration.definition}`);
  return true;
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

  for (const columnMigration of mysqlColumnMigrations) {
    const applied = await addMysqlColumnIfMissing(pool, columnMigration);
    if (applied) {
      appliedStatements += 1;
    } else {
      skippedStatements += 1;
    }
  }

  // Runs after the column migrations above so the indexed columns are guaranteed to exist,
  // whether this is a brand-new database (columns came from mysqlMigrationStatements) or an
  // existing one (columns just got added by the loop above).
  for (const indexStatement of mysqlIndexMigrationStatements()) {
    try {
      await pool.query(indexStatement);
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
