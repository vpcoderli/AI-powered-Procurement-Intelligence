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
const DEFAULT_CONNECTION_LIMIT = 10;
const DEFAULT_MAX_IDLE = 4;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

// The default pool is parked on globalThis instead of in a module variable. Next dev re-evaluates server
// modules on every hot reload (and a route bundle can carry its own copy of this one), so a module-level
// cache leaks one pool of up to MYSQL_CONNECTION_LIMIT connections per evaluation: on 2026-09-29 a
// long-lived dev server held 147 of MySQL's 151 connections. Every copy of this module now shares one pool,
// and closeResolvedMysqlPool() still releases it for workers and scripts.
const globalPools = globalThis as typeof globalThis & { __apsiMysqlPool?: Pool };

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

export interface MysqlPoolSizing {
  connectionLimit: number;
  maxIdle: number;
  idleTimeout: number;
}

/** A whole number of at least `minimum`; blank, fractional, negative, non-numeric or unsafe values read as unset. */
function integerFromEnv(value: string | undefined, minimum: number) {
  const text = value?.trim();
  if (!text || !/^\d+$/.test(text)) return undefined;

  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : undefined;
}

/**
 * Pool sizing from MYSQL_CONNECTION_LIMIT, MYSQL_MAX_IDLE and MYSQL_IDLE_TIMEOUT_MS.
 *
 * The limit (a whole number of at least 1, default 10; a blank, non-numeric, fractional, negative or 0 value reads
 * as unset, so 0 does not mean unlimited here as it does to mysql2) sizes the ONE shared pool of a process
 * (resolveMysqlPool): every route of the web process, or a worker's whole loop, draws on it. A query past the
 * limit waits in mysql2's queue (queueLimit 0, no acquire timeout) instead of failing.
 *
 * maxIdle is a hard cap on free connections (default min(4, limit - 1), but at least 1; an explicit value is
 * honoured as given, capped at the limit). mysql2 3.22.4's reaper (lib/base/pool.js, a timer that ticks once a
 * second) closes the oldest free connection while more than maxIdle are free or the oldest has been idle for
 * longer than idleTimeout (default 60 000 ms): after a burst of more than maxIdle concurrent queries the extras
 * close within about a second, and a quiet process drops to none.
 *
 * mysql2 starts the reaper only when the pool is created with maxIdle < connectionLimit, and its own default
 * (maxIdle = connectionLimit) never does: idle connections used to stay open for good. So the default keeps one
 * connection of headroom below the limit (limit - 1 for a limit of 2 to 4, and 4 from 5 up). A limit of 1 has
 * no such headroom: its maxIdle is 1, equal to the limit, so no reaper starts and the single connection stays
 * open until the pool ends, as it does for any explicit MYSQL_MAX_IDLE at or above the limit.
 */
export function mysqlPoolSizing(env: Readonly<Record<string, string | undefined>> = process.env): MysqlPoolSizing {
  const connectionLimit = integerFromEnv(env.MYSQL_CONNECTION_LIMIT, 1) ?? DEFAULT_CONNECTION_LIMIT;
  const defaultMaxIdle = Math.min(DEFAULT_MAX_IDLE, Math.max(connectionLimit - 1, 1));
  const maxIdle = Math.min(integerFromEnv(env.MYSQL_MAX_IDLE, 0) ?? defaultMaxIdle, connectionLimit);
  const idleTimeout = integerFromEnv(env.MYSQL_IDLE_TIMEOUT_MS, 1) ?? DEFAULT_IDLE_TIMEOUT_MS;

  return { connectionLimit, maxIdle, idleTimeout };
}

/**
 * A pool sized by mysqlPoolSizing (one per process, see resolveMysqlPool).
 *
 * gracefulEnd makes mysql2's idle reaper close a connection the way pool.end() does, with a COM_QUIT. Without it
 * the reaper only ends the socket, and MySQL counts every connection it reaps as an aborted client
 * (`Aborted_clients`, plus one "Aborted connection ... (Got an error reading communication packets)" entry in the
 * server log), so a healthy pool that merely sheds idle connections looked like a flaky network. Measured
 * against MySQL 8.4 with a 3-connection pool (maxIdle 1, idleTimeout 2 s): each reaped connection counted
 * without the option and none with it; queries, transactions, the pool queue and pool.end() behaved the same.
 *
 * The option has one other effect: end() on a pooled connection now really closes it and removes it from the
 * pool, where without the option it is a deprecated alias of release(). Hand pooled connections back with
 * release() (nothing here calls end() on one).
 */
export function createMysqlPool(databaseUrl = requireMysqlDatabaseUrl()): Pool {
  return mysql.createPool({
    uri: databaseUrl,
    ...mysqlPoolSizing(),
    gracefulEnd: true,
    multipleStatements: false,
    namedPlaceholders: false,
  });
}

/** The process-wide pool, created from `databaseUrl` on first use; later calls return it whatever they pass. */
export function resolveMysqlPool(databaseUrl = requireMysqlDatabaseUrl()): Pool {
  globalPools.__apsiMysqlPool ??= createMysqlPool(databaseUrl);

  return globalPools.__apsiMysqlPool;
}

/** Forgets the shared pool without ending it; a test that opened real connections closes them itself. */
export function resetMysqlPoolForTests() {
  globalPools.__apsiMysqlPool = undefined;
}

