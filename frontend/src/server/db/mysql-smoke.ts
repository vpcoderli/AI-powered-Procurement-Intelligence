import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Pool } from "mysql2/promise";
import { listAdminCrawlerLogsFromMysql } from "@/server/admin/data-sources-repository";
import { exportMysqlAccountData } from "@/server/account/lifecycle";
import {
  getAccountNotificationPreferencesFromMysql,
  updateAccountNotificationPreferencesFromMysql,
} from "@/server/account/notification-preferences";
import { getAccountUsageFromMysql } from "@/server/account/usage";
import {
  acceptMysqlWorkspaceInvitation,
  disableMysqlWorkspaceMember,
  getMysqlAccountWorkspace,
  inviteMysqlWorkspaceMember,
  removeMysqlWorkspaceMember,
  resendMysqlWorkspaceInvitation,
  restoreMysqlWorkspaceMember,
  revokeMysqlWorkspaceInvitation,
  transferMysqlWorkspaceOwnership,
  updateMysqlOrganizationName,
} from "@/server/account/mysql-workspace";
import {
  batchUpdateAdminBidQaItemsFromMysql,
  listAdminBidQaCorrectionsFromMysql,
  listAdminBidQaItemsFromMysql,
  updateAdminBidQaCorrectionFromMysql,
  updateAdminBidQaDisplayStatusFromMysql,
  updateAdminBidQaReviewFromMysql,
} from "@/server/admin/bid-qa-repository";
import {
  listAdminDataSourcesFromMysql,
  updateAdminDataSourceFromMysql,
} from "@/server/admin/data-sources-repository";
import {
  createAdminUserInviteFromMysql,
  listAdminUserAuditLogsFromMysql,
  listAdminUserFeatureOverridesFromMysql,
  listAdminUsersFromMysql,
  updateAdminUserFeatureOverrideFromMysql,
  updateAdminUserFromMysql,
} from "@/server/admin/users-repository";
import { getMysqlSessionUser, loginMysqlUser, logoutMysqlSession, registerMysqlUser } from "@/server/auth/mysql-service";
import { requestPasswordResetFromMysql, resetPasswordWithTokenFromMysql } from "@/server/auth/password-reset";
import { getBidAttachmentDownloadFromMysql } from "@/server/bids/attachments";
import {
  listSavedBidIdsFromMysql,
  removeSavedBidIdFromMysql,
  saveSavedBidIdFromMysql,
} from "@/server/bids/repository";
import { getBidByIdFromMysqlRuntime, queryBidsFromMysql } from "@/server/bids/service";
import {
  applyMysqlBillingProviderEvent,
  createMysqlCheckoutSession,
  createMysqlCustomerPortalSession,
  getMysqlAccountSubscription,
  reconcileMysqlSubscriptionLifecycle,
} from "@/server/billing/mysql-subscriptions";
import { scheduleDunningRemindersFromMysql } from "@/server/billing/dunning";
import {
  getOrCreateComplianceManifest,
  updateComplianceManifestItem,
} from "@/server/compliance/service";
import {
  getEffectiveConfigValueFromMysql,
  listConfigEntriesFromMysql,
  upsertConfigEntryFromMysql,
} from "@/server/config/registry";
import { listScraperHealthSourcesFromMysql } from "@/server/crawler/logs-repository";
import {
  acquireCrawlerLockFromMysql,
  releaseCrawlerLockFromMysql,
} from "@/server/crawler/lock-repository";
import { importCrawlerSqliteRunIntoMysql } from "@/server/crawler/mysql-importer";
import {
  acknowledgeAccountDeadlineReminder,
  getAccountDeadlineReminderCenter,
  getDeadlineWorkspace,
  snoozeAccountDeadlineReminder,
} from "@/server/deadlines/service";
import { deliverPendingEventOutboxRowsFromMysql, writeAuditEventFromMysql } from "@/server/events/event-log";
import { createIntentForBid, listUserIntents, updateIntentStatus } from "@/server/intents/service";
import { deliverPendingNotificationsFromMysql } from "@/server/notifications/delivery";
import {
  createKnowledgeItemFromMysql,
  listKnowledgeItemsFromMysql,
} from "@/server/knowledge/service";
import {
  enqueueNotificationFromMysql,
  listRecentNotificationsFromMysql,
} from "@/server/notifications/outbox-repository";
import { upsertMysqlSupplierProfile } from "@/server/profile/mysql-service";
import {
  createPursuitDecision,
  getPursuitDecisionBoard,
} from "@/server/pursuit/service";
import { getOrCreateQualificationCitations } from "@/server/qualification/citations";
import {
  getQualificationFreshness,
  refreshQualificationEvidence,
} from "@/server/qualification/freshness";
import { answerQualificationQuestion } from "@/server/qualification/qa";
import {
  createSearchAlertFromMysql,
  deleteSearchAlertFromMysql,
  listSearchAlertsFromMysql,
  updateSearchAlertFromMysql,
} from "@/server/search-alerts/service";
import { createSupplierArtifact } from "@/server/artifacts/service";
import { matchEnabledSearchAlertsFromMysql } from "@/server/search-alerts/matcher";
import { sendMatchedAlertNotificationsFromMysql } from "@/server/notifications/service";
import {
  createSubmissionConfirmation,
  getOrCreateSubmissionGuidance,
  updateSubmissionGuidance,
} from "@/server/submission/service";
import {
  getOrCreateResponseWorkspace,
  updateResponseWorkspaceItem,
} from "@/server/response-workspace/service";
import { createDatabase, type AppDatabase } from "./client";
import { createMysqlPool, requireMysqlDatabaseUrl, runMysqlMigrations } from "./mysql";
import { runMigrations } from "./migrate";

const MYSQL_SMOKE_SOURCE_URL = "https://sam.gov/search/?index=opp&sort=-modifiedDate&page=1&pageSize=25";
const MYSQL_SMOKE_ATTACHMENT_URL = `${MYSQL_SMOKE_SOURCE_URL}&keyword=smoke`;

export interface MysqlSmokeBid {
  id: string;
  source: string;
  dedupeKey: string;
  title: string;
  description: string;
  currency: string;
  issuerName: string;
  issuerType: string;
  stateCode: string;
  sourceUrl: string;
  createdAt: string;
}

