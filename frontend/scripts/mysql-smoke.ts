import { closeResolvedMysqlPool, createMysqlPool } from "../src/server/db/mysql";
import { mysqlSmokeConnectionSummary, runMysqlSmokeVerification } from "../src/server/db/mysql-smoke";

async function main() {
  const pool = createMysqlPool();

  try {
    console.log(`MySQL smoke target: ${mysqlSmokeConnectionSummary()}`);

    const result = await runMysqlSmokeVerification(pool);

    console.log(
      `MySQL smoke passed: ${result.inspection.tableCount} tables, bids.description=${result.inspection.descriptionType}, bids.source=${result.inspection.sourceType}, long content length=${result.inspection.storedDescriptionLength}, scraper health sources=${result.inspection.scraperHealthSourceCount}, admin crawler logs=${result.inspection.adminCrawlerLogCount}, bid search results=${result.inspection.bidSearchCount}, bid detail verified=${result.inspection.bidDetailVerified}, attachment verified=${result.inspection.attachmentVerified}, saved bid verified=${result.inspection.savedBidVerified}, profile verified=${result.inspection.profileVerified}, intent verified=${result.inspection.intentVerified}, billing verified=${result.inspection.billingVerified}, workspace verified=${result.inspection.workspaceVerified}, account usage verified=${result.inspection.accountUsageVerified}, notification preferences verified=${result.inspection.notificationPreferencesVerified}, account export verified=${result.inspection.accountExportVerified}, search alert verified=${result.inspection.searchAlertVerified}, password reset verified=${result.inspection.passwordResetVerified}, auth session verified=${result.inspection.authSessionVerified}.`,
    );
    console.log(
      `Migration check: ${result.migrationResult.appliedStatements} statements applied, ${result.migrationResult.skippedStatements} statements skipped.`,
    );
  } finally {
    await closeResolvedMysqlPool();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
