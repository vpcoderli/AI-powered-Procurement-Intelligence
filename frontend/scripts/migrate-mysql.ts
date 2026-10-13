import { createMysqlPool, redactMysqlDatabaseUrl, requireMysqlDatabaseUrl, runMysqlMigrations } from "../src/server/db/mysql";

async function main() {
  const databaseUrl = requireMysqlDatabaseUrl();
  // Before anything is migrated, and before a connection is tried: the migrations re-type, re-key and delete legacy rows, so a
  // run that fails still says which database it hit. stderr, like the other integrity tools (data:integrity, bids:purge-demo,
  // bids:lifecycle:sweep), and the same format; the password is masked.
  console.error(`Target: mysql ${redactMysqlDatabaseUrl(databaseUrl)}`);
  const pool = createMysqlPool(databaseUrl);

  try {
    const result = await runMysqlMigrations(pool);
    console.log(
      `MySQL migrated: ${result.appliedStatements} statements applied, ${result.skippedStatements} statements skipped.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