export interface MysqlSmokeInspection {
  tableCount: number;
  descriptionType: string;
  sourceType: string;
  organizationIdType: string;
  storedDescriptionLength: number;
  scraperHealthSourceCount: number;
  adminCrawlerLogCount: number;
  bidSearchCount: number;
  bidDetailVerified: boolean;
  attachmentVerified: boolean;
  savedBidVerified: boolean;
  profileVerified: boolean;
  intentVerified: boolean;
  deadlineReminderVerified?: boolean;
  complianceVerified?: boolean;
  submissionVerified?: boolean;
  responseWorkspaceVerified?: boolean;
  responseWorkspaceArtifactLinkVerified?: boolean;
  pursuitDecisionVerified?: boolean;
  qualificationVerified?: boolean;
  billingVerified: boolean;
  billingReconcileVerified?: boolean;
  billingDunningVerified?: boolean;
  knowledgeStationVerified?: boolean;
  workspaceVerified: boolean;
  workspaceMemberVerified: boolean;
  adminUsersVerified?: boolean;
  adminConfigVerified?: boolean;
  eventOutboxVerified?: boolean;
  adminBidQaVerified?: boolean;
  crawlerImportVerified?: boolean;
  crawlerControlVerified?: boolean;
  crawlerAlertMatchingVerified?: boolean;
  accountUsageVerified: boolean;
  notificationPreferencesVerified: boolean;
  accountExportVerified: boolean;
  notificationOutboxVerified: boolean;
  searchAlertVerified: boolean;
  passwordResetVerified: boolean;
  authSessionVerified: boolean;
}

export function redactMysqlDatabaseUrl(databaseUrl: string) {
  try {
    const url = new URL(databaseUrl);
    if (url.password) {
      url.password = "***";
    }
    return url.toString();
  } catch {
    return databaseUrl.replace(/:\/\/([^:@/]+):([^@/]+)@/, "://$1:***@");
  }
}

export function buildMysqlSmokeBid(now = new Date().toISOString()): MysqlSmokeBid {
  const safeTimestamp = now.replace(/[^0-9A-Za-z]/g, "");

  return {
    id: `mysql_smoke_${safeTimestamp}`,
    source: "mysql_smoke",
    dedupeKey: `mysql_smoke_${safeTimestamp}`,
    title: "MySQL Smoke Bid",
    description: "x".repeat(5000),
    currency: "USD",
    issuerName: "MySQL Smoke Agency",
    issuerType: "state",
    stateCode: "CA",
    sourceUrl: MYSQL_SMOKE_SOURCE_URL,
    createdAt: now,
  };
}

function buildMysqlCrawlerImportBid(now: string): MysqlSmokeBid {
  const safeTimestamp = now.replace(/[^0-9A-Za-z]/g, "");

  return {
    id: `mysql_crawler_import_${safeTimestamp}`,
    source: "mysql_crawler_import",
    dedupeKey: `mysql_crawler_import_${safeTimestamp}`,
    title: "MySQL Crawler Import Bid",
    description: "Crawler importer non-empty description",
    currency: "USD",
    issuerName: "MySQL Import Agency",
    issuerType: "state",
    stateCode: "TX",
    sourceUrl: `${MYSQL_SMOKE_SOURCE_URL}&keyword=crawler`,
    createdAt: now,
  };
}

