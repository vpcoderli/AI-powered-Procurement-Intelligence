import { db } from "../src/server/db/client";
import { closeResolvedMysqlPool, isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "../src/server/db/mysql";
import {
  assertRiskChecklistReport,
  createRiskChecklistReport,
  createRiskChecklistReportFromMysql,
  formatRiskChecklistReport,
  riskChecklistCiAnnotation,
} from "../src/server/risk/checklist";

async function main() {
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const report = mysql
    ? await createRiskChecklistReportFromMysql(mysql)
    : await createRiskChecklistReport(db);
  console.log(formatRiskChecklistReport(report));
  // An INCOMPLETE report exits 0, so on GitHub Actions it also says so in the check summary, beside the green step.
  const annotation = riskChecklistCiAnnotation(report);
  if (annotation) console.log(annotation);
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
