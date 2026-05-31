import type { AppDatabase } from "./client";

export function runMigrations(db: AppDatabase) {
  const sqlite = db.$client;

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      password_hash TEXT,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      account_tier TEXT NOT NULL DEFAULT 'free',
      is_disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_user_audit_logs (
      id TEXT PRIMARY KEY,
      actor_kind TEXT NOT NULL,
      actor_user_id TEXT,
      target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      changes_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS account_subscriptions (
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

    CREATE TABLE IF NOT EXISTS billing_checkout_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tier TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      provider TEXT NOT NULL DEFAULT 'local_checkout',
      provider_session_id TEXT NOT NULL,
      checkout_url TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS billing_invoices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'billing_provider',
      provider_customer_id TEXT,
      provider_subscription_id TEXT,
      provider_invoice_id TEXT NOT NULL,
      invoice_number TEXT,
      status TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      amount_due_cents INTEGER NOT NULL DEFAULT 0,
      amount_paid_cents INTEGER NOT NULL DEFAULT 0,
      invoice_url TEXT,
      invoice_pdf_url TEXT,
      due_at TEXT,
      paid_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscription_events (
      id TEXT PRIMARY KEY,
      provider_event_id TEXT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_id TEXT REFERENCES account_subscriptions(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      from_tier TEXT,
      to_tier TEXT,
      from_status TEXT,
      to_status TEXT,
      source TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS credit_balances (
      organization_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
      included_credits_remaining INTEGER,
      purchased_credits_remaining INTEGER NOT NULL DEFAULT 0,
      period_start TEXT,
      period_end TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS credit_usage_events (
      id TEXT PRIMARY KEY,
      organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      feature_key TEXT NOT NULL,
      event_type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      balance_after INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_notification_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      saved_search_alerts_enabled INTEGER NOT NULL DEFAULT 1,
      default_alert_frequency TEXT NOT NULL DEFAULT 'daily',
      marketing_updates_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      account_tier TEXT NOT NULL DEFAULT 'free',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organization_feature_overrides (
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      feature_key TEXT NOT NULL,
      is_enabled INTEGER NOT NULL,
      reason TEXT,
      expires_at TEXT,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, feature_key)
    );

    CREATE TABLE IF NOT EXISTS workspace_invitations (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      invited_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invited_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      revoked_at TEXT,
      last_sent_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organization_memberships (
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS bids (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_bid_id TEXT,
      dedupe_key TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      full_description TEXT,
      original_category TEXT,
      amount TEXT,
      amount_min INTEGER,
      amount_max INTEGER,
      currency TEXT NOT NULL DEFAULT 'USD',
      published_date TEXT,
      deadline_date TEXT,
      issuer_name TEXT NOT NULL,
      issuer_type TEXT NOT NULL,
      state_code TEXT NOT NULL,
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      source_url TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      raw_payload TEXT,
      source_confidence TEXT NOT NULL DEFAULT 'medium',
      quality_flags_json TEXT NOT NULL DEFAULT '[]',
      admin_review_status TEXT NOT NULL DEFAULT 'unreviewed',
      admin_review_note TEXT,
      admin_reviewed_at TEXT,
      admin_reviewed_by TEXT,
      display_status TEXT NOT NULL DEFAULT 'published',
      detail_archive_status TEXT NOT NULL DEFAULT 'not_archived',
      detail_archive_path TEXT,
      detail_fetched_at TEXT,
      detail_checksum_sha256 TEXT,
      detail_archive_error TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bid_attachments (
      id TEXT PRIMARY KEY,
      bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      original_url TEXT,
      storage_path TEXT,
      byte_size INTEGER,
      content_type TEXT,
      checksum_sha256 TEXT,
      fetched_at TEXT,
      archive_status TEXT NOT NULL DEFAULT 'not_archived',
      archive_error TEXT,
      size_label TEXT,
      mime_type TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bid_field_corrections (
      id TEXT PRIMARY KEY,
      bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      field_name TEXT NOT NULL,
      original_value TEXT,
      corrected_value TEXT,
      note TEXT,
      corrected_by TEXT NOT NULL,
      corrected_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bid_field_corrections_bid_id ON bid_field_corrections(bid_id);
    CREATE INDEX IF NOT EXISTS idx_bid_field_corrections_field_name ON bid_field_corrections(field_name);

    CREATE TABLE IF NOT EXISTS saved_bids (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, bid_id)
    );

    CREATE TABLE IF NOT EXISTS supplier_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      company_name TEXT NOT NULL DEFAULT '',
      business_types TEXT NOT NULL DEFAULT '[]',
      categories TEXT NOT NULL DEFAULT '[]',
      keywords TEXT NOT NULL DEFAULT '[]',
      certifications TEXT NOT NULL DEFAULT '[]',
      service_states TEXT NOT NULL DEFAULT '[]',
      min_contract_value INTEGER,
      max_contract_value INTEGER,
      risk_preferences TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS intent_to_bid (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'intent_added',
      ai_bid_brief TEXT NOT NULL DEFAULT '',
      key_dates_json TEXT NOT NULL DEFAULT '{}',
      initial_checklist_json TEXT NOT NULL DEFAULT '[]',
      risk_flags_json TEXT NOT NULL DEFAULT '[]',
      match_score_snapshot_json TEXT NOT NULL DEFAULT '{}',
      evidence_citations_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS knowledge_items (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      type TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      source_kind TEXT NOT NULL,
      source_intent_id TEXT REFERENCES intent_to_bid(id) ON DELETE SET NULL,
      source_bid_id TEXT REFERENCES bids(id) ON DELETE SET NULL,
      source_url TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS submission_paths (
      id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL REFERENCES intent_to_bid(id) ON DELETE CASCADE,
      bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

    CREATE TABLE IF NOT EXISTS submission_confirmations (
      id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL REFERENCES intent_to_bid(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      submitted_at TEXT NOT NULL,
      method TEXT NOT NULL,
      confirmation_reference TEXT NOT NULL DEFAULT '',
      confirmation_notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS compliance_manifest_items (
      id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL REFERENCES intent_to_bid(id) ON DELETE CASCADE,
      bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'not_started',
      evidence_status TEXT NOT NULL DEFAULT 'needed',
      notes TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pursuit_decisions (
      id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL REFERENCES intent_to_bid(id) ON DELETE CASCADE,
      bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      decision TEXT NOT NULL,
      reasons_json TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      query TEXT,
      states TEXT,
      issuer_type TEXT,
      deadline_preset TEXT,
      published_preset TEXT,
      frequency TEXT NOT NULL DEFAULT 'daily',
      notification_channel TEXT NOT NULL DEFAULT 'email',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      last_matched_at TEXT,
      last_notified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS crawler_logs (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      run_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER,
      fetched_count INTEGER NOT NULL DEFAULT 0,
      inserted_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      error_stack TEXT,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS crawler_locks (
      source TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_outbox (
      id TEXT PRIMARY KEY,
      alert_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      recipient TEXT NOT NULL,
      frequency TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_text TEXT NOT NULL,
      matched_bid_ids TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT
    );

    CREATE TABLE IF NOT EXISTS search_alert_digest_runs (
      id TEXT PRIMARY KEY,
      alert_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      frequency TEXT NOT NULL,
      status TEXT NOT NULL,
      match_count INTEGER NOT NULL DEFAULT 0,
      notification_id TEXT,
      skipped_reason TEXT,
      failure_reason TEXT,
      matched_bid_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS data_sources (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      issuer_type TEXT NOT NULL,
      state_code TEXT NOT NULL,
      base_url TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      cadence TEXT NOT NULL DEFAULT 'daily',
      provider_family TEXT,
      access_mode TEXT,
      source_type TEXT,
      source_confidence TEXT,
      activation_status TEXT,
      requires_browser INTEGER,
      requires_manual INTEGER,
      requires_login INTEGER,
      supports_query INTEGER,
      supports_pagination INTEGER,
      supports_attachment_metadata INTEGER,
      supports_detail_page_fetch INTEGER,
      fallback_notes TEXT,
      last_success_at TEXT,
      last_failure_at TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_admin_user_audit_actor ON admin_user_audit_logs(actor_user_id);
    CREATE INDEX IF NOT EXISTS idx_admin_user_audit_target ON admin_user_audit_logs(target_user_id);
    CREATE INDEX IF NOT EXISTS idx_admin_user_audit_created ON admin_user_audit_logs(created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_account_subscriptions_user_id ON account_subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_account_subscriptions_provider_subscription ON account_subscriptions(provider_subscription_id);
    CREATE INDEX IF NOT EXISTS idx_billing_checkout_sessions_user_id ON billing_checkout_sessions(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_checkout_sessions_provider_session_id ON billing_checkout_sessions(provider_session_id);
    CREATE INDEX IF NOT EXISTS idx_billing_invoices_user_id ON billing_invoices(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_invoices_provider_invoice_id ON billing_invoices(provider_invoice_id);
    CREATE INDEX IF NOT EXISTS idx_billing_invoices_provider_subscription_id ON billing_invoices(provider_subscription_id);
    CREATE INDEX IF NOT EXISTS idx_subscription_events_user_id ON subscription_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_subscription_events_subscription_id ON subscription_events(subscription_id);
    CREATE INDEX IF NOT EXISTS idx_subscription_events_created ON subscription_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_credit_usage_events_organization_id ON credit_usage_events(organization_id);
    CREATE INDEX IF NOT EXISTS idx_credit_usage_events_user_id ON credit_usage_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_credit_usage_events_feature_key ON credit_usage_events(feature_key);
    CREATE INDEX IF NOT EXISTS idx_credit_usage_events_created_at ON credit_usage_events(created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash ON password_reset_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_invitations_token_hash ON workspace_invitations(token_hash);
    CREATE INDEX IF NOT EXISTS idx_workspace_invitations_organization_id ON workspace_invitations(organization_id);
    CREATE INDEX IF NOT EXISTS idx_workspace_invitations_invited_user_id ON workspace_invitations(invited_user_id);
    CREATE INDEX IF NOT EXISTS idx_workspace_invitations_email ON workspace_invitations(email);
    CREATE INDEX IF NOT EXISTS idx_organization_memberships_user_id ON organization_memberships(user_id);
    CREATE INDEX IF NOT EXISTS idx_organization_memberships_organization_id ON organization_memberships(organization_id);
    CREATE INDEX IF NOT EXISTS idx_organization_feature_overrides_org ON organization_feature_overrides(organization_id);
    CREATE INDEX IF NOT EXISTS idx_organization_feature_overrides_feature ON organization_feature_overrides(feature_key);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_dedupe_key ON bids(dedupe_key);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_source_source_bid_id ON bids(source, source_bid_id);
    CREATE INDEX IF NOT EXISTS idx_bids_active_deadline ON bids(is_active, deadline_date);
    CREATE INDEX IF NOT EXISTS idx_bids_published_date ON bids(published_date);
    CREATE INDEX IF NOT EXISTS idx_bids_state_code ON bids(state_code);
    CREATE INDEX IF NOT EXISTS idx_bids_issuer_type ON bids(issuer_type);
    CREATE INDEX IF NOT EXISTS idx_bids_source ON bids(source);
    CREATE INDEX IF NOT EXISTS idx_bid_attachments_bid_id ON bid_attachments(bid_id);
    CREATE INDEX IF NOT EXISTS idx_saved_bids_bid_id ON saved_bids(bid_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_intent_to_bid_user_bid ON intent_to_bid(user_id, bid_id);
    CREATE INDEX IF NOT EXISTS idx_intent_to_bid_user_id ON intent_to_bid(user_id);
    CREATE INDEX IF NOT EXISTS idx_intent_to_bid_bid_id ON intent_to_bid(bid_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_items_organization_id ON knowledge_items(organization_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_items_created_by_user_id ON knowledge_items(created_by_user_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_items_source_intent_id ON knowledge_items(source_intent_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_items_source_bid_id ON knowledge_items(source_bid_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_items_created_at ON knowledge_items(created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_submission_paths_intent_id ON submission_paths(intent_id);
    CREATE INDEX IF NOT EXISTS idx_submission_paths_user_id ON submission_paths(user_id);
    CREATE INDEX IF NOT EXISTS idx_submission_paths_bid_id ON submission_paths(bid_id);
    CREATE INDEX IF NOT EXISTS idx_submission_confirmations_intent_id ON submission_confirmations(intent_id);
    CREATE INDEX IF NOT EXISTS idx_submission_confirmations_user_id ON submission_confirmations(user_id);
    CREATE INDEX IF NOT EXISTS idx_compliance_manifest_items_intent_id ON compliance_manifest_items(intent_id);
    CREATE INDEX IF NOT EXISTS idx_compliance_manifest_items_user_id ON compliance_manifest_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_compliance_manifest_items_status ON compliance_manifest_items(status);
    CREATE INDEX IF NOT EXISTS idx_pursuit_decisions_intent_id ON pursuit_decisions(intent_id);
    CREATE INDEX IF NOT EXISTS idx_pursuit_decisions_user_id ON pursuit_decisions(user_id);
    CREATE INDEX IF NOT EXISTS idx_pursuit_decisions_decision ON pursuit_decisions(decision);
    CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts(user_id);
    CREATE INDEX IF NOT EXISTS idx_crawler_logs_source_started ON crawler_logs(source, started_at);
    CREATE INDEX IF NOT EXISTS idx_crawler_logs_run_id ON crawler_logs(run_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_outbox_dedupe_key ON notification_outbox(dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_notification_outbox_status_created ON notification_outbox(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_notification_outbox_alert_id ON notification_outbox(alert_id);
    CREATE INDEX IF NOT EXISTS idx_notification_outbox_user_id ON notification_outbox(user_id);
    CREATE INDEX IF NOT EXISTS idx_search_alert_digest_runs_alert_created ON search_alert_digest_runs(alert_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_search_alert_digest_runs_user_created ON search_alert_digest_runs(user_id, created_at);
  `);

  const userColumns = new Set(
    sqlite
      .prepare("PRAGMA table_info(users)")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  if (!userColumns.has("account_tier")) {
    sqlite.exec("ALTER TABLE users ADD COLUMN account_tier TEXT NOT NULL DEFAULT 'free'");
  }

  if (!userColumns.has("is_disabled")) {
    sqlite.exec("ALTER TABLE users ADD COLUMN is_disabled INTEGER NOT NULL DEFAULT 0");
  }

  const organizationColumns = new Set(
    sqlite
      .prepare("PRAGMA table_info(organizations)")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  if (!organizationColumns.has("account_tier")) {
    sqlite.exec("ALTER TABLE organizations ADD COLUMN account_tier TEXT NOT NULL DEFAULT 'free'");
    sqlite.exec(`
      UPDATE organizations
      SET account_tier = COALESCE((
        SELECT users.account_tier
        FROM organization_memberships
        INNER JOIN users ON users.id = organization_memberships.user_id
        WHERE organization_memberships.organization_id = organizations.id
          AND organization_memberships.role = 'owner'
          AND organization_memberships.status = 'active'
        ORDER BY
          CASE users.account_tier
            WHEN 'enterprise' THEN 4
            WHEN 'business' THEN 3
            WHEN 'pro' THEN 2
            ELSE 1
          END DESC
        LIMIT 1
      ), 'free')
    `);
  }

  const organizationFeatureOverrideColumns = new Set(
    sqlite
      .prepare("PRAGMA table_info(organization_feature_overrides)")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  if (!organizationFeatureOverrideColumns.has("reason")) {
    sqlite.exec("ALTER TABLE organization_feature_overrides ADD COLUMN reason TEXT");
  }

  if (!organizationFeatureOverrideColumns.has("expires_at")) {
    sqlite.exec("ALTER TABLE organization_feature_overrides ADD COLUMN expires_at TEXT");
  }

  const subscriptionEventColumns = new Set(
    sqlite
      .prepare("PRAGMA table_info(subscription_events)")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  if (!subscriptionEventColumns.has("provider_event_id")) {
    sqlite.exec("ALTER TABLE subscription_events ADD COLUMN provider_event_id TEXT");
  }

  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_events_provider_event_id ON subscription_events(provider_event_id)");

  const workspaceInvitationColumns = new Set(
    sqlite
      .prepare("PRAGMA table_info(workspace_invitations)")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  if (!workspaceInvitationColumns.has("revoked_at")) {
    sqlite.exec("ALTER TABLE workspace_invitations ADD COLUMN revoked_at TEXT");
  }

  if (!workspaceInvitationColumns.has("last_sent_at")) {
    sqlite.exec("ALTER TABLE workspace_invitations ADD COLUMN last_sent_at TEXT");
  }

  const bidColumns = new Set(
    sqlite
      .prepare("PRAGMA table_info(bids)")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  const addBidColumn = (name: string, definition: string) => {
    if (!bidColumns.has(name)) {
      sqlite.exec(`ALTER TABLE bids ADD COLUMN ${name} ${definition}`);
    }
  };

  addBidColumn("source_confidence", "TEXT NOT NULL DEFAULT 'medium'");
  addBidColumn("quality_flags_json", "TEXT NOT NULL DEFAULT '[]'");
  addBidColumn("admin_review_status", "TEXT NOT NULL DEFAULT 'unreviewed'");
  addBidColumn("admin_review_note", "TEXT");
  addBidColumn("admin_reviewed_at", "TEXT");
  addBidColumn("admin_reviewed_by", "TEXT");
  addBidColumn("display_status", "TEXT NOT NULL DEFAULT 'published'");
  addBidColumn("detail_archive_status", "TEXT NOT NULL DEFAULT 'not_archived'");
  addBidColumn("detail_archive_path", "TEXT");
  addBidColumn("detail_fetched_at", "TEXT");
  addBidColumn("detail_checksum_sha256", "TEXT");
  addBidColumn("detail_archive_error", "TEXT");

  const bidAttachmentColumns = new Set(
    sqlite
      .prepare("PRAGMA table_info(bid_attachments)")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  const addBidAttachmentColumn = (name: string, definition: string) => {
    if (!bidAttachmentColumns.has(name)) {
      sqlite.exec(`ALTER TABLE bid_attachments ADD COLUMN ${name} ${definition}`);
    }
  };

  addBidAttachmentColumn("original_url", "TEXT");
  addBidAttachmentColumn("storage_path", "TEXT");
  addBidAttachmentColumn("byte_size", "INTEGER");
  addBidAttachmentColumn("content_type", "TEXT");
  addBidAttachmentColumn("checksum_sha256", "TEXT");
  addBidAttachmentColumn("fetched_at", "TEXT");
  addBidAttachmentColumn("archive_status", "TEXT NOT NULL DEFAULT 'not_archived'");
  addBidAttachmentColumn("archive_error", "TEXT");

  const intentColumns = new Set(
    sqlite
      .prepare("PRAGMA table_info(intent_to_bid)")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  if (!intentColumns.has("evidence_citations_json")) {
    sqlite.exec("ALTER TABLE intent_to_bid ADD COLUMN evidence_citations_json TEXT NOT NULL DEFAULT '[]'");
  }

  const dataSourceColumns = new Set(
    sqlite
      .prepare("PRAGMA table_info(data_sources)")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  const addDataSourceColumn = (name: string, definition: string) => {
    if (!dataSourceColumns.has(name)) {
      sqlite.exec(`ALTER TABLE data_sources ADD COLUMN ${name} ${definition}`);
    }
  };

  addDataSourceColumn("provider_family", "TEXT");
  addDataSourceColumn("access_mode", "TEXT");
  addDataSourceColumn("source_type", "TEXT");
  addDataSourceColumn("source_confidence", "TEXT");
  addDataSourceColumn("activation_status", "TEXT");
  addDataSourceColumn("requires_browser", "INTEGER");
  addDataSourceColumn("requires_manual", "INTEGER");
  addDataSourceColumn("requires_login", "INTEGER");
  addDataSourceColumn("supports_query", "INTEGER");
  addDataSourceColumn("supports_pagination", "INTEGER");
  addDataSourceColumn("supports_attachment_metadata", "INTEGER");
  addDataSourceColumn("supports_detail_page_fetch", "INTEGER");
  addDataSourceColumn("fallback_notes", "TEXT");
}
