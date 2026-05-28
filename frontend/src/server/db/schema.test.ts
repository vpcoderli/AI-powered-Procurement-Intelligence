import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "./client";
import { runMigrations } from "./migrate";
import {
  bids,
  crawlerLocks,
  notificationOutbox,
  organizationMemberships,
  organizations,
  passwordResetTokens,
  userNotificationPreferences,
  users,
  workspaceInvitations,
} from "./schema";
import { createTestDatabase } from "./test-utils";

describe("database schema", () => {
  let directory: string | undefined;
  let db: ReturnType<typeof createDatabase> | undefined;

  afterEach(async () => {
    db?.$client.close();
    db = undefined;

    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it("creates core tables in an empty sqlite database", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "apsi-db-"));
    const databasePath = path.join(directory, "apsi.sqlite");
    db = createDatabase(databasePath);

    runMigrations(db);

    db.insert(users)
      .values({
        id: "anon_test",
        createdAt: "2026-05-19T00:00:00.000Z",
        updatedAt: "2026-05-19T00:00:00.000Z",
      })
      .run();

    db.insert(bids)
      .values({
        id: "1",
        source: "SAM.gov",
        sourceBidId: "mock:1",
        dedupeKey: "mock:1",
        title: "Enterprise Cloud Migration Services",
        description: "Short description",
        amount: "$5M - $10M",
        issuerName: "DEPARTMENT OF DEFENSE",
        issuerType: "federal",
        stateCode: "US",
        sourceUrl: "https://sam.gov/example",
        isActive: 1,
        firstSeenAt: "2026-05-19T00:00:00.000Z",
        lastSeenAt: "2026-05-19T00:00:00.000Z",
        createdAt: "2026-05-19T00:00:00.000Z",
        updatedAt: "2026-05-19T00:00:00.000Z",
      })
      .run();

    expect(db.select().from(users).all()).toHaveLength(1);
    expect(db.select().from(bids).all()).toHaveLength(1);
    expect(
      db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get("idx_bids_dedupe_key"),
    ).toEqual({ name: "idx_bids_dedupe_key" });

    expect(() =>
      db!.insert(crawlerLocks)
        .values({
          source: "SAM.gov",
          owner: "worker_1",
          acquiredAt: "2026-05-19T00:00:00.000Z",
          expiresAt: "2026-05-19T00:10:00.000Z",
        })
        .run(),
    ).not.toThrow();

    expect(() =>
      db!.insert(notificationOutbox)
        .values({
          id: "notification_1",
          alertId: "alert_1",
          userId: "user_1",
          channel: "email",
          recipient: "buyer@example.com",
          frequency: "daily",
          dedupeKey: "alert_1:2026-05-19:email",
          subject: "APSi daily bid matches",
          bodyText: "1 matching bid",
          matchedBidIds: JSON.stringify(["bid_1"]),
          status: "pending",
          attemptCount: 0,
          createdAt: "2026-05-19T00:00:00.000Z",
        })
        .run(),
    ).not.toThrow();

    expect(() =>
      db!.insert(notificationOutbox)
        .values({
          id: "notification_2",
          alertId: "alert_1",
          userId: "user_1",
          channel: "email",
          recipient: "buyer@example.com",
          frequency: "daily",
          dedupeKey: "alert_1:2026-05-19:email",
          subject: "Duplicate",
          bodyText: "Duplicate",
          matchedBidIds: JSON.stringify(["bid_1"]),
          status: "pending",
          attemptCount: 0,
          createdAt: "2026-05-19T00:00:00.000Z",
        })
        .run(),
    ).toThrow();
  });

  it("migrates legacy subscription events before creating provider event index", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "apsi-db-"));
    const databasePath = path.join(directory, "apsi.sqlite");
    db = createDatabase(databasePath);

    db.$client.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE account_subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tier TEXT NOT NULL DEFAULT 'free',
        status TEXT NOT NULL DEFAULT 'none',
        source TEXT NOT NULL DEFAULT 'admin_override',
        provider TEXT,
        provider_customer_id TEXT,
        provider_subscription_id TEXT,
        current_period_end TEXT,
        cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE subscription_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subscription_id TEXT REFERENCES account_subscriptions(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        source TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
    `);

    expect(() => runMigrations(db!)).not.toThrow();

    const subscriptionEventColumns = db.$client
      .prepare("PRAGMA table_info(subscription_events)")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(subscriptionEventColumns).toContain("provider_event_id");
    expect(
      db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get("idx_subscription_events_provider_event_id"),
    ).toEqual({ name: "idx_subscription_events_provider_event_id" });
  });

  it("creates supplier profile and intent tables", async () => {
    const testDb = await createTestDatabase({ seed: false });

    try {
      const tables = testDb.db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(tables).toContain("supplier_profiles");
      expect(tables).toContain("intent_to_bid");
      expect(tables).toContain("submission_paths");
      expect(tables).toContain("submission_confirmations");
      expect(tables).toContain("compliance_manifest_items");
      expect(tables).toContain("pursuit_decisions");
      expect(tables).toContain("admin_user_audit_logs");
      expect(tables).toContain("account_subscriptions");
      expect(tables).toContain("subscription_events");
      expect(tables).toContain("billing_checkout_sessions");
      expect(tables).toContain("billing_invoices");
      expect(tables).toContain("password_reset_tokens");
      expect(tables).toContain("workspace_invitations");
      expect(tables).toContain("organizations");
      expect(tables).toContain("organization_memberships");
      expect(tables).toContain("organization_feature_overrides");
      expect(tables).toContain("user_notification_preferences");

      const userColumns = testDb.db.$client
        .prepare("PRAGMA table_info(users)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(userColumns).toContain("account_tier");
      expect(userColumns).toContain("is_disabled");

      const organizationColumns = testDb.db.$client
        .prepare("PRAGMA table_info(organizations)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(organizationColumns).toContain("account_tier");

      const featureOverrideColumns = testDb.db.$client
        .prepare("PRAGMA table_info(organization_feature_overrides)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(featureOverrideColumns).toEqual(
        expect.arrayContaining([
          "organization_id",
          "feature_key",
          "is_enabled",
          "reason",
          "expires_at",
          "created_by_user_id",
          "created_at",
          "updated_at",
        ]),
      );

      const subscriptionEventColumns = testDb.db.$client
        .prepare("PRAGMA table_info(subscription_events)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(subscriptionEventColumns).toContain("provider_event_id");

      testDb.db.insert(users).values({
        id: "user_1",
        email: "buyer@example.com",
        createdAt: "2026-05-19T00:00:00.000Z",
        updatedAt: "2026-05-19T00:00:00.000Z",
      }).run();

      expect(() =>
        testDb.db.insert(passwordResetTokens).values({
          id: "reset_1",
          userId: "user_1",
          tokenHash: "hashed-token",
          expiresAt: "2026-05-19T01:00:00.000Z",
          usedAt: null,
          createdAt: "2026-05-19T00:00:00.000Z",
        }).run(),
      ).not.toThrow();

      expect(() => {
        testDb.db.insert(organizations).values({
          id: "org_1",
          name: "Acme Federal Team",
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        }).run();
        testDb.db.insert(organizationMemberships).values({
          organizationId: "org_1",
          userId: "user_1",
          role: "owner",
          status: "active",
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        }).run();
      }).not.toThrow();

      expect(() =>
        testDb.db.insert(workspaceInvitations).values({
          id: "invite_1",
          organizationId: "org_1",
          invitedUserId: "user_1",
          invitedByUserId: "user_1",
          email: "buyer@example.com",
          tokenHash: "hashed-invite-token",
          expiresAt: "2026-05-29T00:00:00.000Z",
          acceptedAt: null,
          revokedAt: null,
          lastSentAt: "2026-05-19T00:00:00.000Z",
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        }).run(),
      ).not.toThrow();

      expect(() =>
        testDb.db.insert(userNotificationPreferences).values({
          userId: "user_1",
          savedSearchAlertsEnabled: 1,
          defaultAlertFrequency: "daily",
          marketingUpdatesEnabled: 0,
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        }).run(),
      ).not.toThrow();

      expect(() =>
        testDb.db.$client.prepare(`
          INSERT INTO organization_feature_overrides (
            organization_id,
            feature_key,
            is_enabled,
            reason,
            expires_at,
            created_by_user_id,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "org_1",
          "compliance_manifest",
          1,
          "Beta pilot",
          "2026-06-19T00:00:00.000Z",
          "user_1",
          "2026-05-19T00:00:00.000Z",
          "2026-05-19T00:00:00.000Z",
        ),
      ).not.toThrow();

      const workspaceInvitationColumns = testDb.db.$client
        .prepare("PRAGMA table_info(workspace_invitations)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(workspaceInvitationColumns).toContain("revoked_at");
      expect(workspaceInvitationColumns).toContain("last_sent_at");

      const notificationPreferenceColumns = testDb.db.$client
        .prepare("PRAGMA table_info(user_notification_preferences)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(notificationPreferenceColumns).toContain("saved_search_alerts_enabled");
      expect(notificationPreferenceColumns).toContain("default_alert_frequency");
      expect(notificationPreferenceColumns).toContain("marketing_updates_enabled");
    } finally {
      await testDb.cleanup();
    }
  });
});
