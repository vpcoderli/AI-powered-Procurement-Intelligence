import { createMysqlPool, runMysqlMigrations } from "../src/server/db/mysql";

async function main() {
  const pool = createMysqlPool();

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
