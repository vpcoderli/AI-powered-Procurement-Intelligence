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

    CREATE TABLE IF NOT EXISTS ai_call_logs (
      id TEXT PRIMARY KEY,
      ai_run_id TEXT NOT NULL,
      organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      confidence TEXT NOT NULL DEFAULT 'medium',
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd_micros INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS config_registry (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL DEFAULT 'global',
      scope_id TEXT,
      module TEXT NOT NULL,
      config_key TEXT NOT NULL,
      config_value_json TEXT NOT NULL DEFAULT '{}',
      schema_version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      effective_from TEXT,
      effective_to TEXT,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      change_reason TEXT NOT NULL,
      audit_event_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_log (
      id TEXT PRIMARY KEY,
      event_name TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'local',
      organization_id TEXT,
      actor_type TEXT NOT NULL DEFAULT 'system',
      actor_id TEXT,
      actor_role TEXT,
      target_type TEXT,
      target_id TEXT,
      source TEXT NOT NULL,
      outcome TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      request_id TEXT,
      correlation_id TEXT,
      idempotency_key TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      before_after_json TEXT NOT NULL DEFAULT '{}',
      retention_class TEXT NOT NULL DEFAULT 'standard',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_outbox (
      id TEXT PRIMARY KEY,
      event_log_id TEXT NOT NULL REFERENCES event_log(id) ON DELETE CASCADE,
      destination TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      delivered_at TEXT
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
      status TEXT NOT NULL DEFAULT 'draft',
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
      evidence_snapshot_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS award_outcomes (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      intent_id TEXT NOT NULL REFERENCES intent_to_bid(id) ON DELETE CASCADE,
      bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'awaiting_award',
      award_notice_url TEXT NOT NULL DEFAULT '',
      tabulation_artifact_id TEXT REFERENCES supplier_artifacts(id) ON DELETE SET NULL,
      tabulation_artifact_url TEXT NOT NULL DEFAULT '',
      winner_name TEXT NOT NULL DEFAULT '',
      award_amount_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'USD',
      loss_reason TEXT NOT NULL DEFAULT 'unknown',
      loss_reason_notes TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL DEFAULT 'capture_tabulation',
      next_action_due_at TEXT,
      notes TEXT NOT NULL DEFAULT '',
      decided_at TEXT,
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

    CREATE TABLE IF NOT EXISTS response_workspace_items (
      id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL REFERENCES intent_to_bid(id) ON DELETE CASCADE,
      bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'todo',
      notes TEXT NOT NULL DEFAULT '',
      due_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS response_workspace_comments (
      id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL REFERENCES intent_to_bid(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES response_workspace_items(id) ON DELETE CASCADE,
      author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS response_workspace_activity (
      id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL REFERENCES intent_to_bid(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES response_workspace_items(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      from_value TEXT,
      to_value TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS response_package_snapshots (
      id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL REFERENCES intent_to_bid(id) ON DELETE CASCADE,
      bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      outline_json TEXT NOT NULL DEFAULT '[]',
      readiness_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS response_package_exports (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL REFERENCES response_package_snapshots(id) ON DELETE CASCADE,
      intent_id TEXT NOT NULL REFERENCES intent_to_bid(id) ON DELETE CASCADE,
      bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      requested_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'ready',
      format TEXT NOT NULL DEFAULT 'markdown',
      file_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      checksum_sha256 TEXT NOT NULL,
      readiness_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      downloaded_at TEXT,
      review_status TEXT NOT NULL DEFAULT 'pending_review',
      reviewed_at TEXT,
      reviewed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      review_notes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS response_package_export_review_events (
      id TEXT PRIMARY KEY,
      export_id TEXT NOT NULL REFERENCES response_package_exports(id) ON DELETE CASCADE,
      snapshot_id TEXT NOT NULL REFERENCES response_package_snapshots(id) ON DELETE CASCADE,
      intent_id TEXT NOT NULL REFERENCES intent_to_bid(id) ON DELETE CASCADE,
      bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      from_review_status TEXT NOT NULL,
      to_review_status TEXT NOT NULL,
      review_notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supplier_artifacts (
      id TEXT PRIMARY KEY,
      intent_id TEXT NOT NULL REFERENCES intent_to_bid(id) ON DELETE CASCADE,
      bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      purpose TEXT NOT NULL,
      file_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      checksum_sha256 TEXT NOT NULL,
      expires_at TEXT,
      review_status TEXT NOT NULL DEFAULT 'pending_review',
      notes TEXT NOT NULL DEFAULT '',
      deleted_at TEXT,
      deleted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifact_versions (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL REFERENCES supplier_artifacts(id) ON DELETE CASCADE,
      intent_id TEXT NOT NULL REFERENCES intent_to_bid(id) ON DELETE CASCADE,
      bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      storage_provider TEXT NOT NULL DEFAULT 'local',
      checksum_sha256 TEXT NOT NULL,
      security_scan_status TEXT NOT NULL DEFAULT 'clean',
      retention_policy TEXT NOT NULL DEFAULT 'standard_business_record',
      replacement_reason TEXT NOT NULL DEFAULT '',
      created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS response_workspace_item_artifacts (
      item_id TEXT NOT NULL REFERENCES response_workspace_items(id) ON DELETE CASCADE,
      artifact_id TEXT NOT NULL REFERENCES supplier_artifacts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (item_id, artifact_id)
    );

    CREATE TABLE IF NOT EXISTS sourcing_partners (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      contact_name TEXT NOT NULL DEFAULT '',
      contact_email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      regions_json TEXT NOT NULL DEFAULT '[]',
      capability_tags_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quote_requests (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      intent_id TEXT NOT NULL REFERENCES intent_to_bid(id) ON DELETE CASCADE,
      bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      partner_id TEXT NOT NULL REFERENCES sourcing_partners(id) ON DELETE CASCADE,
      created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      requested_due_at TEXT,
      line_items_json TEXT NOT NULL DEFAULT '[]',
      quoted_amount_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'USD',
      response_notes TEXT NOT NULL DEFAULT '',
      responded_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quote_request_artifacts (
      quote_request_id TEXT NOT NULL REFERENCES quote_requests(id) ON DELETE CASCADE,
      artifact_id TEXT NOT NULL REFERENCES supplier_artifacts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (quote_request_id, artifact_id)
    );

    CREATE TABLE IF NOT EXISTS deadline_reminders (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      intent_id TEXT NOT NULL REFERENCES intent_to_bid(id) ON DELETE CASCADE,
      bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      linked_object_type TEXT NOT NULL,
      linked_object_id TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      title TEXT NOT NULL,
      due_at TEXT NOT NULL,
      reminder_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      priority TEXT NOT NULL DEFAULT 'medium',
      source TEXT NOT NULL DEFAULT 'generated',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      acknowledged_at TEXT,
      snoozed_until TEXT,
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

    CREATE TABLE IF NOT EXISTS risk_check_snapshots (
      id TEXT PRIMARY KEY,
      ok INTEGER NOT NULL,
      checked_at TEXT NOT NULL,
      report_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_health_snapshots (
      id TEXT PRIMARY KEY,
      ok INTEGER NOT NULL,
      checked_at TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      results_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_compliance_snapshots (
      id TEXT PRIMARY KEY,
      ok INTEGER NOT NULL,
      checked_at TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      results_json TEXT NOT NULL,
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
      approved_for_ingestion INTEGER,
      approval_status TEXT,
      access_pattern TEXT,
      legal_review_status TEXT,
      source_owner TEXT,
      approval_notes TEXT,
      last_approval_reviewed_at TEXT,
      live_health_owner TEXT,
      live_health_disposition TEXT,
      live_health_next_review_at TEXT,
      live_health_notes TEXT,
      live_health_reviewed_at TEXT,
      last_success_at TEXT,
      last_failure_at TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      robots_txt_status TEXT,
      robots_txt_checked_at TEXT,
      robots_txt_hash TEXT,
      robots_txt_disallows_crawled_paths INTEGER,
      robots_txt_flag_reason TEXT,
      tos_reviewed INTEGER,
      tos_reviewed_at TEXT,
      tos_url TEXT,
      compliance_reviewer TEXT,
      legal_opinion_reference TEXT,
      compliance_review_due_at TEXT,
      compliance_notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_approval_events (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      previous_approval_status TEXT,
      next_approval_status TEXT,
      previous_legal_review_status TEXT,
      next_legal_review_status TEXT,
      previous_approved_for_ingestion INTEGER,
      next_approved_for_ingestion INTEGER,
      reason TEXT,
      created_at TEXT NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_ai_call_logs_ai_run_id ON ai_call_logs(ai_run_id);
    CREATE INDEX IF NOT EXISTS idx_ai_call_logs_organization_id ON ai_call_logs(organization_id);
    CREATE INDEX IF NOT EXISTS idx_ai_call_logs_user_id ON ai_call_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_ai_call_logs_action ON ai_call_logs(action);
    CREATE INDEX IF NOT EXISTS idx_ai_call_logs_created_at ON ai_call_logs(created_at);
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
    CREATE INDEX IF NOT EXISTS idx_config_registry_lookup ON config_registry(scope_type, scope_id, module, config_key);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_config_registry_unique_key ON config_registry(scope_type, COALESCE(scope_id, ''), module, config_key);
    CREATE INDEX IF NOT EXISTS idx_config_registry_module ON config_registry(module);
    CREATE INDEX IF NOT EXISTS idx_config_registry_status ON config_registry(status);
    CREATE INDEX IF NOT EXISTS idx_event_log_event_name ON event_log(event_name);
    CREATE INDEX IF NOT EXISTS idx_event_log_occurred_at ON event_log(occurred_at);
    CREATE INDEX IF NOT EXISTS idx_event_log_organization_id ON event_log(organization_id);
    CREATE INDEX IF NOT EXISTS idx_event_log_target ON event_log(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_event_log_request_id ON event_log(request_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_event_log_idempotency_key ON event_log(idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_event_outbox_event_log_id ON event_outbox(event_log_id);
    CREATE INDEX IF NOT EXISTS idx_event_outbox_status_created ON event_outbox(status, created_at);
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_award_outcomes_intent_id ON award_outcomes(intent_id);
    CREATE INDEX IF NOT EXISTS idx_award_outcomes_organization_id ON award_outcomes(organization_id);
    CREATE INDEX IF NOT EXISTS idx_award_outcomes_user_id ON award_outcomes(user_id);
    CREATE INDEX IF NOT EXISTS idx_award_outcomes_status ON award_outcomes(status);
    CREATE INDEX IF NOT EXISTS idx_award_outcomes_next_action_due_at ON award_outcomes(next_action_due_at);
    CREATE INDEX IF NOT EXISTS idx_compliance_manifest_items_intent_id ON compliance_manifest_items(intent_id);
    CREATE INDEX IF NOT EXISTS idx_compliance_manifest_items_user_id ON compliance_manifest_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_compliance_manifest_items_status ON compliance_manifest_items(status);
    CREATE INDEX IF NOT EXISTS idx_pursuit_decisions_intent_id ON pursuit_decisions(intent_id);
    CREATE INDEX IF NOT EXISTS idx_pursuit_decisions_user_id ON pursuit_decisions(user_id);
    CREATE INDEX IF NOT EXISTS idx_pursuit_decisions_decision ON pursuit_decisions(decision);
    CREATE INDEX IF NOT EXISTS idx_response_workspace_items_intent_id ON response_workspace_items(intent_id);
    CREATE INDEX IF NOT EXISTS idx_response_workspace_items_user_id ON response_workspace_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_response_workspace_items_status ON response_workspace_items(status);
    CREATE INDEX IF NOT EXISTS idx_response_workspace_comments_intent_id ON response_workspace_comments(intent_id);
    CREATE INDEX IF NOT EXISTS idx_response_workspace_comments_item_id ON response_workspace_comments(item_id);
    CREATE INDEX IF NOT EXISTS idx_response_workspace_comments_author_user_id ON response_workspace_comments(author_user_id);
    CREATE INDEX IF NOT EXISTS idx_response_workspace_activity_intent_id ON response_workspace_activity(intent_id);
    CREATE INDEX IF NOT EXISTS idx_response_workspace_activity_item_id ON response_workspace_activity(item_id);
    CREATE INDEX IF NOT EXISTS idx_response_workspace_activity_actor_user_id ON response_workspace_activity(actor_user_id);
    CREATE INDEX IF NOT EXISTS idx_response_package_snapshots_intent_id ON response_package_snapshots(intent_id);
    CREATE INDEX IF NOT EXISTS idx_response_package_snapshots_user_id ON response_package_snapshots(user_id);
    CREATE INDEX IF NOT EXISTS idx_response_package_snapshots_created_by_user_id ON response_package_snapshots(created_by_user_id);
    CREATE INDEX IF NOT EXISTS idx_response_package_exports_intent_id ON response_package_exports(intent_id);
    CREATE INDEX IF NOT EXISTS idx_response_package_exports_snapshot_id ON response_package_exports(snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_response_package_exports_user_id ON response_package_exports(user_id);
    CREATE INDEX IF NOT EXISTS idx_response_package_export_review_events_export_id ON response_package_export_review_events(export_id);
    CREATE INDEX IF NOT EXISTS idx_response_package_export_review_events_intent_id ON response_package_export_review_events(intent_id);
    CREATE INDEX IF NOT EXISTS idx_response_package_export_review_events_user_id ON response_package_export_review_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_response_package_export_review_events_actor_user_id ON response_package_export_review_events(actor_user_id);
    CREATE INDEX IF NOT EXISTS idx_response_package_export_review_events_created_at ON response_package_export_review_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_supplier_artifacts_intent_id ON supplier_artifacts(intent_id);
    CREATE INDEX IF NOT EXISTS idx_supplier_artifacts_user_id ON supplier_artifacts(user_id);
    CREATE INDEX IF NOT EXISTS idx_supplier_artifacts_bid_id ON supplier_artifacts(bid_id);
    CREATE INDEX IF NOT EXISTS idx_supplier_artifacts_review_status ON supplier_artifacts(review_status);
    CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact_id ON artifact_versions(artifact_id);
    CREATE INDEX IF NOT EXISTS idx_artifact_versions_intent_id ON artifact_versions(intent_id);
    CREATE INDEX IF NOT EXISTS idx_artifact_versions_user_id ON artifact_versions(user_id);
    CREATE INDEX IF NOT EXISTS idx_artifact_versions_created_at ON artifact_versions(created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_artifact_versions_artifact_version ON artifact_versions(artifact_id, version_number);
    CREATE INDEX IF NOT EXISTS idx_response_workspace_item_artifacts_artifact_id ON response_workspace_item_artifacts(artifact_id);
    CREATE INDEX IF NOT EXISTS idx_sourcing_partners_organization_id ON sourcing_partners(organization_id);
    CREATE INDEX IF NOT EXISTS idx_sourcing_partners_created_by_user_id ON sourcing_partners(created_by_user_id);
    CREATE INDEX IF NOT EXISTS idx_sourcing_partners_status ON sourcing_partners(status);
    CREATE INDEX IF NOT EXISTS idx_quote_requests_organization_id ON quote_requests(organization_id);
    CREATE INDEX IF NOT EXISTS idx_quote_requests_intent_id ON quote_requests(intent_id);
    CREATE INDEX IF NOT EXISTS idx_quote_requests_bid_id ON quote_requests(bid_id);
    CREATE INDEX IF NOT EXISTS idx_quote_requests_partner_id ON quote_requests(partner_id);
    CREATE INDEX IF NOT EXISTS idx_quote_requests_status ON quote_requests(status);
    CREATE INDEX IF NOT EXISTS idx_quote_request_artifacts_artifact_id ON quote_request_artifacts(artifact_id);
    CREATE INDEX IF NOT EXISTS idx_deadline_reminders_organization_id ON deadline_reminders(organization_id);
    CREATE INDEX IF NOT EXISTS idx_deadline_reminders_intent_id ON deadline_reminders(intent_id);
    CREATE INDEX IF NOT EXISTS idx_deadline_reminders_user_id ON deadline_reminders(user_id);
    CREATE INDEX IF NOT EXISTS idx_deadline_reminders_status ON deadline_reminders(status);
    CREATE INDEX IF NOT EXISTS idx_deadline_reminders_due_at ON deadline_reminders(due_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_deadline_reminders_dedupe_key ON deadline_reminders(dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts(user_id);
    CREATE INDEX IF NOT EXISTS idx_crawler_logs_source_started ON crawler_logs(source, started_at);
    CREATE INDEX IF NOT EXISTS idx_crawler_logs_run_id ON crawler_logs(run_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_outbox_dedupe_key ON notification_outbox(dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_notification_outbox_status_created ON notification_outbox(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_notification_outbox_alert_id ON notification_outbox(alert_id);
    CREATE INDEX IF NOT EXISTS idx_notification_outbox_user_id ON notification_outbox(user_id);
    CREATE INDEX IF NOT EXISTS idx_search_alert_digest_runs_alert_created ON search_alert_digest_runs(alert_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_search_alert_digest_runs_user_created ON search_alert_digest_runs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_risk_check_snapshots_checked_at ON risk_check_snapshots(checked_at);
    CREATE INDEX IF NOT EXISTS idx_risk_check_snapshots_created_at ON risk_check_snapshots(created_at);
    CREATE INDEX IF NOT EXISTS idx_source_health_snapshots_checked_at ON source_health_snapshots(checked_at);
    CREATE INDEX IF NOT EXISTS idx_source_health_snapshots_created_at ON source_health_snapshots(created_at);
    CREATE INDEX IF NOT EXISTS idx_source_compliance_snapshots_checked_at ON source_compliance_snapshots(checked_at);
    CREATE INDEX IF NOT EXISTS idx_source_compliance_snapshots_created_at ON source_compliance_snapshots(created_at);
    CREATE INDEX IF NOT EXISTS idx_source_approval_events_source_created ON source_approval_events(source_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_source_approval_events_actor_created ON source_approval_events(actor_user_id, created_at);
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

  const submissionPathColumns = new Set(
    sqlite
      .prepare("PRAGMA table_info(submission_paths)")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  if (!submissionPathColumns.has("status")) {
    sqlite.exec("ALTER TABLE submission_paths ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'");
  }

  const submissionConfirmationColumns = new Set(
    sqlite
      .prepare("PRAGMA table_info(submission_confirmations)")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  if (!submissionConfirmationColumns.has("evidence_snapshot_json")) {
    sqlite.exec("ALTER TABLE submission_confirmations ADD COLUMN evidence_snapshot_json TEXT NOT NULL DEFAULT '{}'");
  }

  const responseWorkspaceItemColumns = new Set(
    sqlite
      .prepare("PRAGMA table_info(response_workspace_items)")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  if (!responseWorkspaceItemColumns.has("assigned_user_id")) {
    sqlite.exec("ALTER TABLE response_workspace_items ADD COLUMN assigned_user_id TEXT REFERENCES users(id) ON DELETE SET NULL");
  }
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_response_workspace_items_assigned_user_id ON response_workspace_items(assigned_user_id)");

  const responsePackageExportColumns = new Set(
    sqlite
      .prepare("PRAGMA table_info(response_package_exports)")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  const addResponsePackageExportColumn = (name: string, definition: string) => {
    if (!responsePackageExportColumns.has(name)) {
      sqlite.exec(`ALTER TABLE response_package_exports ADD COLUMN ${name} ${definition}`);
    }
  };

  addResponsePackageExportColumn("format", "TEXT NOT NULL DEFAULT 'markdown'");
  addResponsePackageExportColumn("review_status", "TEXT NOT NULL DEFAULT 'pending_review'");
  addResponsePackageExportColumn("reviewed_at", "TEXT");
  addResponsePackageExportColumn("reviewed_by_user_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");
  addResponsePackageExportColumn("review_notes", "TEXT NOT NULL DEFAULT ''");

  const supplierArtifactColumns = new Set(
    sqlite
      .prepare("PRAGMA table_info(supplier_artifacts)")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  const addSupplierArtifactColumn = (name: string, definition: string) => {
    if (!supplierArtifactColumns.has(name)) {
      sqlite.exec(`ALTER TABLE supplier_artifacts ADD COLUMN ${name} ${definition}`);
    }
  };

  addSupplierArtifactColumn("deleted_at", "TEXT");
  addSupplierArtifactColumn("deleted_by_user_id", "TEXT REFERENCES users(id) ON DELETE SET NULL");

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
  addDataSourceColumn("approved_for_ingestion", "INTEGER");
  addDataSourceColumn("approval_status", "TEXT");
  addDataSourceColumn("access_pattern", "TEXT");
  addDataSourceColumn("legal_review_status", "TEXT");
  addDataSourceColumn("source_owner", "TEXT");
  addDataSourceColumn("approval_notes", "TEXT");
  addDataSourceColumn("last_approval_reviewed_at", "TEXT");
  addDataSourceColumn("live_health_owner", "TEXT");
  addDataSourceColumn("live_health_disposition", "TEXT");
  addDataSourceColumn("live_health_next_review_at", "TEXT");
  addDataSourceColumn("live_health_notes", "TEXT");
  addDataSourceColumn("live_health_reviewed_at", "TEXT");
  addDataSourceColumn("robots_txt_status", "TEXT");
  addDataSourceColumn("robots_txt_checked_at", "TEXT");
  addDataSourceColumn("robots_txt_hash", "TEXT");
  addDataSourceColumn("robots_txt_disallows_crawled_paths", "INTEGER");
  addDataSourceColumn("robots_txt_flag_reason", "TEXT");
  addDataSourceColumn("tos_reviewed", "INTEGER");
  addDataSourceColumn("tos_reviewed_at", "TEXT");
  addDataSourceColumn("tos_url", "TEXT");
  addDataSourceColumn("compliance_reviewer", "TEXT");
  addDataSourceColumn("legal_opinion_reference", "TEXT");
  addDataSourceColumn("compliance_review_due_at", "TEXT");
  addDataSourceColumn("compliance_notes", "TEXT");
}
