import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email"),
    passwordHash: text("password_hash"),
    displayName: text("display_name"),
    role: text("role").notNull().default("user"),
    accountTier: text("account_tier").notNull().default("free"),
    isDisabled: integer("is_disabled").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    lastLoginAt: text("last_login_at"),
  },
  (table) => ({
    emailIdx: uniqueIndex("idx_users_email").on(table.email),
  }),
);

export const adminUserAuditLogs = sqliteTable(
  "admin_user_audit_logs",
  {
    id: text("id").primaryKey(),
    actorKind: text("actor_kind").notNull(),
    actorUserId: text("actor_user_id"),
    targetUserId: text("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    changesJson: text("changes_json").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    actorIdx: index("idx_admin_user_audit_actor").on(table.actorUserId),
    targetIdx: index("idx_admin_user_audit_target").on(table.targetUserId),
    createdIdx: index("idx_admin_user_audit_created").on(table.createdAt),
  }),
);

export const accountSubscriptions = sqliteTable(
  "account_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tier: text("tier").notNull().default("free"),
    status: text("status").notNull().default("none"),
    source: text("source").notNull().default("admin_override"),
    provider: text("provider"),
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    currentPeriodEnd: text("current_period_end"),
    cancelAtPeriodEnd: integer("cancel_at_period_end").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    userIdx: uniqueIndex("idx_account_subscriptions_user_id").on(table.userId),
    providerSubscriptionIdx: index("idx_account_subscriptions_provider_subscription").on(table.providerSubscriptionId),
  }),
);

export const billingCheckoutSessions = sqliteTable(
  "billing_checkout_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tier: text("tier").notNull(),
    status: text("status").notNull().default("open"),
    provider: text("provider").notNull().default("local_checkout"),
    providerSessionId: text("provider_session_id").notNull(),
    checkoutUrl: text("checkout_url").notNull(),
    expiresAt: text("expires_at").notNull(),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    userIdx: index("idx_billing_checkout_sessions_user_id").on(table.userId),
    providerSessionIdx: uniqueIndex("idx_billing_checkout_sessions_provider_session_id").on(table.providerSessionId),
  }),
);

export const billingInvoices = sqliteTable(
  "billing_invoices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("billing_provider"),
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    providerInvoiceId: text("provider_invoice_id").notNull(),
    invoiceNumber: text("invoice_number"),
    status: text("status").notNull(),
    currency: text("currency").notNull().default("USD"),
    amountDueCents: integer("amount_due_cents").notNull().default(0),
    amountPaidCents: integer("amount_paid_cents").notNull().default(0),
    invoiceUrl: text("invoice_url"),
    invoicePdfUrl: text("invoice_pdf_url"),
    dueAt: text("due_at"),
    paidAt: text("paid_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    userIdx: index("idx_billing_invoices_user_id").on(table.userId),
    providerInvoiceIdx: uniqueIndex("idx_billing_invoices_provider_invoice_id").on(table.providerInvoiceId),
    subscriptionIdx: index("idx_billing_invoices_provider_subscription_id").on(table.providerSubscriptionId),
  }),
);

export const subscriptionEvents = sqliteTable(
  "subscription_events",
  {
    id: text("id").primaryKey(),
    providerEventId: text("provider_event_id"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subscriptionId: text("subscription_id").references(() => accountSubscriptions.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    fromTier: text("from_tier"),
    toTier: text("to_tier"),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    source: text("source").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    providerEventIdx: uniqueIndex("idx_subscription_events_provider_event_id").on(table.providerEventId),
    userIdx: index("idx_subscription_events_user_id").on(table.userId),
    subscriptionIdx: index("idx_subscription_events_subscription_id").on(table.subscriptionId),
    createdIdx: index("idx_subscription_events_created").on(table.createdAt),
  }),
);

export const creditBalances = sqliteTable(
  "credit_balances",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    includedCreditsRemaining: integer("included_credits_remaining"),
    purchasedCreditsRemaining: integer("purchased_credits_remaining").notNull().default(0),
    periodStart: text("period_start"),
    periodEnd: text("period_end"),
    updatedAt: text("updated_at").notNull(),
  },
);

export const creditUsageEvents = sqliteTable(
  "credit_usage_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    featureKey: text("feature_key").notNull(),
    eventType: text("event_type").notNull(),
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    organizationIdx: index("idx_credit_usage_events_organization_id").on(table.organizationId),
    userIdx: index("idx_credit_usage_events_user_id").on(table.userId),
    featureIdx: index("idx_credit_usage_events_feature_key").on(table.featureKey),
    createdIdx: index("idx_credit_usage_events_created_at").on(table.createdAt),
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

export const passwordResetTokens = sqliteTable(
  "password_reset_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex("idx_password_reset_tokens_token_hash").on(table.tokenHash),
    userIdx: index("idx_password_reset_tokens_user_id").on(table.userId),
  }),
);

