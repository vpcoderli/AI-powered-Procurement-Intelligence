import type { Pool } from "mysql2/promise";
import { listAdminCrawlerLogsFromMysql } from "@/server/admin/data-sources-repository";
import { exportMysqlAccountData } from "@/server/account/lifecycle";
import {
  getAccountNotificationPreferencesFromMysql,
  updateAccountNotificationPreferencesFromMysql,
} from "@/server/account/notification-preferences";
import { getAccountUsageFromMysql } from "@/server/account/usage";
import { getMysqlAccountWorkspace, updateMysqlOrganizationName } from "@/server/account/mysql-workspace";
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
} from "@/server/billing/mysql-subscriptions";
import { listScraperHealthSourcesFromMysql } from "@/server/crawler/logs-repository";
import { createIntentForBid, listUserIntents, updateIntentStatus } from "@/server/intents/service";
import { upsertMysqlSupplierProfile } from "@/server/profile/mysql-service";
import {
  createSearchAlertFromMysql,
  deleteSearchAlertFromMysql,
  listSearchAlertsFromMysql,
  updateSearchAlertFromMysql,
} from "@/server/search-alerts/service";
import type { AppDatabase } from "./client";
import { createMysqlPool, requireMysqlDatabaseUrl, runMysqlMigrations } from "./mysql";

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
  billingVerified: boolean;
  workspaceVerified: boolean;
  accountUsageVerified: boolean;
  notificationPreferencesVerified: boolean;
  accountExportVerified: boolean;
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
    sourceUrl: "https://example.com/mysql-smoke",
    createdAt: now,
  };
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
    !inspection.billingVerified
      ? "expected MySQL billing lifecycle to verify"
      : null,
    !inspection.workspaceVerified
      ? "expected MySQL workspace lifecycle to verify"
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

  try {
    await pool.execute(
      `
        INSERT INTO bids (
          id,
          source,
          dedupe_key,
          title,
          description,
          currency,
          issuer_name,
          issuer_type,
          state_code,
          source_url,
          first_seen_at,
          last_seen_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        bid.id,
        bid.source,
        bid.dedupeKey,
        bid.title,
        bid.description,
        bid.currency,
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
        "https://sam.gov/opp/12345/sow.pdf",
        "https://sam.gov/opp/12345/sow.pdf",
        "not_archived",
        "1 MB",
        "application/pdf",
        1,
        bid.createdAt,
      ],
    );

    const [tableRows] = await pool.query(
      "SELECT COUNT(*) AS tableCount FROM information_schema.tables WHERE table_schema = DATABASE()",
    );
    const [descriptionRows] = await pool.query("SELECT CHAR_LENGTH(description) AS descriptionLength FROM bids WHERE id = ?", [
      bid.id,
    ]);
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
    const workspaceBefore = await getMysqlAccountWorkspace(pool, registered.user.id);
    const workspaceAfter = await updateMysqlOrganizationName(pool, registered.user.id, {
      name: "MySQL Smoke Workspace",
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
    const searchAlert = await createSearchAlertFromMysql(pool, registered.user.id, {
      name: "MySQL Smoke Alert",
      query: { q: "smoke", states: ["CA"], issuerType: "state" },
      frequency: "daily",
      isEnabled: true,
    });
    const updatedSearchAlert = await updateSearchAlertFromMysql(pool, registered.user.id, searchAlert.id, {
      isEnabled: false,
    });
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
        attachment.originalUrl === "https://sam.gov/opp/12345/sow.pdf",
      savedBidVerified: savedBidIds.includes(bid.id) && !savedBidIdsAfterRemoval.includes(bid.id),
      profileVerified: profile.companyName === "MySQL Smoke Supplier" && profile.completionScore > 0,
      intentVerified:
        intent.bid.id === bid.id &&
        updatedIntent.status === "needs_review" &&
        intents.some((item) => item.id === intent.id),
      billingVerified:
        checkout.checkoutSession.tier === "pro" &&
        subscription.subscription.tier === "pro" &&
        accountSubscription.subscription.status === "active" &&
        portal.portalSession.portalUrl.includes("billingPortal=local"),
      workspaceVerified:
        workspaceBefore.organization.id.length > 0 &&
        workspaceAfter.organization.name === "MySQL Smoke Workspace",
      accountUsageVerified:
        accountUsage.tier === "pro" &&
        accountUsage.workspaceUserIds.includes(registered.user.id) &&
        accountUsage.items.some((item) => item.feature === "saved_bids" && item.used === 1) &&
        accountUsage.items.some((item) => item.feature === "search_alerts" && item.used === 1),
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
      searchAlertVerified:
        searchAlert.name === "MySQL Smoke Alert" &&
        updatedSearchAlert.isEnabled === false &&
        searchAlertsBeforeDelete.some((alert) => alert.id === searchAlert.id) &&
        !searchAlertsAfterDelete.some((alert) => alert.id === searchAlert.id),
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
    await pool.execute("DELETE FROM bid_attachments WHERE id = ?", [`${bid.id}_attachment`]);
    await pool.execute("DELETE FROM crawler_logs WHERE id = ?", [`${bid.id}_crawler_log`]);
    await pool.execute("DELETE FROM bids WHERE id = ?", [bid.id]);
  }
}

export function mysqlSmokeConnectionSummary(env = process.env) {
  return redactMysqlDatabaseUrl(requireMysqlDatabaseUrl(env));
}
