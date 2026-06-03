import path from "node:path";
import { createMysqlPool, runMysqlMigrations } from "../src/server/db/mysql";
import { mysqlSmokeConnectionSummary } from "../src/server/db/mysql-smoke";
import { importSqliteDatabaseIntoMysql } from "../src/server/db/sqlite-mysql-import";

function argValue(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function sourcePath() {
  return path.resolve(argValue("source") ?? process.env.DATABASE_PATH?.trim() ?? path.join("data", "apsi.sqlite"));
}

function tableList() {
  const value = argValue("tables")?.trim();
  if (!value) return undefined;

  return value.split(",").map((table) => table.trim()).filter(Boolean);
}

function batchSize() {
  const value = Number(argValue("batch-size") ?? process.env.SQLITE_MYSQL_IMPORT_BATCH_SIZE);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

async function main() {
  const pool = createMysqlPool();

  try {
    console.log(`MySQL import target: ${mysqlSmokeConnectionSummary()}`);
    console.log(`SQLite import source: ${sourcePath()}`);

    const migrationResult = await runMysqlMigrations(pool);
    const importResult = await importSqliteDatabaseIntoMysql(pool, sourcePath(), {
      tables: tableList(),
      batchSize: batchSize(),
    });

    console.log(
      `MySQL migration check: ${migrationResult.appliedStatements} statements applied, ${migrationResult.skippedStatements} statements skipped.`,
    );
    console.log(
      `SQLite to MySQL import copied ${importResult.totalRowsCopied} rows across ${importResult.tables.length} tables.`,
    );
    for (const table of importResult.tables) {
      console.log(`- ${table.tableName}: ${table.rowsCopied}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