export const userNotificationPreferences = sqliteTable("user_notification_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  savedSearchAlertsEnabled: integer("saved_search_alerts_enabled").notNull().default(1),
  defaultAlertFrequency: text("default_alert_frequency", { enum: ["daily", "weekly"] }).notNull().default("daily"),
  marketingUpdatesEnabled: integer("marketing_updates_enabled").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const workspaceInvitations = sqliteTable(
  "workspace_invitations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    invitedUserId: text("invited_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    acceptedAt: text("accepted_at"),
    revokedAt: text("revoked_at"),
    lastSentAt: text("last_sent_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex("idx_workspace_invitations_token_hash").on(table.tokenHash),
    organizationIdx: index("idx_workspace_invitations_organization_id").on(table.organizationId),
    invitedUserIdx: index("idx_workspace_invitations_invited_user_id").on(table.invitedUserId),
    emailIdx: index("idx_workspace_invitations_email").on(table.email),
  }),
);

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  accountTier: text("account_tier").notNull().default("free"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const organizationFeatureOverrides = sqliteTable(
  "organization_feature_overrides",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    featureKey: text("feature_key").notNull(),
    isEnabled: integer("is_enabled").notNull(),
    reason: text("reason"),
    expiresAt: text("expires_at"),
    createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.organizationId, table.featureKey] }),
    organizationIdx: index("idx_organization_feature_overrides_org").on(table.organizationId),
    featureIdx: index("idx_organization_feature_overrides_feature").on(table.featureKey),
  }),
);

export const organizationMemberships = sqliteTable(
  "organization_memberships",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.organizationId, table.userId] }),
    userIdx: index("idx_organization_memberships_user_id").on(table.userId),
    organizationIdx: index("idx_organization_memberships_organization_id").on(table.organizationId),
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
    sourceConfidence: text("source_confidence").notNull().default("medium"),
    qualityFlagsJson: text("quality_flags_json").notNull().default("[]"),
    adminReviewStatus: text("admin_review_status").notNull().default("unreviewed"),
    adminReviewNote: text("admin_review_note"),
    adminReviewedAt: text("admin_reviewed_at"),
    adminReviewedBy: text("admin_reviewed_by"),
    displayStatus: text("display_status").notNull().default("published"),
    detailArchiveStatus: text("detail_archive_status").notNull().default("not_archived"),
    detailArchivePath: text("detail_archive_path"),
    detailFetchedAt: text("detail_fetched_at"),
    detailChecksumSha256: text("detail_checksum_sha256"),
    detailArchiveError: text("detail_archive_error"),
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

