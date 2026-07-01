import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "./client";
import { runMigrations } from "./migrate";
import {
  artifactVersions,
  bidAttachments,
  bidFieldCorrections,
  bids,
  configRegistry,
  crawlerLocks,
  awardOutcomes,
  dataSources,
  sourceApprovalEvents,
  deadlineReminders,
  eventLog,
  eventOutbox,
  intentToBid,
  notificationOutbox,
  organizationMemberships,
  organizations,
  passwordResetTokens,
  quoteRequestArtifacts,
  quoteRequests,
  riskCheckSnapshots,
  responseWorkspaceActivity,
  responseWorkspaceComments,
  responseWorkspaceItemArtifacts,
  responseWorkspaceItems,
  responsePackageExports,
  responsePackageExportReviewEvents,
  responsePackageSnapshots,
  searchAlertDigestRuns,
  sourcingPartners,
  supplierArtifacts,
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

    expect(() =>
      db!.insert(searchAlertDigestRuns)
        .values({
          id: "digest_run_1",
          alertId: "alert_1",
          userId: "user_1",
          frequency: "daily",
          status: "sent",
          matchCount: 1,
          notificationId: "notification_1",
          matchedBidIdsJson: JSON.stringify(["bid_1"]),
          createdAt: "2026-05-19T00:00:00.000Z",
        })
        .run(),
    ).not.toThrow();
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

  it("adds evidence citation snapshots to legacy intent tables", async () => {
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

      CREATE TABLE bids (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_bid_id TEXT,
        dedupe_key TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        issuer_name TEXT NOT NULL,
        issuer_type TEXT NOT NULL,
        state_code TEXT NOT NULL,
        original_category TEXT,
        amount TEXT,
        amount_min INTEGER,
        amount_max INTEGER,
        currency TEXT NOT NULL DEFAULT 'USD',
        published_date TEXT,
        deadline_date TEXT,
        contact_name TEXT,
        contact_email TEXT,
        contact_phone TEXT,
        source_url TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        raw_payload TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE intent_to_bid (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'intent_added',
        ai_bid_brief TEXT NOT NULL DEFAULT '',
        key_dates_json TEXT NOT NULL DEFAULT '{}',
        initial_checklist_json TEXT NOT NULL DEFAULT '[]',
        risk_flags_json TEXT NOT NULL DEFAULT '[]',
        match_score_snapshot_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO users (id, email, created_at, updated_at)
      VALUES ('user_1', 'buyer@example.com', '2026-05-19T00:00:00.000Z', '2026-05-19T00:00:00.000Z');
      INSERT INTO bids (
        id, source, dedupe_key, title, description, issuer_name, issuer_type, state_code,
        source_url, first_seen_at, last_seen_at, created_at, updated_at
      )
      VALUES (
        'bid_1', 'SAM.gov', 'legacy:1', 'Legacy bid', 'Legacy description',
        'Example Agency', 'federal', 'US', 'https://example.gov',
        '2026-05-19T00:00:00.000Z', '2026-05-19T00:00:00.000Z',
        '2026-05-19T00:00:00.000Z', '2026-05-19T00:00:00.000Z'
      );
      INSERT INTO intent_to_bid (
        id, user_id, bid_id, status, ai_bid_brief, key_dates_json,
        initial_checklist_json, risk_flags_json, match_score_snapshot_json, created_at, updated_at
      )
      VALUES (
        'intent_1', 'user_1', 'bid_1', 'intent_added', 'Brief', '{}',
        '[]', '[]', '{}', '2026-05-19T00:00:00.000Z', '2026-05-19T00:00:00.000Z'
      );
    `);

    expect(() => runMigrations(db!)).not.toThrow();

    const row = db.$client
      .prepare("SELECT evidence_citations_json FROM intent_to_bid WHERE id = ?")
      .get("intent_1");

    expect(row).toEqual({ evidence_citations_json: "[]" });
  });

  it("adds draft status to legacy submission path tables", async () => {
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

      CREATE TABLE bids (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_bid_id TEXT,
        dedupe_key TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        issuer_name TEXT NOT NULL,
        issuer_type TEXT NOT NULL,
        state_code TEXT NOT NULL,
        published_date TEXT,
        deadline_date TEXT,
        source_url TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE intent_to_bid (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        bid_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'intent_added',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE submission_paths (
        id TEXT PRIMARY KEY,
        intent_id TEXT NOT NULL,
        bid_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        method TEXT NOT NULL DEFAULT 'unknown',
        portal_url TEXT NOT NULL DEFAULT '',
        contact_email TEXT NOT NULL DEFAULT '',
        requires_registration INTEGER NOT NULL DEFAULT 0,
        requires_physical_delivery INTEGER NOT NULL DEFAULT 0,
        requires_addenda_acknowledgement INTEGER NOT NULL DEFAULT 0,
        complexity_score INTEGER NOT NULL DEFAULT 0,
        guidance_text TEXT NOT NULL DEFAULT '',
        readiness_checklist_json TEXT NOT NULL DEFAULT '[]',
        risk_flags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    expect(() => runMigrations(db!)).not.toThrow();

    const columns = db.$client
      .prepare("PRAGMA table_info(submission_paths)")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(columns).toContain("status");
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
      expect(tables).toContain("award_outcomes");
      expect(tables).toContain("compliance_manifest_items");
      expect(tables).toContain("pursuit_decisions");
      expect(tables).toContain("response_workspace_items");
      expect(tables).toContain("admin_user_audit_logs");
      expect(tables).toContain("account_subscriptions");
      expect(tables).toContain("subscription_events");
      expect(tables).toContain("billing_checkout_sessions");
      expect(tables).toContain("billing_invoices");
      expect(tables).toContain("credit_balances");
      expect(tables).toContain("credit_usage_events");
      expect(tables).toContain("password_reset_tokens");
      expect(tables).toContain("workspace_invitations");
      expect(tables).toContain("organizations");
      expect(tables).toContain("organization_memberships");
      expect(tables).toContain("organization_feature_overrides");
      expect(tables).toContain("config_registry");
      expect(tables).toContain("event_log");
      expect(tables).toContain("event_outbox");
      expect(tables).toContain("user_notification_preferences");
      expect(tables).toContain("risk_check_snapshots");

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

      const intentColumns = testDb.db.$client
        .prepare("PRAGMA table_info(intent_to_bid)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(intentColumns).toContain("evidence_citations_json");

      const submissionConfirmationColumns = testDb.db.$client
        .prepare("PRAGMA table_info(submission_confirmations)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(submissionConfirmationColumns).toContain("evidence_snapshot_json");

      const awardOutcomeColumns = testDb.db.$client
        .prepare("PRAGMA table_info(award_outcomes)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(awardOutcomeColumns).toEqual(expect.arrayContaining([
        "id",
        "organization_id",
        "intent_id",
        "bid_id",
        "user_id",
        "status",
        "award_notice_url",
        "tabulation_artifact_id",
        "tabulation_artifact_url",
        "winner_name",
        "award_amount_cents",
        "currency",
        "loss_reason",
        "loss_reason_notes",
        "next_action",
        "next_action_due_at",
        "notes",
        "decided_at",
        "created_at",
        "updated_at",
      ]));

      expect(
        testDb.db.$client
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get("idx_award_outcomes_intent_id"),
      ).toEqual({ name: "idx_award_outcomes_intent_id" });

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

      const configRegistryColumns = testDb.db.$client
        .prepare("PRAGMA table_info(config_registry)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(configRegistryColumns).toEqual(
        expect.arrayContaining([
          "id",
          "scope_type",
          "scope_id",
          "module",
          "config_key",
          "config_value_json",
          "schema_version",
          "status",
          "effective_from",
          "effective_to",
          "created_by",
          "updated_by",
          "change_reason",
          "audit_event_id",
          "created_at",
          "updated_at",
        ]),
      );

      const subscriptionEventColumns = testDb.db.$client
        .prepare("PRAGMA table_info(subscription_events)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(subscriptionEventColumns).toContain("provider_event_id");

      const creditUsageEventColumns = testDb.db.$client
        .prepare("PRAGMA table_info(credit_usage_events)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(creditUsageEventColumns).toEqual(
        expect.arrayContaining([
          "id",
          "organization_id",
          "user_id",
          "feature_key",
          "event_type",
          "amount",
          "balance_after",
          "metadata_json",
          "created_at",
        ]),
      );

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

      expect(() =>
        testDb.db.insert(riskCheckSnapshots).values({
          id: "risk_snapshot_1",
          ok: 1,
          checkedAt: "2026-05-19T00:00:00.000Z",
          reportJson: JSON.stringify({ ok: true, checks: [] }),
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

      expect(() => {
        testDb.db.insert(bids).values({
          id: "award_bid_schema",
          source: "SAM.gov",
          sourceBidId: "award:schema",
          dedupeKey: "award:schema",
          title: "Award schema bid",
          description: "Bid for award outcome schema assertions.",
          issuerName: "General Services Administration",
          issuerType: "federal",
          stateCode: "US",
          sourceUrl: "https://sam.gov/award-schema",
          isActive: 1,
          firstSeenAt: "2026-05-19T00:00:00.000Z",
          lastSeenAt: "2026-05-19T00:00:00.000Z",
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        }).run();
        testDb.db.insert(intentToBid).values({
          id: "award_intent_schema",
          userId: "user_1",
          bidId: "award_bid_schema",
          status: "intent_added",
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        }).run();
        testDb.db.insert(awardOutcomes).values({
          id: "award_outcome_schema",
          organizationId: "org_1",
          intentId: "award_intent_schema",
          bidId: "award_bid_schema",
          userId: "user_1",
          status: "awaiting_award",
          awardNoticeUrl: "",
          tabulationArtifactId: null,
          tabulationArtifactUrl: "",
          winnerName: "",
          awardAmountCents: null,
          currency: "USD",
          lossReason: "unknown",
          lossReasonNotes: "",
          nextAction: "capture_tabulation",
          nextActionDueAt: null,
          notes: "",
          decidedAt: null,
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        }).run();
      }).not.toThrow();

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

      expect(() =>
        testDb.db.insert(configRegistry).values({
          id: "cfg_test",
          scopeType: "global",
          scopeId: null,
          module: "source",
          configKey: "approval_defaults",
          configValueJson: JSON.stringify({ approvalStatus: "needs_review" }),
          schemaVersion: 1,
          status: "active",
          effectiveFrom: null,
          effectiveTo: null,
          createdBy: "user_1",
          updatedBy: "user_1",
          changeReason: "Schema test config.",
          auditEventId: null,
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        }).run(),
      ).not.toThrow();

      const eventLogColumns = testDb.db.$client
        .prepare("PRAGMA table_info(event_log)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(eventLogColumns).toEqual(
        expect.arrayContaining([
          "id",
          "event_name",
          "occurred_at",
          "environment",
          "organization_id",
          "actor_type",
          "actor_id",
          "actor_role",
          "target_type",
          "target_id",
          "source",
          "outcome",
          "severity",
          "request_id",
          "correlation_id",
          "idempotency_key",
          "metadata_json",
          "before_after_json",
          "retention_class",
          "created_at",
        ]),
      );

      expect(() => {
        testDb.db.insert(eventLog).values({
          id: "event_1",
          eventName: "admin.config.updated",
          occurredAt: "2026-05-19T00:00:00.000Z",
          environment: "test",
          organizationId: "org_1",
          actorType: "admin",
          actorId: "user_1",
          actorRole: "admin",
          targetType: "config",
          targetId: "cfg_test",
          source: "schema-test",
          outcome: "success",
          severity: "info",
          requestId: "req_1",
          correlationId: "corr_1",
          idempotencyKey: "schema:event_1",
          metadataJson: "{}",
          beforeAfterJson: "{}",
          retentionClass: "audit",
          createdAt: "2026-05-19T00:00:00.000Z",
        }).run();
        testDb.db.insert(eventOutbox).values({
          id: "event_outbox_1",
          eventLogId: "event_1",
          destination: "ops-alerts",
          status: "pending",
          attemptCount: 0,
          lastError: null,
          createdAt: "2026-05-19T00:00:00.000Z",
          deliveredAt: null,
        }).run();
      }).not.toThrow();

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

      const bidColumns = testDb.db.$client
        .prepare("PRAGMA table_info(bids)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(bidColumns).toEqual(
        expect.arrayContaining([
          "source_confidence",
          "quality_flags_json",
          "admin_review_status",
          "admin_review_note",
          "admin_reviewed_at",
          "admin_reviewed_by",
          "display_status",
          "detail_archive_status",
          "detail_archive_path",
          "detail_fetched_at",
          "detail_checksum_sha256",
          "detail_archive_error",
        ]),
      );

      const attachmentColumns = testDb.db.$client
        .prepare("PRAGMA table_info(bid_attachments)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(attachmentColumns).toEqual(
        expect.arrayContaining([
          "original_url",
          "storage_path",
          "byte_size",
          "content_type",
          "checksum_sha256",
          "fetched_at",
          "archive_status",
          "archive_error",
        ]),
      );

      const correctionColumns = testDb.db.$client
        .prepare("PRAGMA table_info(bid_field_corrections)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(correctionColumns).toEqual(
        expect.arrayContaining([
          "id",
          "bid_id",
          "field_name",
          "original_value",
          "corrected_value",
          "note",
          "corrected_by",
          "corrected_at",
        ]),
      );

      const dataSourceColumns = testDb.db.$client
        .prepare("PRAGMA table_info(data_sources)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(dataSourceColumns).toEqual(
        expect.arrayContaining([
          "provider_family",
          "access_mode",
          "source_type",
          "source_confidence",
          "activation_status",
          "requires_browser",
          "requires_manual",
          "requires_login",
          "supports_query",
          "supports_pagination",
          "supports_attachment_metadata",
          "supports_detail_page_fetch",
          "fallback_notes",
          "approved_for_ingestion",
          "approval_status",
          "access_pattern",
          "legal_review_status",
          "source_owner",
          "approval_notes",
          "last_approval_reviewed_at",
          "live_health_owner",
          "live_health_disposition",
          "live_health_next_review_at",
          "live_health_notes",
          "live_health_reviewed_at",
          "robots_txt_status",
          "robots_txt_checked_at",
          "robots_txt_hash",
          "robots_txt_disallows_crawled_paths",
          "robots_txt_flag_reason",
          "tos_reviewed",
          "tos_reviewed_at",
          "tos_url",
          "compliance_reviewer",
          "legal_opinion_reference",
          "compliance_review_due_at",
          "compliance_notes",
        ]),
      );

      expect(() =>
        testDb.db.insert(dataSources).values({
          id: "ca_caleprocure_quality",
          label: "California Cal eProcure",
          issuerType: "state",
          stateCode: "CA",
          providerFamily: "state_portal",
          accessMode: "http",
          sourceType: "primary",
          sourceConfidence: "high",
          activationStatus: "active",
          requiresBrowser: 0,
          requiresManual: 0,
          requiresLogin: 0,
          supportsQuery: 1,
          supportsPagination: 1,
          supportsAttachmentMetadata: 0,
          supportsDetailPageFetch: 1,
          fallbackNotes: "403 fallback fixture available",
          approvedForIngestion: 1,
          approvalStatus: "approved",
          accessPattern: "public_http",
          legalReviewStatus: "approved_public",
          sourceOwner: "APSI Data Ops",
          approvalNotes: "Schema test approval.",
          lastApprovalReviewedAt: "2026-06-01T00:00:00.000Z",
          liveHealthOwner: "APSI Data Ops",
          liveHealthDisposition: "needs_manual_triage",
          liveHealthNextReviewAt: "2026-06-08T00:00:00.000Z",
          liveHealthNotes: "Review after next live source check.",
          liveHealthReviewedAt: "2026-06-01T01:00:00.000Z",
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        }).run(),
      ).not.toThrow();

      expect(() =>
        testDb.db.insert(sourceApprovalEvents).values({
          id: "source_approval_event_1",
          sourceId: "ca_caleprocure_quality",
          actorUserId: "admin_1",
          action: "approved",
          previousApprovalStatus: "needs_review",
          nextApprovalStatus: "approved",
          previousLegalReviewStatus: "not_reviewed",
          nextLegalReviewStatus: "approved_public",
          previousApprovedForIngestion: 0,
          nextApprovedForIngestion: 1,
          reason: "Schema test approval history.",
          createdAt: "2026-06-03T00:00:00.000Z",
        }).run(),
      ).not.toThrow();

      expect(() =>
        testDb.db.insert(bids).values({
          id: "archive_bid_1",
          source: "SAM.gov",
          sourceBidId: "archive:1",
          dedupeKey: "archive:1",
          title: "Archived solicitation",
          description: "Archived solicitation description",
          issuerName: "Example Agency",
          issuerType: "federal",
          stateCode: "US",
          sourceUrl: "https://example.gov/solicitation",
          isActive: 1,
          firstSeenAt: "2026-05-19T00:00:00.000Z",
          lastSeenAt: "2026-05-19T00:00:00.000Z",
          createdAt: "2026-05-19T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        }).run(),
      ).not.toThrow();

      expect(() =>
        testDb.db.insert(bidAttachments).values({
          id: "archive_attachment_1",
          bidId: "archive_bid_1",
          name: "Solicitation.pdf",
          url: "https://example.gov/solicitation.pdf",
          originalUrl: "https://example.gov/solicitation.pdf",
          storagePath: "data/attachments/solicitation.pdf",
          byteSize: 2048,
          contentType: "application/pdf",
          checksumSha256: "abc123",
          fetchedAt: "2026-05-19T00:00:00.000Z",
          archiveStatus: "archived",
          createdAt: "2026-05-19T00:00:00.000Z",
        }).run(),
      ).not.toThrow();

      expect(() =>
        testDb.db.insert(bidFieldCorrections).values({
          id: "correction_1",
          bidId: "archive_bid_1",
          fieldName: "title",
          originalValue: "Archived solicitation",
          correctedValue: "Corrected solicitation",
          note: "QA fix",
          correctedBy: "admin_1",
          correctedAt: "2026-05-19T00:00:00.000Z",
        }).run(),
      ).not.toThrow();
    } finally {
      await testDb.cleanup();
    }
  });

  it("creates the knowledge_items table and indexes", async () => {
    const testDb = await createTestDatabase();

    try {
      const tables = testDb.db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name);
      const indexes = testDb.db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((row) => (row as { name: string }).name);
      const columns = testDb.db.$client
        .prepare("PRAGMA table_info(knowledge_items)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(tables).toContain("knowledge_items");
      expect(columns).toEqual(expect.arrayContaining([
        "id",
        "organization_id",
        "created_by_user_id",
        "title",
        "body",
        "type",
        "tags_json",
        "source_kind",
        "source_intent_id",
        "source_bid_id",
        "source_url",
        "metadata_json",
        "created_at",
        "updated_at",
      ]));
      expect(indexes).toEqual(expect.arrayContaining([
        "idx_knowledge_items_organization_id",
        "idx_knowledge_items_created_by_user_id",
        "idx_knowledge_items_source_intent_id",
        "idx_knowledge_items_source_bid_id",
        "idx_knowledge_items_created_at",
      ]));
    } finally {
      await testDb.cleanup();
    }
  });

  it("creates response workspace items with intent indexes", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const tables = testDb.db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name);
      const indexes = testDb.db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((row) => (row as { name: string }).name);
      const columns = testDb.db.$client
        .prepare("PRAGMA table_info(response_workspace_items)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(tables).toContain("response_workspace_items");
      expect(tables).toContain("response_workspace_comments");
      expect(columns).toEqual(expect.arrayContaining([
        "id",
        "intent_id",
        "bid_id",
        "user_id",
        "assigned_user_id",
        "kind",
        "title",
        "status",
        "notes",
        "due_at",
        "sort_order",
        "created_at",
        "updated_at",
      ]));
      expect(indexes).toEqual(expect.arrayContaining([
        "idx_response_workspace_items_intent_id",
        "idx_response_workspace_items_user_id",
        "idx_response_workspace_items_assigned_user_id",
        "idx_response_workspace_items_status",
        "idx_response_workspace_comments_intent_id",
        "idx_response_workspace_comments_item_id",
        "idx_response_workspace_comments_author_user_id",
      ]));

      testDb.db.insert(intentToBid).values({
        id: "intent_seed",
        userId: "anon_seed",
        bidId: "1",
        status: "intent_added",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();

      expect(() =>
        testDb.db.insert(responseWorkspaceItems).values({
          id: "response_workspace_item_1",
          intentId: "intent_seed",
          bidId: "1",
          userId: "anon_seed",
          kind: "task",
          title: "Draft technical approach",
          status: "todo",
          notes: "",
          sortOrder: 1,
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        }).run(),
      ).not.toThrow();

      expect(() =>
        testDb.db.insert(responseWorkspaceComments).values({
          id: "response_workspace_comment_1",
          intentId: "intent_seed",
          itemId: "response_workspace_item_1",
          authorUserId: "anon_seed",
          body: "Please confirm staffing assumptions.",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        }).run(),
      ).not.toThrow();
    } finally {
      await testDb.cleanup();
    }
  });

  it("creates quote workflow tables with organization and intent indexes", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const tables = testDb.db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name);
      const indexes = testDb.db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((row) => (row as { name: string }).name);
      const partnerColumns = testDb.db.$client
        .prepare("PRAGMA table_info(sourcing_partners)")
        .all()
        .map((row) => (row as { name: string }).name);
      const requestColumns = testDb.db.$client
        .prepare("PRAGMA table_info(quote_requests)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(tables).toEqual(expect.arrayContaining([
        "sourcing_partners",
        "quote_requests",
        "quote_request_artifacts",
      ]));
      expect(partnerColumns).toEqual(expect.arrayContaining([
        "id",
        "organization_id",
        "created_by_user_id",
        "name",
        "contact_email",
        "regions_json",
        "capability_tags_json",
        "status",
      ]));
      expect(requestColumns).toEqual(expect.arrayContaining([
        "id",
        "organization_id",
        "intent_id",
        "bid_id",
        "partner_id",
        "status",
        "requested_due_at",
        "line_items_json",
        "quoted_amount_cents",
        "response_notes",
      ]));
      expect(indexes).toEqual(expect.arrayContaining([
        "idx_sourcing_partners_organization_id",
        "idx_quote_requests_intent_id",
        "idx_quote_requests_partner_id",
        "idx_quote_request_artifacts_artifact_id",
      ]));

      testDb.db.insert(users).values({
        id: "quote_user_schema",
        email: "quote-schema@example.com",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();
      testDb.db.insert(organizations).values({
        id: "quote_org_schema",
        name: "Quote Org",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();
      testDb.db.insert(organizationMemberships).values({
        organizationId: "quote_org_schema",
        userId: "quote_user_schema",
        role: "owner",
        status: "active",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();
      testDb.db.insert(intentToBid).values({
        id: "quote_intent_schema",
        userId: "quote_user_schema",
        bidId: "1",
        status: "intent_added",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();
      testDb.db.insert(supplierArtifacts).values({
        id: "quote_artifact_schema",
        intentId: "quote_intent_schema",
        bidId: "1",
        userId: "quote_user_schema",
        title: "Quote support",
        artifactType: "quote",
        purpose: "quote_support",
        fileName: "quote.txt",
        contentType: "text/plain",
        byteSize: 12,
        storagePath: "data/artifact-vault/quote.txt",
        checksumSha256: "hash",
        reviewStatus: "pending_review",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();

      expect(() => {
        testDb.db.insert(sourcingPartners).values({
          id: "partner_schema",
          organizationId: "quote_org_schema",
          createdByUserId: "quote_user_schema",
          name: "Schema Partner",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        }).run();
        testDb.db.insert(quoteRequests).values({
          id: "quote_request_schema",
          organizationId: "quote_org_schema",
          intentId: "quote_intent_schema",
          bidId: "1",
          partnerId: "partner_schema",
          createdByUserId: "quote_user_schema",
          title: "Schema RFQ",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        }).run();
        testDb.db.insert(quoteRequestArtifacts).values({
          quoteRequestId: "quote_request_schema",
          artifactId: "quote_artifact_schema",
          createdAt: "2026-06-01T00:00:00.000Z",
        }).run();
      }).not.toThrow();
    } finally {
      await testDb.cleanup();
    }
  });

  it("creates response workspace item artifact link table with indexes", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const tables = testDb.db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name);
      const indexes = testDb.db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(tables).toContain("response_workspace_item_artifacts");
      expect(tables).toContain("artifact_versions");
      expect(indexes).toEqual(expect.arrayContaining([
        "idx_artifact_versions_artifact_id",
        "idx_artifact_versions_intent_id",
        "idx_artifact_versions_user_id",
        "idx_artifact_versions_created_at",
        "idx_artifact_versions_artifact_version",
        "idx_response_workspace_item_artifacts_artifact_id",
      ]));
      const supplierArtifactColumns = testDb.db.$client
        .prepare("PRAGMA table_info(supplier_artifacts)")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(supplierArtifactColumns).toEqual(expect.arrayContaining([
        "deleted_at",
        "deleted_by_user_id",
      ]));
      const artifactVersionColumns = testDb.db.$client
        .prepare("PRAGMA table_info(artifact_versions)")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(artifactVersionColumns).toEqual(expect.arrayContaining([
        "artifact_id",
        "version_number",
        "storage_provider",
        "security_scan_status",
        "retention_policy",
        "replacement_reason",
        "created_by_user_id",
      ]));

      testDb.db.insert(users).values({
        id: "response_link_user_schema",
        email: "response-link-schema@example.com",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();
      testDb.db.insert(intentToBid).values({
        id: "response_link_intent_schema",
        userId: "response_link_user_schema",
        bidId: "1",
        status: "intent_added",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();
      testDb.db.insert(responseWorkspaceItems).values({
        id: "response_link_item_schema",
        intentId: "response_link_intent_schema",
        bidId: "1",
        userId: "response_link_user_schema",
        kind: "artifact",
        title: "Attach capability statement",
        status: "todo",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();
      testDb.db.insert(supplierArtifacts).values({
        id: "response_link_artifact_schema",
        intentId: "response_link_intent_schema",
        bidId: "1",
        userId: "response_link_user_schema",
        title: "Capability statement",
        artifactType: "capability_statement",
        purpose: "response_workspace",
        fileName: "capability.pdf",
        contentType: "application/pdf",
        byteSize: 1024,
        storagePath: "data/artifact-vault/capability.pdf",
        checksumSha256: "hash_response_link_artifact_schema",
        reviewStatus: "pending_review",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();

      expect(() => testDb.db.insert(responseWorkspaceItemArtifacts).values({
        itemId: "response_link_item_schema",
        artifactId: "response_link_artifact_schema",
        createdAt: "2026-06-01T00:00:00.000Z",
      }).run()).not.toThrow();
      expect(() => testDb.db.insert(artifactVersions).values({
        id: "artifact_version_schema_1",
        artifactId: "response_link_artifact_schema",
        intentId: "response_link_intent_schema",
        bidId: "1",
        userId: "response_link_user_schema",
        versionNumber: 1,
        title: "Capability statement",
        fileName: "capability.pdf",
        contentType: "application/pdf",
        byteSize: 1024,
        storagePath: "data/artifact-vault/capability.pdf",
        storageProvider: "local",
        checksumSha256: "hash_response_link_artifact_schema",
        securityScanStatus: "clean",
        retentionPolicy: "standard_business_record",
        replacementReason: "",
        createdByUserId: "response_link_user_schema",
        createdAt: "2026-06-01T00:00:00.000Z",
      }).run()).not.toThrow();
    } finally {
      await testDb.cleanup();
    }
  });

  it("creates response workspace activity table with intent and item indexes", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const tables = testDb.db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name);
      const indexes = testDb.db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(tables).toContain("response_workspace_activity");
      expect(indexes).toEqual(expect.arrayContaining([
        "idx_response_workspace_activity_intent_id",
        "idx_response_workspace_activity_item_id",
        "idx_response_workspace_activity_actor_user_id",
      ]));

      testDb.db.insert(intentToBid).values({
        id: "response_activity_intent_schema",
        userId: "anon_seed",
        bidId: "1",
        status: "intent_added",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();
      testDb.db.insert(responseWorkspaceItems).values({
        id: "response_activity_item_schema",
        intentId: "response_activity_intent_schema",
        bidId: "1",
        userId: "anon_seed",
        kind: "task",
        title: "Draft response",
        status: "todo",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();
      testDb.db.insert(responseWorkspaceActivity).values({
        id: "response_activity_schema_1",
        intentId: "response_activity_intent_schema",
        itemId: "response_activity_item_schema",
        actorUserId: "anon_seed",
        eventType: "status_changed",
        fromValue: "todo",
        toValue: "done",
        metadataJson: "{}",
        createdAt: "2026-06-01T00:00:00.000Z",
      }).run();

      expect(testDb.db.select().from(responseWorkspaceActivity).all()).toHaveLength(1);
    } finally {
      await testDb.cleanup();
    }
  });

  it("creates response package snapshots with readiness indexes", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const tables = testDb.db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name);
      const indexes = testDb.db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(tables).toContain("response_package_snapshots");
      expect(indexes).toEqual(expect.arrayContaining([
        "idx_response_package_snapshots_intent_id",
        "idx_response_package_snapshots_user_id",
        "idx_response_package_snapshots_created_by_user_id",
      ]));

      testDb.db.insert(intentToBid).values({
        id: "response_package_intent_schema",
        userId: "anon_seed",
        bidId: "1",
        status: "intent_added",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();

      expect(() =>
        testDb.db.insert(responsePackageSnapshots).values({
          id: "response_package_snapshot_schema",
          intentId: "response_package_intent_schema",
          bidId: "1",
          userId: "anon_seed",
          createdByUserId: "anon_seed",
          title: "Response package v1",
          outlineJson: JSON.stringify([{ id: "outline_1", title: "Technical approach" }]),
          readinessJson: JSON.stringify({ ready: false, missingArtifactLinks: 1 }),
          createdAt: "2026-06-01T00:00:00.000Z",
        }).run(),
      ).not.toThrow();
    } finally {
      await testDb.cleanup();
    }
  });

  it("creates response package exports linked to snapshots", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const tables = testDb.db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name);
      const indexes = testDb.db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((row) => (row as { name: string }).name);
      const columns = testDb.db.$client
        .prepare("PRAGMA table_info(response_package_exports)")
        .all()
        .map((row) => (row as { name: string }).name);
      const reviewEventColumns = testDb.db.$client
        .prepare("PRAGMA table_info(response_package_export_review_events)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(tables).toContain("response_package_exports");
      expect(tables).toContain("response_package_export_review_events");
      expect(indexes).toEqual(expect.arrayContaining([
        "idx_response_package_exports_intent_id",
        "idx_response_package_exports_snapshot_id",
        "idx_response_package_exports_user_id",
        "idx_response_package_export_review_events_export_id",
        "idx_response_package_export_review_events_intent_id",
        "idx_response_package_export_review_events_user_id",
        "idx_response_package_export_review_events_actor_user_id",
        "idx_response_package_export_review_events_created_at",
      ]));
      expect(columns).toEqual(expect.arrayContaining([
        "format",
        "review_status",
        "reviewed_at",
        "reviewed_by_user_id",
        "review_notes",
      ]));
      expect(reviewEventColumns).toEqual(expect.arrayContaining([
        "export_id",
        "snapshot_id",
        "intent_id",
        "bid_id",
        "user_id",
        "actor_user_id",
        "from_review_status",
        "to_review_status",
        "review_notes",
        "created_at",
      ]));

      testDb.db.insert(intentToBid).values({
        id: "response_export_intent_schema",
        userId: "anon_seed",
        bidId: "1",
        status: "intent_added",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();
      testDb.db.insert(responsePackageSnapshots).values({
        id: "response_export_snapshot_schema",
        intentId: "response_export_intent_schema",
        bidId: "1",
        userId: "anon_seed",
        createdByUserId: "anon_seed",
        title: "Response package v1",
        outlineJson: "[]",
        readinessJson: "{}",
        createdAt: "2026-06-01T00:00:00.000Z",
      }).run();

      expect(() =>
        testDb.db.insert(responsePackageExports).values({
          id: "response_package_export_schema",
          snapshotId: "response_export_snapshot_schema",
          intentId: "response_export_intent_schema",
          bidId: "1",
          userId: "anon_seed",
          requestedByUserId: "anon_seed",
          status: "ready",
          format: "markdown",
          fileName: "response-package.md",
          contentType: "text/markdown; charset=utf-8",
          byteSize: 128,
          storagePath: "data/response-package-exports/response-package.md",
          checksumSha256: "hash_response_package_export_schema",
          readinessJson: "{}",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        }).run(),
      ).not.toThrow();
      expect(() =>
        testDb.db.insert(responsePackageExportReviewEvents).values({
          id: "response_package_export_review_event_schema",
          exportId: "response_package_export_schema",
          snapshotId: "response_export_snapshot_schema",
          intentId: "response_export_intent_schema",
          bidId: "1",
          userId: "anon_seed",
          actorUserId: "anon_seed",
          fromReviewStatus: "pending_review",
          toReviewStatus: "approved",
          reviewNotes: "Approved for submission.",
          createdAt: "2026-06-01T00:01:00.000Z",
        }).run(),
      ).not.toThrow();
    } finally {
      await testDb.cleanup();
    }
  });

  it("creates deadline reminder tables with intent indexes and dedupe protection", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      const tables = testDb.db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name);
      const indexes = testDb.db.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((row) => (row as { name: string }).name);
      const columns = testDb.db.$client
        .prepare("PRAGMA table_info(deadline_reminders)")
        .all()
        .map((row) => (row as { name: string }).name);

      expect(tables).toContain("deadline_reminders");
      expect(columns).toEqual(expect.arrayContaining([
        "id",
        "organization_id",
        "user_id",
        "intent_id",
        "bid_id",
        "kind",
        "linked_object_type",
        "linked_object_id",
        "dedupe_key",
        "title",
        "due_at",
        "reminder_at",
        "status",
        "priority",
        "source",
        "metadata_json",
        "acknowledged_at",
        "snoozed_until",
      ]));
      expect(indexes).toEqual(expect.arrayContaining([
        "idx_deadline_reminders_organization_id",
        "idx_deadline_reminders_intent_id",
        "idx_deadline_reminders_user_id",
        "idx_deadline_reminders_status",
        "idx_deadline_reminders_due_at",
        "idx_deadline_reminders_dedupe_key",
      ]));

      testDb.db.insert(users).values({
        id: "deadline_user_schema",
        email: "deadline-schema@example.com",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();
      testDb.db.insert(organizations).values({
        id: "deadline_org_schema",
        name: "Deadline Org",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();
      testDb.db.insert(organizationMemberships).values({
        organizationId: "deadline_org_schema",
        userId: "deadline_user_schema",
        role: "owner",
        status: "active",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();
      testDb.db.insert(intentToBid).values({
        id: "deadline_intent_schema",
        userId: "deadline_user_schema",
        bidId: "1",
        status: "intent_added",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      }).run();

      const reminder = {
        id: "deadline_reminder_schema",
        organizationId: "deadline_org_schema",
        userId: "deadline_user_schema",
        intentId: "deadline_intent_schema",
        bidId: "1",
        kind: "bid_deadline",
        linkedObjectType: "bid",
        linkedObjectId: "1",
        dedupeKey: "deadline_intent_schema:bid_deadline:1",
        title: "Bid deadline",
        dueAt: "2026-06-15T00:00:00.000Z",
        reminderAt: "2026-06-13T00:00:00.000Z",
        status: "active",
        priority: "high",
        source: "generated",
        metadataJson: "{}",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      };

      expect(() => testDb.db.insert(deadlineReminders).values(reminder).run()).not.toThrow();
      expect(() =>
        testDb.db.insert(deadlineReminders).values({
          ...reminder,
          id: "deadline_reminder_schema_duplicate",
        }).run(),
      ).toThrow();
    } finally {
      await testDb.cleanup();
    }
  });
});
