import { describe, expect, it } from "vitest";
import {
  buildMysqlSmokeBid,
  redactMysqlDatabaseUrl,
  validateMysqlSmokeInspection,
  type MysqlSmokeInspection,
} from "./mysql-smoke";

function completeInspection(overrides: Partial<MysqlSmokeInspection> = {}): MysqlSmokeInspection {
  return {
    tableCount: 37,
    descriptionType: "longtext",
    sourceType: "varchar(191)",
    organizationIdType: "varchar(191)",
    storedDescriptionLength: 5000,
    scraperHealthSourceCount: 1,
    adminCrawlerLogCount: 1,
    bidSearchCount: 1,
    bidDetailVerified: true,
    attachmentVerified: true,
    savedBidVerified: true,
    profileVerified: true,
    intentVerified: true,
    deadlineReminderVerified: true,
    complianceVerified: true,
    submissionVerified: true,
    responseWorkspaceVerified: true,
    responseWorkspaceArtifactLinkVerified: true,
    pursuitDecisionVerified: true,
    qualificationVerified: true,
    billingVerified: true,
    billingReconcileVerified: true,
    billingDunningVerified: true,
    knowledgeStationVerified: true,
    workspaceVerified: true,
    workspaceMemberVerified: true,
    adminUsersVerified: true,
    adminConfigVerified: true,
    eventOutboxVerified: true,
    adminBidQaVerified: true,
    crawlerImportVerified: true,
    crawlerControlVerified: true,
    crawlerAlertMatchingVerified: true,
    accountUsageVerified: true,
    notificationPreferencesVerified: true,
    accountExportVerified: true,
    notificationOutboxVerified: true,
    searchAlertVerified: true,
    passwordResetVerified: true,
    authSessionVerified: true,
    ...overrides,
  };
}

describe("mysql smoke verifier helpers", () => {
  it("redacts database credentials before printing connection details", () => {
    expect(redactMysqlDatabaseUrl("mysql://user:secret@localhost:3306/winbids")).toBe(
      "mysql://user:***@localhost:3306/winbids",
    );
    expect(redactMysqlDatabaseUrl("mysql://localhost:3306/winbids")).toBe("mysql://localhost:3306/winbids");
  });

  it("builds a smoke bid with long content for LONGTEXT validation", () => {
    const bid = buildMysqlSmokeBid("2026-06-01T00:00:00.000Z");

    expect(bid.id).toMatch(/^mysql_smoke_/);
    expect(bid.description).toHaveLength(5000);
    expect(bid.source).toBe("mysql_smoke");
    expect(bid.createdAt).toBe("2026-06-01T00:00:00.000Z");
  });

  it("rejects incomplete MySQL smoke inspection results", () => {
    expect(() => validateMysqlSmokeInspection(completeInspection())).not.toThrow();

    const cases: Array<[Partial<MysqlSmokeInspection>, string]> = [
      [{ deadlineReminderVerified: false }, "expected MySQL deadline reminder lifecycle to verify"],
      [
        { responseWorkspaceArtifactLinkVerified: false },
        "expected MySQL response workspace artifact link lifecycle to verify",
      ],
      [{ scraperHealthSourceCount: 0 }, "expected MySQL scraper health query to return at least one source"],
      [{ adminCrawlerLogCount: 0 }, "expected MySQL admin crawler log query to return at least one log"],
      [{ bidSearchCount: 0 }, "expected MySQL bid search query to return at least one bid"],
      [{ bidDetailVerified: false }, "expected MySQL bid detail query to verify"],
      [{ attachmentVerified: false }, "expected MySQL attachment metadata lifecycle to verify"],
      [{ savedBidVerified: false }, "expected MySQL saved bid lifecycle to verify"],
      [{ profileVerified: false }, "expected MySQL supplier profile lifecycle to verify"],
      [{ intentVerified: false }, "expected MySQL intent lifecycle to verify"],
      [{ billingVerified: false }, "expected MySQL billing lifecycle to verify"],
      [{ billingReconcileVerified: false }, "expected MySQL billing reconcile lifecycle to verify"],
      [{ billingDunningVerified: false }, "expected MySQL billing dunning lifecycle to verify"],
      [{ knowledgeStationVerified: false }, "expected MySQL knowledge station lifecycle to verify"],
      [{ workspaceVerified: false }, "expected MySQL workspace lifecycle to verify"],
      [{ workspaceMemberVerified: false }, "expected MySQL workspace member lifecycle to verify"],
      [{ accountUsageVerified: false }, "expected MySQL account usage lifecycle to verify"],
      [
        { notificationPreferencesVerified: false },
        "expected MySQL notification preferences lifecycle to verify",
      ],
      [{ accountExportVerified: false }, "expected MySQL account export lifecycle to verify"],
      [{ notificationOutboxVerified: false }, "expected MySQL notification outbox lifecycle to verify"],
      [{ searchAlertVerified: false }, "expected MySQL search alert lifecycle to verify"],
      [{ passwordResetVerified: false }, "expected MySQL password reset lifecycle to verify"],
      [{ authSessionVerified: false }, "expected MySQL auth session lifecycle to verify"],
      [
        {
          tableCount: 36,
          descriptionType: "varchar(191)",
          sourceType: "longtext",
          organizationIdType: "longtext",
          storedDescriptionLength: 191,
        },
        "MySQL smoke verification failed",
      ],
    ];

    for (const [overrides, message] of cases) {
      expect(() => validateMysqlSmokeInspection(completeInspection(overrides))).toThrow(message);
    }
  });
});
