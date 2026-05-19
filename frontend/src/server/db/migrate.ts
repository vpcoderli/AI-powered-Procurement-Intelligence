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
      size_label TEXT,
      mime_type TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved_bids (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, bid_id)
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

    CREATE TABLE IF NOT EXISTS data_sources (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      issuer_type TEXT NOT NULL,
      state_code TEXT NOT NULL,
      base_url TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      cadence TEXT NOT NULL DEFAULT 'daily',
      last_success_at TEXT,
      last_failure_at TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_dedupe_key ON bids(dedupe_key);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_source_source_bid_id ON bids(source, source_bid_id);
    CREATE INDEX IF NOT EXISTS idx_bids_active_deadline ON bids(is_active, deadline_date);
    CREATE INDEX IF NOT EXISTS idx_bids_published_date ON bids(published_date);
    CREATE INDEX IF NOT EXISTS idx_bids_state_code ON bids(state_code);
    CREATE INDEX IF NOT EXISTS idx_bids_issuer_type ON bids(issuer_type);
    CREATE INDEX IF NOT EXISTS idx_bids_source ON bids(source);
    CREATE INDEX IF NOT EXISTS idx_bid_attachments_bid_id ON bid_attachments(bid_id);
    CREATE INDEX IF NOT EXISTS idx_saved_bids_bid_id ON saved_bids(bid_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts(user_id);
    CREATE INDEX IF NOT EXISTS idx_crawler_logs_source_started ON crawler_logs(source, started_at);
    CREATE INDEX IF NOT EXISTS idx_crawler_logs_run_id ON crawler_logs(run_id);
  `);
}