export const bidFieldCorrections = sqliteTable(
  "bid_field_corrections",
  {
    id: text("id").primaryKey(),
    bidId: text("bid_id")
      .notNull()
      .references(() => bids.id, { onDelete: "cascade" }),
    fieldName: text("field_name").notNull(),
    originalValue: text("original_value"),
    correctedValue: text("corrected_value"),
    note: text("note"),
    correctedBy: text("corrected_by").notNull(),
    correctedAt: text("corrected_at").notNull(),
  },
  (table) => ({
    bidIdx: index("idx_bid_field_corrections_bid_id").on(table.bidId),
    fieldIdx: index("idx_bid_field_corrections_field_name").on(table.fieldName),
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
    originalUrl: text("original_url"),
    storagePath: text("storage_path"),
    byteSize: integer("byte_size"),
    contentType: text("content_type"),
    checksumSha256: text("checksum_sha256"),
    fetchedAt: text("fetched_at"),
    archiveStatus: text("archive_status").notNull().default("not_archived"),
    archiveError: text("archive_error"),
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

export const supplierProfiles = sqliteTable("supplier_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  companyName: text("company_name").notNull().default(""),
  businessTypes: text("business_types").notNull().default("[]"),
  categories: text("categories").notNull().default("[]"),
  keywords: text("keywords").notNull().default("[]"),
  certifications: text("certifications").notNull().default("[]"),
  serviceStates: text("service_states").notNull().default("[]"),
  minContractValue: integer("min_contract_value"),
  maxContractValue: integer("max_contract_value"),
  riskPreferences: text("risk_preferences").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const intentToBid = sqliteTable(
  "intent_to_bid",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bidId: text("bid_id")
      .notNull()
      .references(() => bids.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("intent_added"),
    aiBidBrief: text("ai_bid_brief").notNull().default(""),
    keyDatesJson: text("key_dates_json").notNull().default("{}"),
    initialChecklistJson: text("initial_checklist_json").notNull().default("[]"),
    riskFlagsJson: text("risk_flags_json").notNull().default("[]"),
    matchScoreSnapshotJson: text("match_score_snapshot_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    userBidIdx: uniqueIndex("idx_intent_to_bid_user_bid").on(table.userId, table.bidId),
    userIdx: index("idx_intent_to_bid_user_id").on(table.userId),
    bidIdx: index("idx_intent_to_bid_bid_id").on(table.bidId),
  }),
);

export const submissionPaths = sqliteTable(
  "submission_paths",
  {
    id: text("id").primaryKey(),
    intentId: text("intent_id")
      .notNull()
      .references(() => intentToBid.id, { onDelete: "cascade" }),
    bidId: text("bid_id")
      .notNull()
      .references(() => bids.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    method: text("method").notNull().default("unknown"),
    portalUrl: text("portal_url").notNull().default(""),
    contactEmail: text("contact_email").notNull().default(""),
    requiresRegistration: integer("requires_registration").notNull().default(0),
    requiresPhysicalDelivery: integer("requires_physical_delivery").notNull().default(0),
    requiresAddendaAcknowledgement: integer("requires_addenda_acknowledgement").notNull().default(0),
    complexityScore: integer("complexity_score").notNull().default(0),
    guidanceText: text("guidance_text").notNull().default(""),
    readinessChecklistJson: text("readiness_checklist_json").notNull().default("[]"),
    riskFlagsJson: text("risk_flags_json").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    intentIdx: uniqueIndex("idx_submission_paths_intent_id").on(table.intentId),
    userIdx: index("idx_submission_paths_user_id").on(table.userId),
    bidIdx: index("idx_submission_paths_bid_id").on(table.bidId),
  }),
);

export const submissionConfirmations = sqliteTable(
  "submission_confirmations",
  {
    id: text("id").primaryKey(),
    intentId: text("intent_id")
      .notNull()
      .references(() => intentToBid.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    submittedAt: text("submitted_at").notNull(),
    method: text("method").notNull(),
    confirmationReference: text("confirmation_reference").notNull().default(""),
    confirmationNotes: text("confirmation_notes").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    intentIdx: index("idx_submission_confirmations_intent_id").on(table.intentId),
    userIdx: index("idx_submission_confirmations_user_id").on(table.userId),
  }),
);

export const complianceManifestItems = sqliteTable(
  "compliance_manifest_items",
  {
    id: text("id").primaryKey(),
    intentId: text("intent_id")
      .notNull()
      .references(() => intentToBid.id, { onDelete: "cascade" }),
    bidId: text("bid_id")
      .notNull()
      .references(() => bids.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: text("category").notNull(),
    status: text("status").notNull().default("not_started"),
    evidenceStatus: text("evidence_status").notNull().default("needed"),
    notes: text("notes").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    intentIdx: index("idx_compliance_manifest_items_intent_id").on(table.intentId),
    userIdx: index("idx_compliance_manifest_items_user_id").on(table.userId),
    statusIdx: index("idx_compliance_manifest_items_status").on(table.status),
  }),
);

export const pursuitDecisions = sqliteTable(
  "pursuit_decisions",
  {
    id: text("id").primaryKey(),
    intentId: text("intent_id")
      .notNull()
      .references(() => intentToBid.id, { onDelete: "cascade" }),
    bidId: text("bid_id")
      .notNull()
      .references(() => bids.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    decision: text("decision").notNull(),
    reasonsJson: text("reasons_json").notNull().default("[]"),
    notes: text("notes").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    intentIdx: index("idx_pursuit_decisions_intent_id").on(table.intentId),
    userIdx: index("idx_pursuit_decisions_user_id").on(table.userId),
    decisionIdx: index("idx_pursuit_decisions_decision").on(table.decision),
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
    frequency: text("frequency", { enum: ["daily", "weekly"] }).notNull().default("daily"),
    notificationChannel: text("notification_channel", { enum: ["email"] }).notNull().default("email"),
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

export const crawlerLocks = sqliteTable("crawler_locks", {
  source: text("source").primaryKey(),
  owner: text("owner").notNull(),
  acquiredAt: text("acquired_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const notificationOutbox = sqliteTable(
  "notification_outbox",
  {
    id: text("id").primaryKey(),
    alertId: text("alert_id").notNull(),
    userId: text("user_id").notNull(),
    channel: text("channel", { enum: ["email"] }).notNull(),
    recipient: text("recipient").notNull(),
    frequency: text("frequency", { enum: ["daily", "weekly"] }).notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    matchedBidIds: text("matched_bid_ids").notNull(),
    status: text("status", { enum: ["pending", "sent", "failed"] }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    sentAt: text("sent_at"),
  },
  (table) => ({
    dedupeIdx: uniqueIndex("idx_notification_outbox_dedupe_key").on(table.dedupeKey),
    statusCreatedIdx: index("idx_notification_outbox_status_created").on(table.status, table.createdAt),
    alertIdx: index("idx_notification_outbox_alert_id").on(table.alertId),
    userIdx: index("idx_notification_outbox_user_id").on(table.userId),
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
  providerFamily: text("provider_family"),
  accessMode: text("access_mode"),
  sourceType: text("source_type"),
  sourceConfidence: text("source_confidence"),
  activationStatus: text("activation_status"),
  requiresBrowser: integer("requires_browser"),
  requiresManual: integer("requires_manual"),
  requiresLogin: integer("requires_login"),
  supportsQuery: integer("supports_query"),
  supportsPagination: integer("supports_pagination"),
  supportsAttachmentMetadata: integer("supports_attachment_metadata"),
  supportsDetailPageFetch: integer("supports_detail_page_fetch"),
  fallbackNotes: text("fallback_notes"),
  lastSuccessAt: text("last_success_at"),
  lastFailureAt: text("last_failure_at"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