function addDaysIso(value: string, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

async function cleanupPreviousMysqlSmokeBillingRows(pool: Pool) {
  await pool.execute("DELETE FROM notification_outbox WHERE dedupe_key LIKE 'billing:dunning:%mysql_smoke_%_invoice_failed'");
  await pool.execute("DELETE FROM billing_invoices WHERE provider_invoice_id LIKE 'mysql_smoke_%_invoice_failed'");
}

async function runMysqlCrawlerImportSmoke(pool: Pool, now: string) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "mysql-crawler-import-smoke-"));
  const databasePath = path.join(directory, "apsi.sqlite");
  const sqliteDb = createDatabase(databasePath);
  const importBid = buildMysqlCrawlerImportBid(now);

  try {
    runMigrations(sqliteDb);
    sqliteDb.$client.prepare(`
      INSERT INTO bids (
        id,
        source,
        source_bid_id,
        dedupe_key,
        title,
        description,
        currency,
        deadline_date,
        issuer_name,
        issuer_type,
        state_code,
        source_url,
        source_confidence,
        quality_flags_json,
        first_seen_at,
        last_seen_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      importBid.id,
      importBid.source,
      "MYSQL-IMPORT-1",
      importBid.dedupeKey,
      importBid.title,
      importBid.description,
      importBid.currency,
      "2026-08-01",
      importBid.issuerName,
      importBid.issuerType,
      importBid.stateCode,
      importBid.sourceUrl,
      "high",
      "[]",
      importBid.createdAt,
      importBid.createdAt,
      importBid.createdAt,
      importBid.createdAt,
    );
    sqliteDb.$client.prepare(`
      INSERT INTO bid_attachments (
        id,
        bid_id,
        name,
        url,
        original_url,
        archive_status,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      `${importBid.id}:attachment:1`,
      importBid.id,
      "Import Scope.pdf",
      `${MYSQL_SMOKE_SOURCE_URL}&keyword=import-scope`,
      `${MYSQL_SMOKE_SOURCE_URL}&keyword=import-scope`,
      "not_archived",
      importBid.createdAt,
    );
    sqliteDb.$client.prepare(`
      INSERT INTO crawler_logs (
        id,
        source,
        run_id,
        status,
        started_at,
        finished_at,
        fetched_count,
        inserted_count,
        updated_count,
        metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `${importBid.id}_log`,
      importBid.source,
      `${importBid.id}_run`,
      "success",
      importBid.createdAt,
      importBid.createdAt,
      1,
      1,
      0,
      JSON.stringify({ mode: "mysql-smoke" }),
    );
    sqliteDb.$client.close();

    const importResult = await importCrawlerSqliteRunIntoMysql(pool, databasePath);
    const importedBid = await getBidByIdFromMysqlRuntime(pool, importBid.id);
    const importedAttachment = await getBidAttachmentDownloadFromMysql(
      pool,
      importBid.id,
      `${importBid.id}:attachment:1`,
    );
    const importedHealth = await listScraperHealthSourcesFromMysql(pool);

    return {
      bid: importBid,
      verified:
        importResult.fetchedCount === 1 &&
        importResult.insertedCount === 1 &&
        importedBid?.id === importBid.id &&
        importedBid.description === importBid.description &&
        importedAttachment?.kind === "fallback" &&
        importedHealth.some((source) =>
          source.source === importBid.source &&
          source.lastStatus === "success" &&
          source.fetchedCount === 1
        ),
    };
  } finally {
    try {
      sqliteDb.$client.close();
    } catch {
      // Ignore duplicate close attempts.
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

export function validateMysqlSmokeInspection(inspection: MysqlSmokeInspection) {
  const failures = [
    inspection.tableCount < 37 ? `expected at least 37 tables, found ${inspection.tableCount}` : null,
    inspection.descriptionType.toLowerCase() !== "longtext"
      ? `expected bids.description to be longtext, found ${inspection.descriptionType}`
      : null,
    inspection.sourceType.toLowerCase() !== "varchar(191)"
      ? `expected bids.source to be varchar(191), found ${inspection.sourceType}`
      : null,
    inspection.organizationIdType.toLowerCase() !== "varchar(191)"
      ? `expected organization_feature_overrides.organization_id to be varchar(191), found ${inspection.organizationIdType}`
      : null,
    inspection.storedDescriptionLength < 5000
      ? `expected 5000-character smoke description, found ${inspection.storedDescriptionLength}`
      : null,
    inspection.scraperHealthSourceCount < 1
      ? "expected MySQL scraper health query to return at least one source"
      : null,
    inspection.adminCrawlerLogCount < 1
      ? "expected MySQL admin crawler log query to return at least one log"
      : null,
    inspection.bidSearchCount < 1
      ? "expected MySQL bid search query to return at least one bid"
      : null,
    !inspection.bidDetailVerified
      ? "expected MySQL bid detail query to verify"
      : null,
    !inspection.attachmentVerified
      ? "expected MySQL attachment metadata lifecycle to verify"
      : null,
    !inspection.savedBidVerified
      ? "expected MySQL saved bid lifecycle to verify"
      : null,
    !inspection.profileVerified
      ? "expected MySQL supplier profile lifecycle to verify"
      : null,
    !inspection.intentVerified
      ? "expected MySQL intent lifecycle to verify"
      : null,
    inspection.deadlineReminderVerified === false
      ? "expected MySQL deadline reminder lifecycle to verify"
      : null,
    !inspection.complianceVerified
      ? "expected MySQL compliance manifest lifecycle to verify"
      : null,
    !inspection.submissionVerified
      ? "expected MySQL submission guidance lifecycle to verify"
      : null,
    !inspection.responseWorkspaceVerified
      ? "expected MySQL response workspace lifecycle to verify"
      : null,
    !inspection.responseWorkspaceArtifactLinkVerified
      ? "expected MySQL response workspace artifact link lifecycle to verify"
      : null,
    !inspection.pursuitDecisionVerified
      ? "expected MySQL pursuit decision lifecycle to verify"
      : null,
    !inspection.qualificationVerified
      ? "expected MySQL qualification lifecycle to verify"
      : null,
    !inspection.billingVerified
      ? "expected MySQL billing lifecycle to verify"
      : null,
    !inspection.billingReconcileVerified
      ? "expected MySQL billing reconcile lifecycle to verify"
      : null,
    !inspection.billingDunningVerified
      ? "expected MySQL billing dunning lifecycle to verify"
      : null,
    !inspection.knowledgeStationVerified
      ? "expected MySQL knowledge station lifecycle to verify"
      : null,
    !inspection.workspaceVerified
      ? "expected MySQL workspace lifecycle to verify"
      : null,
    !inspection.workspaceMemberVerified
      ? "expected MySQL workspace member lifecycle to verify"
      : null,
    !inspection.adminUsersVerified
      ? "expected MySQL admin users lifecycle to verify"
      : null,
    !inspection.adminConfigVerified
      ? "expected MySQL admin config lifecycle to verify"
      : null,
    !inspection.eventOutboxVerified
      ? "expected MySQL event outbox lifecycle to verify"
      : null,
    !inspection.adminBidQaVerified
      ? "expected MySQL admin bid QA lifecycle to verify"
      : null,
    !inspection.crawlerImportVerified
      ? "expected MySQL crawler import lifecycle to verify"
      : null,
    !inspection.crawlerControlVerified
      ? "expected MySQL crawler control lifecycle to verify"
      : null,
    !inspection.crawlerAlertMatchingVerified
      ? "expected MySQL crawler alert matching lifecycle to verify"
      : null,
    !inspection.accountUsageVerified
      ? "expected MySQL account usage lifecycle to verify"
      : null,
    !inspection.notificationPreferencesVerified
      ? "expected MySQL notification preferences lifecycle to verify"
      : null,
    !inspection.accountExportVerified
      ? "expected MySQL account export lifecycle to verify"
      : null,
    !inspection.notificationOutboxVerified
      ? "expected MySQL notification outbox lifecycle to verify"
      : null,
    !inspection.searchAlertVerified
      ? "expected MySQL search alert lifecycle to verify"
      : null,
    !inspection.passwordResetVerified
      ? "expected MySQL password reset lifecycle to verify"
      : null,
    !inspection.authSessionVerified
      ? "expected MySQL auth session lifecycle to verify"
      : null,
  ].filter(Boolean);

  if (failures.length > 0) {
    throw new Error(`MySQL smoke verification failed: ${failures.join("; ")}`);
  }
}

function firstRow<T extends Record<string, unknown>>(rows: unknown): T {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("MySQL smoke verification failed: expected at least one row.");
  }

  return rows[0] as T;
}

async function columnType(pool: Pool, tableName: string, columnName: string) {
  const [rows] = await pool.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
  const row = firstRow<{ Type: string }>(rows);
  return row.Type;
}

export async function runMysqlSmokeVerification(pool: Pool = createMysqlPool()) {
  const migrationResult = await runMysqlMigrations(pool);
  const bid = buildMysqlSmokeBid();
  let artifactStorageRoot: string | null = null;

  try {
    await cleanupPreviousMysqlSmokeBillingRows(pool);

    await pool.execute(
      `
        INSERT INTO bids (
          id,
          source,
          dedupe_key,
          title,
          description,
          currency,
          deadline_date,
          issuer_name,
          issuer_type,
          state_code,
          source_url,
          first_seen_at,
          last_seen_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        bid.id,
        bid.source,
        bid.dedupeKey,
        bid.title,
        bid.description,
        bid.currency,
        "2026-08-01",
        bid.issuerName,
        bid.issuerType,
        bid.stateCode,
        bid.sourceUrl,
        bid.createdAt,
        bid.createdAt,
        bid.createdAt,
        bid.createdAt,
      ],
    );
    await pool.execute(
      `
        INSERT INTO crawler_logs (
          id,
          source,
          run_id,
          status,
          started_at,
          finished_at,
          fetched_count,
          inserted_count,
          updated_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        `${bid.id}_crawler_log`,
        "mysql_smoke",
        `${bid.id}_run`,
        "success",
        bid.createdAt,
        bid.createdAt,
        1,
        1,
        0,
      ],
    );
    await pool.execute(
      `
        INSERT INTO bid_attachments (
          id,
          bid_id,
          name,
          url,
          original_url,
          archive_status,
          size_label,
          mime_type,
          sort_order,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        `${bid.id}_attachment`,
        bid.id,
        "MySQL Smoke SOW.pdf",
        MYSQL_SMOKE_ATTACHMENT_URL,
        MYSQL_SMOKE_ATTACHMENT_URL,
        "not_archived",
        "1 MB",
        "application/pdf",
        1,
        bid.createdAt,
      ],
    );
    await pool.execute(
      `
        INSERT INTO data_sources (
          id,
          label,
          issuer_type,
          state_code,
          base_url,
          is_enabled,
          cadence,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        `${bid.id}_source`,
        "MySQL Smoke Source",
        "state",
        "CA",
        MYSQL_SMOKE_SOURCE_URL,
        1,
        "daily",
        bid.createdAt,
        bid.createdAt,
      ],
    );

    const [tableRows] = await pool.query(
      "SELECT COUNT(*) AS tableCount FROM information_schema.tables WHERE table_schema = DATABASE()",
    );
    const [descriptionRows] = await pool.query("SELECT CHAR_LENGTH(description) AS descriptionLength FROM bids WHERE id = ?", [
      bid.id,
    ]);
    const crawlerImportSmoke = await runMysqlCrawlerImportSmoke(pool, bid.createdAt);
    const scraperHealthSources = await listScraperHealthSourcesFromMysql(pool);
    const adminCrawlerLogs = await listAdminCrawlerLogsFromMysql(pool, { limit: 5 });
    const bidSearch = await queryBidsFromMysql(
      pool,
      { q: "Smoke", issuerType: "state", states: ["ca"] },
      { referenceDate: new Date("2026-06-01T00:00:00.000Z") },
    );
    const bidDetail = await getBidByIdFromMysqlRuntime(pool, bid.id);
    const attachment = await getBidAttachmentDownloadFromMysql(pool, bid.id, `${bid.id}_attachment`);
    const authEmail = `${bid.id}@example.com`.toLowerCase();
    const registered = await registerMysqlUser(pool, {
      email: authEmail,
      password: "strong-password",
      displayName: "MySQL Smoke Buyer",
    });
    const sessionUser = await getMysqlSessionUser(pool, registered.sessionToken);
    const profile = await upsertMysqlSupplierProfile(pool, registered.user.id, {
      companyName: "MySQL Smoke Supplier",
      keywords: ["smoke"],
      serviceStates: ["CA"],
    });
    const dummyDb = {} as AppDatabase;
    const intent = await createIntentForBid(dummyDb, registered.user.id, bid.id);
    const updatedIntent = await updateIntentStatus(dummyDb, registered.user.id, intent.id, "needs_review");
    const intents = await listUserIntents(dummyDb, registered.user.id);
    const deadlineWorkspace = await getDeadlineWorkspace(dummyDb, registered.user.id, intent.id, {
      now: "2026-07-30T00:00:00.000Z",
    });
    const deadlineReminder = deadlineWorkspace.reminders.find((reminder) => reminder.kind === "bid_deadline");
    const acknowledgedDeadlineCenter = deadlineReminder
      ? await acknowledgeAccountDeadlineReminder(dummyDb, registered.user.id, {
        reminderId: deadlineReminder.id,
        now: "2026-07-30T01:00:00.000Z",
      })
      : null;
    const snoozedDeadlineCenter = deadlineReminder
      ? await snoozeAccountDeadlineReminder(dummyDb, registered.user.id, {
        reminderId: deadlineReminder.id,
        snoozedUntil: "2026-07-31T09:00:00.000Z",
        now: "2026-07-30T02:00:00.000Z",
      })
      : null;
    const accountDeadlineCenter = await getAccountDeadlineReminderCenter(dummyDb, registered.user.id, {
      now: "2026-07-30T02:00:00.000Z",
    });
    const compliance = await getOrCreateComplianceManifest(dummyDb, registered.user.id, intent.id);
    const updatedCompliance = compliance.items[0]
      ? await updateComplianceManifestItem(dummyDb, registered.user.id, intent.id, {
        itemId: compliance.items[0].id,
        status: "complete",
        evidenceStatus: "attached",
        notes: "MySQL smoke compliance evidence attached.",
      })
      : compliance;
    const submission = await getOrCreateSubmissionGuidance(dummyDb, registered.user.id, intent.id);
    const updatedSubmission = await updateSubmissionGuidance(dummyDb, registered.user.id, intent.id, {
      method: "email",
      portalUrl: "",
      contactEmail: "submit@example.com",
      requiresRegistration: false,
    });
    const submissionConfirmation = await createSubmissionConfirmation(dummyDb, registered.user.id, intent.id, {
      submittedAt: bid.createdAt,
      method: "email",
      confirmationReference: `${bid.id}_confirmation`,
      confirmationNotes: "MySQL smoke confirmation.",
    });
    artifactStorageRoot = mkdtempSync(path.join(os.tmpdir(), "mysql-artifact-smoke-"));
    const artifactVault = await createSupplierArtifact(dummyDb, registered.user.id, intent.id, {
      title: "MySQL Smoke Capability Statement",
      artifactType: "capability_statement",
      purpose: "response_workspace",
      file: new File(["mysql smoke artifact content"], "mysql-smoke-capability.txt", {
        type: "text/plain",
      }),
      notes: "MySQL smoke response workspace link artifact.",
    }, {
      storageRoot: artifactStorageRoot,
      now: new Date(bid.createdAt),
    });
    const responseWorkspaceArtifactId = artifactVault.artifacts[0]?.id ?? "";
    const responseWorkspace = await getOrCreateResponseWorkspace(dummyDb, registered.user.id, intent.id);
    const updatedResponseWorkspace = responseWorkspace.items[0]
      ? await updateResponseWorkspaceItem(dummyDb, registered.user.id, intent.id, {
        itemId: responseWorkspace.items[0].id,
        status: "done",
        notes: "MySQL smoke response task completed.",
        linkedArtifactIds: responseWorkspaceArtifactId ? [responseWorkspaceArtifactId] : [],
      })
      : responseWorkspace;
    const decisionBefore = await getPursuitDecisionBoard(dummyDb, registered.user.id, intent.id);
    const decisionAfter = await createPursuitDecision(dummyDb, registered.user.id, intent.id, {
      decision: "pursue",
      reasons: ["MySQL smoke fit"],
      notes: "MySQL smoke decision note.",
    });
    const citationsBeforeRefresh = await getOrCreateQualificationCitations(dummyDb, registered.user.id, intent.id);
    const freshnessBeforeRefresh = await getQualificationFreshness(dummyDb, registered.user.id, intent.id);
    const refreshedQualification = await refreshQualificationEvidence(dummyDb, registered.user.id, intent.id, {
      now: "2026-06-01T00:03:00.000Z",
    });
    const qualificationAnswer = await answerQualificationQuestion(dummyDb, registered.user.id, intent.id, {
      question: "What is the deadline?",
    });
    const workspaceBefore = await getMysqlAccountWorkspace(pool, registered.user.id);
    const workspaceAfter = await updateMysqlOrganizationName(pool, registered.user.id, {
      name: "MySQL Smoke Workspace",
    });
    const knowledgeItem = await createKnowledgeItemFromMysql(pool, {
      organizationId: workspaceAfter.organization.id,
      userId: registered.user.id,
      title: "MySQL smoke knowledge",
      body: "Reusable smoke proposal note.",
      type: "template_snippet",
      tags: ["smoke", "mysql"],
      sourceKind: "bid",
      sourceBidId: bid.id,
    });
    const knowledgeList = await listKnowledgeItemsFromMysql(pool, {
      organizationId: workspaceAfter.organization.id,
      q: "smoke",
      type: "template_snippet",
      limit: 5,
    });
    const checkout = await createMysqlCheckoutSession(pool, registered.user.id, {
      tier: "pro",
      providerAdapter: null,
    });
    const subscription = await applyMysqlBillingProviderEvent(pool, {
      id: `${bid.id}_checkout_completed`,
      type: "checkout.completed",
      provider: "mysql_smoke",
      userId: registered.user.id,
      providerCustomerId: `${bid.id}_customer`,
      providerSubscriptionId: `${bid.id}_subscription`,
      providerSessionId: checkout.checkoutSession.providerSessionId,
      tier: "pro",
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      cancelAtPeriodEnd: false,
    });
    const portal = await createMysqlCustomerPortalSession(pool, registered.user.id, {
      providerAdapter: null,
    });
    const accountSubscription = await getMysqlAccountSubscription(pool, registered.user.id);
    const billingReconcile = await reconcileMysqlSubscriptionLifecycle(pool, {
      now: "2026-06-01T00:02:00.000Z",
      pastDueGraceDays: 7,
    });
    await applyMysqlBillingProviderEvent(pool, {
      id: `${bid.id}_invoice_failed`,
      type: "invoice.payment_failed",
      provider: "mysql_smoke",
      userId: registered.user.id,
      providerCustomerId: `${bid.id}_customer`,
      providerSubscriptionId: `${bid.id}_subscription`,
      providerInvoiceId: `${bid.id}_invoice_failed`,
      invoiceNumber: "WIN-DUNNING-1",
      invoiceUrl: "https://billing.example.test/invoices/WIN-DUNNING-1",
      amountDueCents: 7900,
      amountPaidCents: 0,
      currency: "USD",
      dueAt: "2026-06-02T00:00:00.000Z",
    });
    const dunningNow = addDaysIso(bid.createdAt, 3);
    const billingDunning = await scheduleDunningRemindersFromMysql(pool, {
      now: dunningNow,
      limit: 500,
    });
    const billingDunningDuplicate = await scheduleDunningRemindersFromMysql(pool, {
      now: dunningNow,
      limit: 500,
    });
    const invitedMember = await inviteMysqlWorkspaceMember(pool, registered.user.id, {
      email: `${bid.id}.member@example.com`.toLowerCase(),
      role: "member",
    });
    const resentInvite = await resendMysqlWorkspaceInvitation(pool, registered.user.id, invitedMember.member.userId);
    const acceptedMember = await acceptMysqlWorkspaceInvitation(pool, {
      token: resentInvite.inviteToken,
      password: "member-strong-password",
      displayName: "MySQL Smoke Member",
    });
    const disabledWorkspace = await disableMysqlWorkspaceMember(pool, registered.user.id, acceptedMember.user.id);
    const restoredWorkspace = await restoreMysqlWorkspaceMember(pool, registered.user.id, acceptedMember.user.id);
    const transferredWorkspace = await transferMysqlWorkspaceOwnership(pool, registered.user.id, acceptedMember.user.id);
    const transferredBackWorkspace = await transferMysqlWorkspaceOwnership(pool, acceptedMember.user.id, registered.user.id);
    const removedWorkspace = await removeMysqlWorkspaceMember(pool, registered.user.id, acceptedMember.user.id);
    const revokedInvite = await inviteMysqlWorkspaceMember(pool, registered.user.id, {
      email: `${bid.id}.revoked@example.com`.toLowerCase(),
      role: "member",
    });
    const revokedWorkspace = await revokeMysqlWorkspaceInvitation(pool, registered.user.id, revokedInvite.member.userId);
    const adminInvite = await createAdminUserInviteFromMysql(pool, {
      email: `${bid.id}.admin-managed@example.com`.toLowerCase(),
      displayName: "MySQL Admin Managed",
      role: "user",
      tier: "free",
    }, { actorKind: "admin", actorUserId: registered.user.id });
    const adminUsersBeforeUpdate = await listAdminUsersFromMysql(pool, { q: "admin-managed" });
    const adminUpdatedUser = await updateAdminUserFromMysql(pool, adminInvite.user.id, {
      role: "support",
      tier: "business",
      isDisabled: true,
    }, { actorKind: "admin", actorUserId: registered.user.id });
    const adminOverride = await updateAdminUserFeatureOverrideFromMysql(pool, adminInvite.user.id, {
      featureKey: "compliance_manifest",
      isEnabled: true,
      reason: "MySQL smoke override",
      expiresAt: "2026-06-30T00:00:00.000Z",
    }, { actorKind: "admin", actorUserId: registered.user.id });
    const adminOverrides = await listAdminUserFeatureOverridesFromMysql(pool, adminInvite.user.id);
    await updateAdminUserFeatureOverrideFromMysql(pool, adminInvite.user.id, {
      featureKey: "compliance_manifest",
      isEnabled: null,
    }, { actorKind: "admin", actorUserId: registered.user.id });
    const adminAuditLogs = await listAdminUserAuditLogsFromMysql(pool, {
      limit: 20,
      target: "admin-managed",
      featureKey: "compliance_manifest",
    });
    const configEntry = await upsertConfigEntryFromMysql(pool, {
      module: "source",
      configKey: "approval_defaults",
      configValue: {
        approvedForIngestion: true,
        approvalStatus: "approved",
        legalReviewStatus: "approved",
      },
      actorUserId: registered.user.id,
      changeReason: "MySQL smoke config update.",
    });
    const configEvent = await writeAuditEventFromMysql(pool, {
      eventName: "admin.config.upserted",
      actorType: "admin",
      actorId: registered.user.id,
      actorRole: "admin",
      targetType: "config",
      targetId: configEntry.id,
      outcome: "success",
      severity: "info",
      metadata: {
        module: configEntry.module,
        configKey: configEntry.configKey,
        scopeType: configEntry.scopeType,
      },
      outboxDestinations: ["ops-alerts"],
    });
    const linkedConfigEntry = await upsertConfigEntryFromMysql(pool, {
      module: "source",
      configKey: "approval_defaults",
      configValue: configEntry.configValue,
      actorUserId: registered.user.id,
      changeReason: "MySQL smoke config linked to audit event.",
      auditEventId: configEvent.id,
    });
    const configEntries = await listConfigEntriesFromMysql(pool, {
      module: "source",
      configKey: "approval_defaults",
    });
    const effectiveConfig = await getEffectiveConfigValueFromMysql(pool, {
      module: "source",
      configKey: "approval_defaults",
      now: bid.createdAt,
    });
    const eventOutboxDelivery = await deliverPendingEventOutboxRowsFromMysql(
      pool,
      async (row) => row.destination === "ops-alerts" ? { ok: true } : { ok: false, error: "unknown destination" },
      { now: "2026-06-01T00:03:30.000Z", destinations: ["ops-alerts"] },
    );
    const bidQaBefore = await listAdminBidQaItemsFromMysql(pool, {
      q: "Smoke",
      archiveStatus: "not_archived",
    });
    const bidQaReviewed = await updateAdminBidQaReviewFromMysql(pool, bid.id, {
      reviewStatus: "reviewed",
      note: "MySQL smoke QA reviewed.",
      reviewerId: registered.user.id,
      reviewedAt: "2026-06-01T00:04:00.000Z",
    });
    const bidQaSuppressed = await updateAdminBidQaDisplayStatusFromMysql(pool, bid.id, {
      displayStatus: "suppressed",
      reviewerId: registered.user.id,
      reviewedAt: "2026-06-01T00:05:00.000Z",
    });
    const bidQaCorrected = await updateAdminBidQaCorrectionFromMysql(pool, bid.id, {
      corrections: {
        title: "MySQL Smoke Bid QA Corrected",
        deadlineDate: "2026-08-02",
      },
      note: "MySQL smoke QA correction.",
      reviewerId: registered.user.id,
      correctedAt: "2026-06-01T00:06:00.000Z",
    });
    const bidQaCorrections = await listAdminBidQaCorrectionsFromMysql(pool, bid.id);
    const bidQaBatch = await batchUpdateAdminBidQaItemsFromMysql(pool, {
      bidIds: [bid.id],
      reviewStatus: "reviewed",
      note: "MySQL smoke QA batch reviewed.",
      reviewerId: registered.user.id,
      reviewedAt: "2026-06-01T00:07:00.000Z",
    });
    const crawlerSourcesBeforeUpdate = await listAdminDataSourcesFromMysql(pool);
    const crawlerSourceDisabled = await updateAdminDataSourceFromMysql(pool, `${bid.id}_source`, {
      isEnabled: false,
    });
    const crawlerSourceEnabled = await updateAdminDataSourceFromMysql(pool, `${bid.id}_source`, {
      isEnabled: true,
    });
    const crawlerLock = await acquireCrawlerLockFromMysql(pool, {
      source: `${bid.id}_source`,
      owner: `${bid.id}_owner`,
      acquiredAt: "2026-06-01T00:08:00.000Z",
      expiresAt: "2026-06-01T00:18:00.000Z",
    });
    const blockedCrawlerLock = await acquireCrawlerLockFromMysql(pool, {
      source: `${bid.id}_source`,
      owner: `${bid.id}_other_owner`,
      acquiredAt: "2026-06-01T00:09:00.000Z",
      expiresAt: "2026-06-01T00:19:00.000Z",
    });
    const crawlerLockReleased = await releaseCrawlerLockFromMysql(pool, {
      source: `${bid.id}_source`,
      owner: `${bid.id}_owner`,
    });
    const searchAlert = await createSearchAlertFromMysql(pool, registered.user.id, {
      name: "MySQL Smoke Alert",
      query: { q: "smoke", states: ["CA"], issuerType: "state" },
      frequency: "daily",
      isEnabled: true,
    });
    const updatedSearchAlert = await updateSearchAlertFromMysql(pool, registered.user.id, searchAlert.id, {
      isEnabled: false,
    });
    const crawlerMatchAlert = await createSearchAlertFromMysql(pool, registered.user.id, {
      name: "MySQL Crawler Match Alert",
      query: { q: "crawler import", states: ["TX"], issuerType: "state" },
      frequency: "daily",
      isEnabled: true,
    });
    const crawlerAlertMatching = await matchEnabledSearchAlertsFromMysql(pool, {
      referenceDate: new Date("2026-06-01T00:00:00.000Z"),
      matchedAt: "2026-06-01T00:09:00.000Z",
    });
    const crawlerAlertNotification = await sendMatchedAlertNotificationsFromMysql(
      pool,
      crawlerAlertMatching,
      { send: async () => ({ ok: true as const, providerMessageId: `${bid.id}_crawler_match_mail` }) },
      { now: "2026-06-01T00:09:00.000Z" },
    );
    const crawlerMatchAlertsAfterNotify = await listSearchAlertsFromMysql(pool, registered.user.id);
    await enqueueNotificationFromMysql(pool, {
      id: `${bid.id}_notification`,
      alertId: searchAlert.id,
      userId: registered.user.id,
      channel: "email",
      recipient: authEmail,
      frequency: "daily",
      dedupeKey: `${searchAlert.id}:2026-06-01:email`,
      subject: "MySQL Smoke Alert",
      bodyText: "Matched smoke bid",
      matchedBidIds: [bid.id],
      createdAt: bid.createdAt,
    });
    const delivery = await deliverPendingNotificationsFromMysql(
      pool,
      { send: async () => ({ ok: true as const, providerMessageId: `${bid.id}_mail` }) },
      { now: bid.createdAt },
    );
    const recentNotifications = await listRecentNotificationsFromMysql(pool, { limit: 20 });
    const searchAlertsBeforeDelete = await listSearchAlertsFromMysql(pool, registered.user.id);
    await saveSavedBidIdFromMysql(pool, registered.user.id, bid.id);
    const savedBidIds = await listSavedBidIdsFromMysql(pool, registered.user.id);
    const accountUsage = await getAccountUsageFromMysql(pool, registered.user.id);
    const defaultPreferences = await getAccountNotificationPreferencesFromMysql(pool, registered.user.id);
    const updatedPreferences = await updateAccountNotificationPreferencesFromMysql(pool, registered.user.id, {
      savedSearchAlertsEnabled: false,
      defaultAlertFrequency: "weekly",
    });
    const accountExport = await exportMysqlAccountData(pool, registered.user.id);
    await deleteSearchAlertFromMysql(pool, registered.user.id, searchAlert.id);
    await deleteSearchAlertFromMysql(pool, registered.user.id, crawlerMatchAlert.id);
    const searchAlertsAfterDelete = await listSearchAlertsFromMysql(pool, registered.user.id);
    const reset = await requestPasswordResetFromMysql(pool, authEmail);
    const loginBeforeReset = await loginMysqlUser(pool, authEmail, "strong-password");
    await resetPasswordWithTokenFromMysql(pool, reset.resetToken ?? "", "new-strong-password");
    const oldPasswordRejected = await loginMysqlUser(pool, authEmail, "strong-password")
      .then(() => false)
      .catch(() => true);
    const loginAfterReset = await loginMysqlUser(pool, authEmail, "new-strong-password");
    const resetClearedSession = (await getMysqlSessionUser(pool, loginBeforeReset.sessionToken)) === null;
    await removeSavedBidIdFromMysql(pool, registered.user.id, bid.id);
    const savedBidIdsAfterRemoval = await listSavedBidIdsFromMysql(pool, registered.user.id);
    const loggedIn = await loginMysqlUser(pool, authEmail, "new-strong-password");
    await logoutMysqlSession(pool, loggedIn.sessionToken);
    const loggedOutUser = await getMysqlSessionUser(pool, loggedIn.sessionToken);
    const authSessionVerified =
      registered.user.email === authEmail &&
      sessionUser?.email === authEmail &&
      loggedIn.user.email === authEmail &&
      loggedOutUser === null;

    const inspection: MysqlSmokeInspection = {
      tableCount: Number(firstRow<{ tableCount: number | string }>(tableRows).tableCount),
      descriptionType: await columnType(pool, "bids", "description"),
      sourceType: await columnType(pool, "bids", "source"),
      organizationIdType: await columnType(pool, "organization_feature_overrides", "organization_id"),
      storedDescriptionLength: Number(
        firstRow<{ descriptionLength: number | string }>(descriptionRows).descriptionLength,
      ),
      scraperHealthSourceCount: scraperHealthSources.length,
      adminCrawlerLogCount: adminCrawlerLogs.length,
      bidSearchCount: bidSearch.total,
      bidDetailVerified: bidDetail?.id === bid.id && bidDetail.description.length === bid.description.length,
      attachmentVerified:
        attachment?.kind === "fallback" &&
        attachment.filename === "MySQL Smoke SOW.pdf" &&
        attachment.originalUrl === MYSQL_SMOKE_ATTACHMENT_URL,
      savedBidVerified: savedBidIds.includes(bid.id) && !savedBidIdsAfterRemoval.includes(bid.id),
      profileVerified: profile.companyName === "MySQL Smoke Supplier" && profile.completionScore > 0,
      intentVerified:
        intent.bid.id === bid.id &&
        updatedIntent.status === "needs_review" &&
        intents.some((item) => item.id === intent.id),
      deadlineReminderVerified:
        deadlineWorkspace.reminders.some((reminder) =>
          reminder.kind === "bid_deadline" &&
          reminder.dueAt === "2026-08-01" &&
          reminder.status === "active"
        ) &&
        Boolean(deadlineReminder) &&
        acknowledgedDeadlineCenter?.reminders.some((reminder) =>
          reminder.id === deadlineReminder?.id &&
          reminder.status === "acknowledged" &&
          reminder.acknowledgedAt === "2026-07-30T01:00:00.000Z"
        ) === true &&
        snoozedDeadlineCenter?.reminders.some((reminder) =>
          reminder.id === deadlineReminder?.id &&
          reminder.status === "snoozed" &&
          reminder.snoozedUntil === "2026-07-31T09:00:00.000Z"
        ) === true &&
        accountDeadlineCenter.reminders.some((reminder) =>
          reminder.id === deadlineReminder?.id &&
          reminder.status === "snoozed"
        ),
      complianceVerified:
        compliance.items.length > 0 &&
        updatedCompliance.summary.completed >= 1 &&
        updatedCompliance.summary.evidenceAttached >= 1 &&
        updatedCompliance.items.some((item) => item.notes === "MySQL smoke compliance evidence attached."),
      submissionVerified:
        submission.intentId === intent.id &&
        updatedSubmission.method === "email" &&
        updatedSubmission.contactEmail === "submit@example.com" &&
        !updatedSubmission.requiresRegistration &&
        submissionConfirmation.confirmation.confirmationReference === `${bid.id}_confirmation` &&
        ["submitted", "needs_recovery"].includes(submissionConfirmation.submission.status) &&
        submissionConfirmation.confirmations.some((confirmation) =>
          confirmation.confirmationReference === `${bid.id}_confirmation`
        ),
      responseWorkspaceVerified:
        responseWorkspace.items.length > 0 &&
        updatedResponseWorkspace.summary.done >= 1 &&
        updatedResponseWorkspace.items.some((item) => item.notes === "MySQL smoke response task completed."),
      responseWorkspaceArtifactLinkVerified:
        Boolean(responseWorkspaceArtifactId) &&
        updatedResponseWorkspace.items.some((item) =>
          item.linkedArtifacts.some((artifact) =>
            artifact.id === responseWorkspaceArtifactId &&
            artifact.downloadUrl === `/api/intents/${encodeURIComponent(intent.id)}/artifacts/${encodeURIComponent(responseWorkspaceArtifactId)}`
          )
        ),
      pursuitDecisionVerified:
        decisionBefore.currentDecision === null &&
        decisionAfter.currentDecision?.decision === "pursue" &&
        decisionAfter.currentDecision.notes === "MySQL smoke decision note." &&
        decisionAfter.history.some((decision) => decision.reasons.includes("MySQL smoke fit")),
      qualificationVerified:
        citationsBeforeRefresh.intentId === intent.id &&
        citationsBeforeRefresh.citations.length > 0 &&
        freshnessBeforeRefresh.status === "current" &&
        refreshedQualification.citations.citations.every((citation) =>
          citation.generatedAt === "2026-06-01T00:03:00.000Z"
        ) &&
        refreshedQualification.freshness.status === "current" &&
        qualificationAnswer.intentId === intent.id &&
        qualificationAnswer.citations.length > 0,
      billingVerified:
        checkout.checkoutSession.tier === "pro" &&
        subscription.subscription.tier === "pro" &&
        accountSubscription.subscription.status === "active" &&
        portal.portalSession.portalUrl.includes("billingPortal=local"),
      billingReconcileVerified:
        billingReconcile.checked >= 1 &&
        billingReconcile.canceledAtPeriodEnd >= 0 &&
        billingReconcile.markedPastDue >= 0 &&
        billingReconcile.downgradedPastDue >= 0 &&
        billingReconcile.expiredTrials >= 0,
      billingDunningVerified:
        billingDunning.checkedInvoices >= 1 &&
        billingDunning.queued >= 1 &&
        billingDunning.skippedNotDue >= 1 &&
        billingDunningDuplicate.skippedAlreadyQueued >= billingDunning.queued &&
        recentNotifications.some((notification) =>
          notification.dedupeKey === `billing:dunning:day2:${bid.id}_invoice_failed` &&
          notification.status === "sent"
        ),
      workspaceVerified:
        workspaceBefore.organization.id.length > 0 &&
        workspaceAfter.organization.name === "MySQL Smoke Workspace",
      knowledgeStationVerified:
        knowledgeItem.organizationId === workspaceAfter.organization.id &&
        knowledgeItem.sourceBidId === bid.id &&
        knowledgeList.items.some((item) =>
          item.id === knowledgeItem.id &&
          item.tags.includes("smoke")
        ),
      workspaceMemberVerified:
        invitedMember.member.status === "invited" &&
        resentInvite.inviteToken !== invitedMember.inviteToken &&
        acceptedMember.user.email === `${bid.id}.member@example.com`.toLowerCase() &&
        disabledWorkspace.members.some((member) => member.userId === acceptedMember.user.id && member.status === "disabled") &&
        restoredWorkspace.members.some((member) => member.userId === acceptedMember.user.id && member.status === "active") &&
        transferredWorkspace.currentUserRole === "member" &&
        transferredWorkspace.members.some((member) => member.userId === acceptedMember.user.id && member.workspaceRole === "owner") &&
        transferredBackWorkspace.currentUserRole === "member" &&
        transferredBackWorkspace.members.some((member) => member.userId === registered.user.id && member.workspaceRole === "owner") &&
        !removedWorkspace.members.some((member) => member.userId === acceptedMember.user.id) &&
        !revokedWorkspace.members.some((member) => member.userId === revokedInvite.member.userId),
      adminUsersVerified:
        adminInvite.user.email === `${bid.id}.admin-managed@example.com`.toLowerCase() &&
        adminUsersBeforeUpdate.users.some((user) => user.id === adminInvite.user.id) &&
        adminUpdatedUser.role === "support" &&
        adminUpdatedUser.tier === "business" &&
        adminUpdatedUser.isDisabled &&
        adminOverride.overrides.some((override) =>
          override.featureKey === "compliance_manifest" &&
          override.isEnabled &&
          override.reason === "MySQL smoke override"
        ) &&
        adminOverrides.overrides.some((override) => override.featureKey === "compliance_manifest") &&
        adminAuditLogs.logs.some((log) =>
          log.targetUserId === adminInvite.user.id &&
          log.changes.some((change) => change.field === "featureOverride" && change.after === null)
        ),
      adminConfigVerified:
        linkedConfigEntry.auditEventId === configEvent.id &&
        configEntries.some((entry) => entry.id === linkedConfigEntry.id) &&
        effectiveConfig?.id === linkedConfigEntry.id &&
        (effectiveConfig.configValue as { approvalStatus?: string }).approvalStatus === "approved",
      eventOutboxVerified:
        eventOutboxDelivery.attempted >= 1 &&
        eventOutboxDelivery.delivered >= 1 &&
        eventOutboxDelivery.failed === 0,
      adminBidQaVerified:
        bidQaBefore.items.some((item) => item.id === bid.id) &&
        bidQaReviewed.adminReviewStatus === "reviewed" &&
        bidQaReviewed.adminReviewNote === "MySQL smoke QA reviewed." &&
        bidQaSuppressed.displayStatus === "suppressed" &&
        bidQaCorrected.title === "MySQL Smoke Bid QA Corrected" &&
        bidQaCorrected.deadlineDate === "2026-08-02" &&
        bidQaCorrected.correctionCount >= 2 &&
        bidQaCorrections.length >= 2 &&
        bidQaBatch.updatedCount === 1 &&
        bidQaBatch.items.some((item) => item.id === bid.id && item.adminReviewStatus === "reviewed"),
      crawlerImportVerified: crawlerImportSmoke.verified,
      crawlerControlVerified:
        crawlerSourcesBeforeUpdate.sources.some((source) =>
          source.id === `${bid.id}_source` &&
          source.isEnabled
        ) &&
        crawlerSourceDisabled.id === `${bid.id}_source` &&
        !crawlerSourceDisabled.isEnabled &&
        crawlerSourceEnabled.id === `${bid.id}_source` &&
        crawlerSourceEnabled.isEnabled &&
        crawlerLock.acquired &&
        blockedCrawlerLock.acquired === false &&
        blockedCrawlerLock.owner === `${bid.id}_owner` &&
        crawlerLockReleased.released,
      crawlerAlertMatchingVerified:
        crawlerAlertMatching.evaluatedAlerts >= 1 &&
        crawlerAlertMatching.matches.some((match) =>
          match.alertId === crawlerMatchAlert.id &&
          match.bidIds.includes(crawlerImportSmoke.bid.id)
        ) &&
        crawlerAlertNotification.queued >= 1 &&
        crawlerAlertNotification.sent >= 1 &&
        crawlerMatchAlertsAfterNotify.some((alert) =>
          alert.id === crawlerMatchAlert.id &&
          alert.lastMatchedAt === "2026-06-01T00:09:00.000Z" &&
          alert.lastNotifiedAt === "2026-06-01T00:09:00.000Z" &&
          alert.digestHistory?.some((run) =>
            run.status === "sent" &&
            run.matchedBidIds.includes(crawlerImportSmoke.bid.id)
          )
        ),
      accountUsageVerified:
        accountUsage.tier === "pro" &&
        accountUsage.workspaceUserIds.includes(registered.user.id) &&
        accountUsage.items.some((item) => item.feature === "saved_bids" && item.used === 1) &&
        accountUsage.items.some((item) => item.feature === "search_alerts" && item.used >= 1),
      notificationPreferencesVerified:
        defaultPreferences.savedSearchAlertsEnabled &&
        defaultPreferences.defaultAlertFrequency === "daily" &&
        !updatedPreferences.savedSearchAlertsEnabled &&
        updatedPreferences.defaultAlertFrequency === "weekly",
      accountExportVerified:
        accountExport.account.email === authEmail &&
        accountExport.workspace?.organization.name === "MySQL Smoke Workspace" &&
        accountExport.savedBids.some((item) => item.bidId === bid.id) &&
        accountExport.searchAlerts.some((item) => item.id === searchAlert.id),
      notificationOutboxVerified:
        delivery.sent >= 1 &&
        recentNotifications.some((notification) => notification.id === `${bid.id}_notification` && notification.status === "sent") &&
        searchAlertsBeforeDelete.some((alert) =>
          alert.id === searchAlert.id &&
          alert.digestHistory?.some((run) => run.notificationId === `${bid.id}_notification` && run.status === "sent"),
        ),
      searchAlertVerified:
        searchAlert.name === "MySQL Smoke Alert" &&
        updatedSearchAlert.isEnabled === false &&
        searchAlertsBeforeDelete.some((alert) => alert.id === searchAlert.id) &&
        !searchAlertsAfterDelete.some((alert) => alert.id === searchAlert.id) &&
        !searchAlertsAfterDelete.some((alert) => alert.id === crawlerMatchAlert.id),
      passwordResetVerified:
        Boolean(reset.resetToken?.startsWith("reset_")) &&
        oldPasswordRejected &&
        loginAfterReset.user.email === authEmail &&
        resetClearedSession,
      authSessionVerified,
    };

    validateMysqlSmokeInspection(inspection);

    return {
      migrationResult,
      inspection,
      smokeBidId: bid.id,
    };
  } finally {
    await pool.execute("DELETE FROM notification_outbox WHERE dedupe_key = ?", [
      `billing:dunning:day2:${bid.id}_invoice_failed`,
    ]);
    await pool.execute("DELETE FROM notification_outbox WHERE dedupe_key = ?", [
      `billing:dunning:day5:${bid.id}_invoice_failed`,
    ]);
    await pool.execute("DELETE FROM billing_invoices WHERE provider_invoice_id = ?", [`${bid.id}_invoice_failed`]);
    await pool.execute("DELETE FROM bid_attachments WHERE id = ?", [`${bid.id}_attachment`]);
    await pool.execute("DELETE FROM bid_attachments WHERE bid_id LIKE 'mysql_crawler_import_%'");
    await pool.execute("DELETE FROM crawler_locks WHERE source = ?", [`${bid.id}_source`]);
    await pool.execute("DELETE FROM crawler_logs WHERE id = ?", [`${bid.id}_crawler_log`]);
    await pool.execute("DELETE FROM crawler_logs WHERE source = ?", ["mysql_crawler_import"]);
    await pool.execute("DELETE FROM data_sources WHERE id = ?", [`${bid.id}_source`]);
    await pool.execute("DELETE FROM bids WHERE id = ?", [bid.id]);
    await pool.execute("DELETE FROM bids WHERE id LIKE 'mysql_crawler_import_%'");
    if (artifactStorageRoot) {
      rmSync(artifactStorageRoot, { recursive: true, force: true });
    }
  }
}

export function mysqlSmokeConnectionSummary(env = process.env) {
  return redactMysqlDatabaseUrl(requireMysqlDatabaseUrl(env));
}
