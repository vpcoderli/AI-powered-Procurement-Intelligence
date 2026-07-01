import { db } from "../src/server/db/client";
import { closeResolvedMysqlPool, isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "../src/server/db/mysql";
import {
  assertRiskChecklistReport,
  createRiskChecklistReport,
  createRiskChecklistReportFromMysql,
  formatRiskChecklistReport,
} from "../src/server/risk/checklist";

async function main() {
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const report = mysql
    ? await createRiskChecklistReportFromMysql(mysql)
    : await createRiskChecklistReport(db);
  console.log(formatRiskChecklistReport(report));
  assertRiskChecklistReport(report);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await closeResolvedMysqlPool();
  });
