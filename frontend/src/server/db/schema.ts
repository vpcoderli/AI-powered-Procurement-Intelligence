import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email"),
    passwordHash: text("password_hash"),
    displayName: text("display_name"),
    role: text("role").notNull().default("user"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    lastLoginAt: text("last_login_at"),
  },
  (table) => ({
    emailIdx: uniqueIndex("idx_users_email").on(table.email),
  }),
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex("idx_sessions_token_hash").on(table.tokenHash),
    userIdx: index("idx_sessions_user_id").on(table.userId),
  }),
);

export const bids = sqliteTable(
  "bids",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    sourceBidId: text("source_bid_id"),
    dedupeKey: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    fullDescription: text("full_description"),
    originalCategory: text("original_category"),
    amount: text("amount"),
    amountMin: integer("amount_min"),
    amountMax: integer("amount_max"),
    currency: text("currency").notNull().default("USD"),
    publishedDate: text("published_date"),
    deadlineDate: text("deadline_date"),
    issuerName: text("issuer_name").notNull(),
    issuerType: text("issuer_type").notNull(),
    stateCode: text("state_code").notNull(),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    sourceUrl: text("source_url").notNull(),
    isActive: integer("is_active").notNull().default(1),
    rawPayload: text("raw_payload"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    dedupeIdx: uniqueIndex("idx_bids_dedupe_key").on(table.dedupeKey),
    sourceBidIdx: uniqueIndex("idx_bids_source_source_bid_id").on(table.source, table.sourceBidId),
    activeDeadlineIdx: index("idx_bids_active_deadline").on(table.isActive, table.deadlineDate),
    publishedIdx: index("idx_bids_published_date").on(table.publishedDate),
    stateIdx: index("idx_bids_state_code").on(table.stateCode),
    issuerTypeIdx: index("idx_bids_issuer_type").on(table.issuerType),
    sourceIdx: index("idx_bids_source").on(table.source),
  }),
);

export const bidAttachments = sqliteTable(
  "bid_attachments",
  {
    id: text("id").primaryKey(),
    bidId: text("bid_id")
      .notNull()
      .references(() => bids.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    sizeLabel: text("size_label"),
    mimeType: text("mime_type"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    bidIdx: index("idx_bid_attachments_bid_id").on(table.bidId),
  }),
);

export const savedBids = sqliteTable(
  "saved_bids",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bidId: text("bid_id")
      .notNull()
      .references(() => bids.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.bidId] }),
    bidIdx: index("idx_saved_bids_bid_id").on(table.bidId),
  }),
);

export const alerts = sqliteTable(
  "alerts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    query: text("query"),
    states: text("states"),
    issuerType: text("issuer_type"),
    deadlinePreset: text("deadline_preset"),
    publishedPreset: text("published_preset"),
    frequency: text("frequency").notNull().default("daily"),
    notificationChannel: text("notification_channel").notNull().default("email"),
    isEnabled: integer("is_enabled").notNull().default(1),
    lastMatchedAt: text("last_matched_at"),
    lastNotifiedAt: text("last_notified_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    userIdx: index("idx_alerts_user_id").on(table.userId),
  }),
);

export const crawlerLogs = sqliteTable(
  "crawler_logs",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    runId: text("run_id").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    durationMs: integer("duration_ms"),
    fetchedCount: integer("fetched_count").notNull().default(0),
    insertedCount: integer("inserted_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    errorStack: text("error_stack"),
    metadata: text("metadata"),
  },
  (table) => ({
    sourceStartedIdx: index("idx_crawler_logs_source_started").on(table.source, table.startedAt),
    runIdx: index("idx_crawler_logs_run_id").on(table.runId),
  }),
);

export const dataSources = sqliteTable("data_sources", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  issuerType: text("issuer_type").notNull(),
  stateCode: text("state_code").notNull(),
  baseUrl: text("base_url"),
  isEnabled: integer("is_enabled").notNull().default(1),
  cadence: text("cadence").notNull().default("daily"),
  lastSuccessAt: text("last_success_at"),
  lastFailureAt: text("last_failure_at"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