export async function closeResolvedMysqlPool() {
  const pool = globalPools.__apsiMysqlPool;
  if (!pool) return;

  globalPools.__apsiMysqlPool = undefined;
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
  // Attachment repair bookkeeping (C4).
  {
    tableName: "bid_attachments",
    columnName: "verified_at",
    definition: "VARCHAR(191)",
  },
  {
    tableName: "bid_attachments",
    columnName: "repair_attempts",
    definition: "INT NOT NULL DEFAULT 0",
  },
  {
    tableName: "bid_attachments",
    columnName: "next_repair_at",
    definition: "VARCHAR(191)",
  },
  {
    tableName: "bid_attachments",
    columnName: "failure_kind",
    definition: "VARCHAR(191)",
  },
  // Bid lifecycle + activity tiers (spec 2026-09-24 phase 1).
  { tableName: "bids", columnName: "lifecycle_status", definition: "LONGTEXT NOT NULL DEFAULT ('open')" },
  { tableName: "bids", columnName: "awarded_date", definition: "LONGTEXT" },
  { tableName: "bids", columnName: "solicitation_number", definition: "LONGTEXT" },
  { tableName: "data_sources", columnName: "consecutive_empty_runs", definition: "INT NOT NULL DEFAULT 0" },
  // Precheck queue (spec 2026-09-24 phase 3).
  { tableName: "data_sources", columnName: "precheck_requested_at", definition: "LONGTEXT" },
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
  {
    tableName: "bid_attachments",
    indexName: "idx_bid_attachments_repair",
    columns: ["archive_status", "next_repair_at"],
  },
];

export function mysqlIndexMigrationStatements() {
  return mysqlIndexMigrations.map(
    (migration) => `CREATE INDEX ${migration.indexName} ON ${migration.tableName}(${migration.columns.join(", ")})`,
  );
}

/**
 * migrate.ts's last statement, for MySQL: bids stored before the data-usability change carry
 * issuer_type 'state' even when their registered source is local; give them the source's level.
 */
export const MYSQL_LOCAL_ISSUER_TYPE_BACKFILL = "UPDATE bids JOIN data_sources ON data_sources.id = SUBSTRING_INDEX(bids.id, ':', 1)"
  + " SET bids.issuer_type = data_sources.jurisdiction_level"
  + " WHERE bids.issuer_type = 'state' AND LOCATE(':', bids.id) > 1"
  + " AND data_sources.jurisdiction_level IN ('county', 'city', 'township', 'special_district')"
  + " AND UPPER(data_sources.state_code) = UPPER(bids.state_code)"
  + " AND (bids.jurisdiction_level IS NULL OR bids.jurisdiction_level = '' OR bids.jurisdiction_level = data_sources.jurisdiction_level)";

/** Idempotent data fixes that run after every column and index migration. */
export function mysqlDataMigrationStatements(): string[] {
  return [
    "UPDATE bids SET lifecycle_status = 'closed' WHERE is_active = 0 AND lifecycle_status = 'open'",
    MYSQL_LOCAL_ISSUER_TYPE_BACKFILL,
  ];
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

export interface MysqlColumnShape {
  dataType: string;
  isNullable: string;
  columnDefault: string | null;
}

function mysqlTextDefaultLiteral(columnDefault: string | null) {
  if (columnDefault === null || columnDefault === undefined) return null;

  // MySQL 8 reports expression defaults (the only kind a LONGTEXT column can carry) as the
  // expression text, e.g. `_utf8mb4\'not_archived\'`; plain column defaults come back as the
  // raw value.
  const withoutIntroducer = columnDefault.replace(/^_[A-Za-z0-9]+/, "");
  const quoted = withoutIntroducer.match(/^\\?'([\s\S]*?)\\?'$/);
  const value = quoted ? quoted[1].replace(/\\'/g, "'").replace(/''/g, "'") : columnDefault;

  if (!quoted && value.toUpperCase() === "NULL") return null;

  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

/**
 * The column definition needed to narrow a text column so MySQL can index it, or null when the
 * column is already indexable. Nullability and the existing default are preserved: dropping
 * `DEFAULT 'not_archived'` off `bid_attachments.archive_status` would break inserts that omit it.
 */
export function mysqlIndexColumnModification(column: MysqlColumnShape): string | null {
  const dataType = column.dataType.trim().toLowerCase();
  if (dataType !== "longtext" && dataType !== "text" && dataType !== "mediumtext") return null;

  const nullability = column.isNullable.trim().toUpperCase() === "YES" ? " NULL" : " NOT NULL";
  const literal = mysqlTextDefaultLiteral(column.columnDefault);

  return `VARCHAR(191)${nullability}${literal ? ` DEFAULT ${literal}` : ""}`;
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

  // Fix columns that were originally created as LONGTEXT but now need to be indexed.
  // MySQL cannot index LONGTEXT without a prefix length, so narrow them to VARCHAR(191) first.
  for (const indexMigration of mysqlIndexMigrations) {
    for (const column of indexMigration.columns) {
      assertMysqlIdentifier(indexMigration.tableName);
      assertMysqlIdentifier(column);
      try {
        const [rows] = await pool.query(
          `SELECT DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
          [indexMigration.tableName, column],
        );
        const record = Array.isArray(rows) && rows.length > 0 ? (rows[0] as Record<string, unknown>) : null;
        const definition = record
          ? mysqlIndexColumnModification({
              dataType: String(record.DATA_TYPE ?? ""),
              isNullable: String(record.IS_NULLABLE ?? "YES"),
              columnDefault: record.COLUMN_DEFAULT === null || record.COLUMN_DEFAULT === undefined ? null : String(record.COLUMN_DEFAULT),
            })
          : null;
        if (definition) {
          await pool.query(`ALTER TABLE ${indexMigration.tableName} MODIFY COLUMN ${column} ${definition}`);
          appliedStatements += 1;
        }
      } catch {
        // Column may not exist yet on a fresh database — the index migration will still work
        // because mysqlMigrationStatements already sized the column to VARCHAR(191).
      }
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

  for (const statement of mysqlDataMigrationStatements()) {
    await pool.query(statement);
    appliedStatements += 1;
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
