import { randomUUID } from "node:crypto";
import { and, desc, eq, or } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { accountSubscriptions, billingCheckoutSessions, billingInvoices, subscriptionEvents, users } from "@/server/db/schema";
import { syncOwnedWorkspaceTier } from "@/server/account/workspace";
import {
  isAccountTier,
  ACCOUNT_TIER_LABELS,
  PRODUCT_PLAN_LABELS,
  normalizeAccountTier,
  type AccountTier,
  type ProductPlanKey,
} from "@/server/auth/entitlements";
import { creditAllowanceForTier } from "@/server/billing/credits";
import { InvalidSubscriptionInputError } from "./errors";
import {
  createConfiguredBillingProvider,
  stripePriceIdForTier,
  type BillingProviderAdapter,
} from "./providers";
import { enqueueNotification } from "@/server/notifications/outbox-repository";

export { InvalidSubscriptionInputError } from "./errors";

export const SUBSCRIPTION_STATUSES = ["none", "trialing", "active", "past_due", "canceled"] as const;
export const SUBSCRIPTION_SOURCES = ["admin_override", "local_checkout", "billing_provider"] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export type SubscriptionSource = (typeof SUBSCRIPTION_SOURCES)[number];

export interface SubscriptionPlan {
  tier: AccountTier | null;
  productPlanKey: ProductPlanKey;
  label: string;
  priceMonthlyUsd: number | null;
  includedMonthlyCredits: number | null;
  isAvailable: boolean;
  isSelfServe: boolean;
  featureHighlights: string[];
}

export interface AccountSubscriptionView {
  userId: string;
  tier: AccountTier;
  status: SubscriptionStatus;
  source: SubscriptionSource;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface AccountSubscriptionResponse {
  subscription: AccountSubscriptionView;
  plans: SubscriptionPlan[];
}

export interface CheckoutSessionView {
  id: string;
  userId: string;
  tier: AccountTier;
  status: "open" | "completed" | "expired" | "canceled";
  provider: "local_checkout" | "billing_provider";
  providerSessionId: string;
  checkoutUrl: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutSessionResponse {
  checkoutSession: CheckoutSessionView;
}

export interface CustomerPortalSessionView {
  userId: string;
  provider: "local_checkout" | "billing_provider";
  portalUrl: string;
  returnUrl: string;
  createdAt: string;
}

export interface CustomerPortalSessionResponse {
  portalSession: CustomerPortalSessionView;
}

export type BillingInvoiceStatus = "open" | "paid" | "payment_failed" | "void" | "uncollectible";
export const BILLING_INVOICE_STATUSES: BillingInvoiceStatus[] = [
  "open",
  "paid",
  "payment_failed",
  "void",
  "uncollectible",
];

export interface BillingInvoiceView {
  id: string;
  userId: string;
  provider: string;
  providerInvoiceId: string;
  invoiceNumber: string | null;
  status: BillingInvoiceStatus;
  currency: string;
  amountDueCents: number;
  amountPaidCents: number;
  invoiceUrl: string | null;
  invoicePdfUrl: string | null;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BillingInvoicesResponse {
  invoices: BillingInvoiceView[];
  summary: {
    totalInvoices: number;
    paidCount: number;
    failedCount: number;
    openCount: number;
    totalPaidCents: number;
    totalDueCents: number;
    downloadablePdfCount: number;
  };
}

export interface ListAccountInvoicesOptions {
  status?: BillingInvoiceStatus;
}

export interface SubscriptionLifecycleReconcileResult {
  checked: number;
  canceledAtPeriodEnd: number;
  markedPastDue: number;
  downgradedPastDue: number;
  expiredTrials: number;
}

export interface SubscriptionLifecycleReconcileOptions {
  now?: string;
  pastDueGraceDays?: number;
}

export interface UpsertAccountSubscriptionInput {
  tier: AccountTier;
  status: SubscriptionStatus;
  source: Exclude<SubscriptionSource, "admin_override">;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  provider?: string | null;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateCheckoutSessionInput {
  tier: AccountTier;
  origin?: string;
  providerAdapter?: BillingProviderAdapter | null;
}

export interface CreateCustomerPortalSessionInput {
  origin?: string;
  providerAdapter?: BillingProviderAdapter | null;
}

export interface BillingProviderEvent {
  id: string;
  type:
    | "checkout.completed"
    | "subscription.updated"
    | "subscription.deleted"
    | "invoice.paid"
    | "invoice.payment_failed";
  provider?: string;
  userId?: string;
  email?: string;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  providerSessionId?: string | null;
  tier?: AccountTier;
  status?: SubscriptionStatus;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  providerInvoiceId?: string | null;
  invoiceNumber?: string | null;
  invoiceUrl?: string | null;
  invoicePdfUrl?: string | null;
  amountDueCents?: number | null;
  amountPaidCents?: number | null;
  currency?: string | null;
  dueAt?: string | null;
  paidAt?: string | null;
  metadata?: Record<string, unknown>;
}

const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    tier: "free",
    productPlanKey: "free",
    label: ACCOUNT_TIER_LABELS.free,
    priceMonthlyUsd: 0,
    includedMonthlyCredits: creditAllowanceForTier("free"),
    isAvailable: true,
    isSelfServe: false,
    featureHighlights: ["Search public bids", "Save opportunities", "Build a supplier profile"],
  },
  {
    tier: "pro",
    productPlanKey: "pursuit_starter",
    label: ACCOUNT_TIER_LABELS.pro,
    priceMonthlyUsd: 79,
    includedMonthlyCredits: creditAllowanceForTier("pro"),
    isAvailable: true,
    isSelfServe: true,
    featureHighlights: ["Submission guidance", "Pursue / no-bid workflow", "Full match explanations"],
  },
  {
    tier: "business",
    productPlanKey: "response_builder",
    label: ACCOUNT_TIER_LABELS.business,
    priceMonthlyUsd: 249,
    includedMonthlyCredits: creditAllowanceForTier("business"),
    isAvailable: true,
    isSelfServe: true,
    featureHighlights: ["Compliance manifest", "Response workspace foundation", "Team-ready bid workflow"],
  },
  {
    tier: null,
    productPlanKey: "growth",
    label: PRODUCT_PLAN_LABELS.growth,
    priceMonthlyUsd: null,
    includedMonthlyCredits: 300,
    isAvailable: false,
    isSelfServe: false,
    featureHighlights: ["Award tracking", "Tabulation analysis", "Buyer history and rebid learning"],
  },
  {
    tier: "enterprise",
    productPlanKey: "enterprise",
    label: ACCOUNT_TIER_LABELS.enterprise,
    priceMonthlyUsd: null,
    includedMonthlyCredits: creditAllowanceForTier("enterprise"),
    isAvailable: true,
    isSelfServe: false,
    featureHighlights: ["Knowledge Station", "Advanced intelligence", "Higher support limits"],
  },
];

function nowIso() {
  return new Date().toISOString();
}

function addHoursIso(timestamp: string, hours: number) {
  return new Date(new Date(timestamp).getTime() + hours * 60 * 60 * 1000).toISOString();
}

function originOrEmpty(origin?: string) {
  return origin?.replace(/\/$/, "") ?? "";
}

function settingsReturnUrl(origin?: string) {
  const normalizedOrigin = originOrEmpty(origin);
  return normalizedOrigin ? `${normalizedOrigin}/settings` : "/settings";
}

function billingProviderName() {
  return process.env.BILLING_PROVIDER?.trim() || "local";
}

function formatProviderUrlTemplate(template: string, values: Record<string, string | null | undefined>) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) =>
    encodeURIComponent(values[key] ?? ""),
  );
}

function hostedCheckoutUrl(input: {
  checkoutSessionId: string;
  providerSessionId: string;
  tier: AccountTier;
  userId: string;
  origin?: string;
}) {
  const template = process.env.BILLING_CHECKOUT_URL_TEMPLATE?.trim();
  const returnUrl = settingsReturnUrl(input.origin);

  if (!template) {
    return `${returnUrl}?checkoutSession=${input.checkoutSessionId}`;
  }

  return formatProviderUrlTemplate(template, {
    providerSessionId: input.providerSessionId,
    checkoutSessionId: input.checkoutSessionId,
    tier: input.tier,
    userId: input.userId,
    successUrl: `${returnUrl}?checkoutSession=${input.checkoutSessionId}&checkout=success`,
    cancelUrl: `${returnUrl}?checkout=cancel`,
  });
}

function checkoutSuccessUrl(input: { checkoutSessionId: string; origin?: string }) {
  return `${settingsReturnUrl(input.origin)}?checkoutSession=${input.checkoutSessionId}&checkout=success`;
}

function checkoutCancelUrl(origin?: string) {
  return `${settingsReturnUrl(origin)}?checkout=cancel`;
}

function hostedCustomerPortalUrl(input: {
  userId: string;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  origin?: string;
}) {
  const template = process.env.BILLING_CUSTOMER_PORTAL_URL_TEMPLATE?.trim();
  const returnUrl = settingsReturnUrl(input.origin);

  if (!template) {
    return `${returnUrl}?billingPortal=local`;
  }

  if (!input.providerCustomerId) {
    throw new InvalidSubscriptionInputError("Provider customer id is required for hosted billing portal");
  }

  return formatProviderUrlTemplate(template, {
    userId: input.userId,
    providerCustomerId: input.providerCustomerId,
    providerSubscriptionId: input.providerSubscriptionId,
    returnUrl,
  });
}

function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return typeof value === "string" && SUBSCRIPTION_STATUSES.includes(value as SubscriptionStatus);
}

function normalizeSubscriptionStatus(value: unknown): SubscriptionStatus {
  return isSubscriptionStatus(value) ? value : "none";
}

function isSubscriptionSource(value: unknown): value is SubscriptionSource {
  return typeof value === "string" && SUBSCRIPTION_SOURCES.includes(value as SubscriptionSource);
}

function normalizeSubscriptionSource(value: unknown): SubscriptionSource {
  return isSubscriptionSource(value) ? value : "admin_override";
}

export function listSubscriptionPlans() {
  return SUBSCRIPTION_PLANS;
}

function getUserOrThrow(db: AppDatabase, userId: string) {
  const user = db.select().from(users).where(eq(users.id, userId)).limit(1).get();

  if (!user) {
    throw new InvalidSubscriptionInputError("User not found");
  }

  return user;
}

function writeSubscriptionEvent(
  db: AppDatabase,
  input: {
    userId: string;
    subscriptionId?: string | null;
    providerEventId?: string | null;
    eventType: string;
    fromTier?: AccountTier | null;
    toTier?: AccountTier | null;
    fromStatus?: SubscriptionStatus | null;
    toStatus?: SubscriptionStatus | null;
    source: SubscriptionSource;
    metadata?: Record<string, unknown>;
    createdAt?: string;
  },
) {
  db.insert(subscriptionEvents)
    .values({
      id: `subevt_${randomUUID()}`,
      providerEventId: input.providerEventId ?? null,
      userId: input.userId,
      subscriptionId: input.subscriptionId ?? null,
      eventType: input.eventType,
      fromTier: input.fromTier ?? null,
      toTier: input.toTier ?? null,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      source: input.source,
      metadataJson: JSON.stringify(input.metadata ?? {}),
      createdAt: input.createdAt ?? nowIso(),
    })
    .run();
}

function checkoutSessionFromRow(row: typeof billingCheckoutSessions.$inferSelect): CheckoutSessionView {
  return {
    id: row.id,
    userId: row.userId,
    tier: normalizeAccountTier(row.tier),
    status:
      row.status === "completed" || row.status === "expired" || row.status === "canceled"
        ? row.status
        : "open",
    provider: row.provider === "billing_provider" ? "billing_provider" : "local_checkout",
    providerSessionId: row.providerSessionId,
    checkoutUrl: row.checkoutUrl,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeInvoiceStatus(value: unknown): BillingInvoiceStatus {
  return value === "paid" ||
    value === "payment_failed" ||
    value === "void" ||
    value === "uncollectible"
    ? value
    : "open";
}

export function isBillingInvoiceStatus(value: unknown): value is BillingInvoiceStatus {
  return typeof value === "string" && BILLING_INVOICE_STATUSES.includes(value as BillingInvoiceStatus);
}

function invoiceFromRow(row: typeof billingInvoices.$inferSelect): BillingInvoiceView {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    providerInvoiceId: row.providerInvoiceId,
    invoiceNumber: row.invoiceNumber,
    status: normalizeInvoiceStatus(row.status),
    currency: row.currency,
    amountDueCents: row.amountDueCents,
    amountPaidCents: row.amountPaidCents,
    invoiceUrl: row.invoiceUrl,
    invoicePdfUrl: row.invoicePdfUrl,
    dueAt: row.dueAt,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function invoiceSummary(invoices: BillingInvoiceView[]): BillingInvoicesResponse["summary"] {
  return {
    totalInvoices: invoices.length,
    paidCount: invoices.filter((invoice) => invoice.status === "paid").length,
    failedCount: invoices.filter((invoice) => invoice.status === "payment_failed").length,
    openCount: invoices.filter((invoice) => invoice.status === "open").length,
    totalPaidCents: invoices.reduce((total, invoice) => total + invoice.amountPaidCents, 0),
    totalDueCents: invoices
      .filter((invoice) => invoice.status === "open" || invoice.status === "payment_failed")
      .reduce((total, invoice) => total + invoice.amountDueCents, 0),
    downloadablePdfCount: invoices.filter((invoice) => Boolean(invoice.invoicePdfUrl)).length,
  };
}

function existingSubscriptionForUser(db: AppDatabase, userId: string) {
  return db
    .select()
    .from(accountSubscriptions)
    .where(eq(accountSubscriptions.userId, userId))
    .limit(1)
    .get();
}

function subscriptionIsExpired(currentPeriodEnd: string | null, now: string) {
  if (!currentPeriodEnd) return false;

  return new Date(currentPeriodEnd).getTime() <= new Date(now).getTime();
}

function gracePeriodExpired(currentPeriodEnd: string | null, now: string, graceDays: number) {
  if (!currentPeriodEnd) return false;

  const graceEndsAt = new Date(currentPeriodEnd).getTime() + graceDays * 24 * 60 * 60 * 1000;
  return graceEndsAt <= new Date(now).getTime();
}

function transitionSubscriptionLifecycle(
  db: AppDatabase,
  row: typeof accountSubscriptions.$inferSelect,
  input: {
    tier: AccountTier;
    status: SubscriptionStatus;
    eventType: string;
    now: string;
    metadata?: Record<string, unknown>;
  },
) {
  const fromTier = normalizeAccountTier(row.tier);
  const fromStatus = normalizeSubscriptionStatus(row.status);
  const source = normalizeSubscriptionSource(row.source);

  db.update(accountSubscriptions)
    .set({
      tier: input.tier,
      status: input.status,
      cancelAtPeriodEnd: 0,
      updatedAt: input.now,
    })
    .where(eq(accountSubscriptions.id, row.id))
    .run();
  db.update(users)
    .set({
      accountTier: input.tier,
      updatedAt: input.now,
    })
    .where(eq(users.id, row.userId))
    .run();
  syncOwnedWorkspaceTier(db, row.userId, input.tier, input.now);
  writeSubscriptionEvent(db, {
    userId: row.userId,
    subscriptionId: row.id,
    eventType: input.eventType,
    fromTier,
    toTier: input.tier,
    fromStatus,
    toStatus: input.status,
    source,
    metadata: {
      providerSubscriptionId: row.providerSubscriptionId,
      currentPeriodEnd: row.currentPeriodEnd,
      ...input.metadata,
    },
    createdAt: input.now,
  });
}

function providerEventIsInvoice(event: BillingProviderEvent) {
  return event.type === "invoice.paid" || event.type === "invoice.payment_failed";
}

function invoiceStatusForProviderEvent(event: BillingProviderEvent): BillingInvoiceStatus {
  if (event.type === "invoice.paid") return "paid";
  if (event.type === "invoice.payment_failed") return "payment_failed";
  return "open";
}

function upsertBillingInvoice(db: AppDatabase, userId: string, event: BillingProviderEvent) {
  if (!providerEventIsInvoice(event)) return null;
  if (!event.providerInvoiceId) {
    throw new InvalidSubscriptionInputError("Invoice event must include providerInvoiceId");
  }

  const timestamp = nowIso();
  const existing = db
    .select()
    .from(billingInvoices)
    .where(eq(billingInvoices.providerInvoiceId, event.providerInvoiceId))
    .limit(1)
    .get();
  const invoiceValues = {
    userId,
    provider: event.provider ?? "billing_provider",
    providerCustomerId: event.providerCustomerId ?? null,
    providerSubscriptionId: event.providerSubscriptionId ?? null,
    providerInvoiceId: event.providerInvoiceId,
    invoiceNumber: event.invoiceNumber ?? null,
    status: invoiceStatusForProviderEvent(event),
    currency: (event.currency ?? "USD").toUpperCase(),
    amountDueCents: event.amountDueCents ?? 0,
    amountPaidCents: event.amountPaidCents ?? 0,
    invoiceUrl: event.invoiceUrl ?? null,
    invoicePdfUrl: event.invoicePdfUrl ?? null,
    dueAt: event.dueAt ?? null,
    paidAt: event.paidAt ?? null,
    updatedAt: timestamp,
  };

  if (existing) {
    db.update(billingInvoices)
      .set(invoiceValues)
      .where(eq(billingInvoices.id, existing.id))
      .run();
    return invoiceFromRow(
      db.select().from(billingInvoices).where(eq(billingInvoices.id, existing.id)).limit(1).get()!,
    );
  }

  db.insert(billingInvoices)
    .values({
      id: `invoice_${randomUUID()}`,
      ...invoiceValues,
      createdAt: timestamp,
    })
    .run();

  return invoiceFromRow(
    db.select().from(billingInvoices).where(eq(billingInvoices.providerInvoiceId, event.providerInvoiceId)).limit(1).get()!,
  );
}

function enqueuePaymentFailedNotification(db: AppDatabase, userId: string, invoice: BillingInvoiceView) {
  if (invoice.status !== "payment_failed") return;

  const user = getUserOrThrow(db, userId);
  const recipient = user.email?.trim();

  if (!recipient) return;

  const invoiceLabel = invoice.invoiceNumber ?? invoice.providerInvoiceId;
  const amountLabel = `${invoice.currency} ${(invoice.amountDueCents / 100).toFixed(2)}`;
  const retryLine = invoice.invoiceUrl
    ? `Pay or update your payment method here: ${invoice.invoiceUrl}`
    : "Open WinBids Settings > Billing to update your payment method.";

  enqueueNotification(db, {
    id: `notification_${randomUUID()}`,
    alertId: `billing_invoice:${invoice.providerInvoiceId}`,
    userId,
    channel: "email",
    recipient,
    frequency: "daily",
    dedupeKey: `billing:payment_failed:${invoice.providerInvoiceId}`,
    subject: `Payment failed for invoice ${invoiceLabel}`,
    bodyText: [
      `We could not collect payment for invoice ${invoiceLabel}.`,
      `Amount due: ${amountLabel}.`,
      invoice.dueAt ? `Due date: ${invoice.dueAt}.` : null,
      retryLine,
      "Your paid WinBids access may be limited if the invoice remains unpaid after the grace period.",
    ].filter(Boolean).join("\n"),
    matchedBidIds: [],
    createdAt: nowIso(),
  });
}

export function getAccountSubscription(db: AppDatabase, userId: string): AccountSubscriptionResponse {
  const user = getUserOrThrow(db, userId);
  const row = db
    .select()
    .from(accountSubscriptions)
    .where(eq(accountSubscriptions.userId, userId))
    .limit(1)
    .get();
  const effectiveTier = normalizeAccountTier(user.accountTier);

  if (!row) {
    return {
      subscription: {
        userId,
        tier: effectiveTier,
        status: "none",
        source: "admin_override",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
      plans: listSubscriptionPlans(),
    };
  }

  const storedTier = normalizeAccountTier(row.tier);

  return {
    subscription: {
      userId,
      tier: effectiveTier,
      status: normalizeSubscriptionStatus(row.status),
      source: effectiveTier === storedTier ? normalizeSubscriptionSource(row.source) : "admin_override",
      currentPeriodEnd: row.currentPeriodEnd,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd === 1,
    },
    plans: listSubscriptionPlans(),
  };
}

export function reconcileSubscriptionLifecycle(
  db: AppDatabase,
  options: SubscriptionLifecycleReconcileOptions = {},
): SubscriptionLifecycleReconcileResult {
  const now = options.now ?? nowIso();
  const pastDueGraceDays = Math.max(0, options.pastDueGraceDays ?? 7);
  const rows = db.select().from(accountSubscriptions).all();

  return reconcileSubscriptionRows(db, rows, { now, pastDueGraceDays });
}

function reconcileSubscriptionRows(
  db: AppDatabase,
  rows: (typeof accountSubscriptions.$inferSelect)[],
  options: { now: string; pastDueGraceDays: number },
): SubscriptionLifecycleReconcileResult {
  const { now, pastDueGraceDays } = options;
  const result: SubscriptionLifecycleReconcileResult = {
    checked: 0,
    canceledAtPeriodEnd: 0,
    markedPastDue: 0,
    downgradedPastDue: 0,
    expiredTrials: 0,
  };

  for (const row of rows) {
    result.checked += 1;
    const status = normalizeSubscriptionStatus(row.status);
    const tier = normalizeAccountTier(row.tier);

    if (tier === "free" || status === "none" || status === "canceled") {
      continue;
    }

    if (status === "trialing" && subscriptionIsExpired(row.currentPeriodEnd, now)) {
      transitionSubscriptionLifecycle(db, row, {
        tier: "free",
        status: "canceled",
        eventType: "trial_expired",
        now,
      });
      result.expiredTrials += 1;
      continue;
    }

    if (row.cancelAtPeriodEnd === 1 && subscriptionIsExpired(row.currentPeriodEnd, now)) {
      transitionSubscriptionLifecycle(db, row, {
        tier: "free",
        status: "canceled",
        eventType: "subscription_canceled_at_period_end",
        now,
      });
      result.canceledAtPeriodEnd += 1;
      continue;
    }

    if (status === "past_due" && gracePeriodExpired(row.currentPeriodEnd, now, pastDueGraceDays)) {
      transitionSubscriptionLifecycle(db, row, {
        tier: "free",
        status: "canceled",
        eventType: "subscription_downgraded_past_due",
        now,
        metadata: { pastDueGraceDays },
      });
      result.downgradedPastDue += 1;
      continue;
    }

    if (status === "active" && subscriptionIsExpired(row.currentPeriodEnd, now)) {
      transitionSubscriptionLifecycle(db, row, {
        tier,
        status: "past_due",
        eventType: "subscription_marked_past_due",
        now,
      });
      result.markedPastDue += 1;
    }
  }

  return result;
}

export function reconcileUserSubscriptionLifecycle(
  db: AppDatabase,
  userId: string,
  options: SubscriptionLifecycleReconcileOptions = {},
): SubscriptionLifecycleReconcileResult {
  getUserOrThrow(db, userId);
  const now = options.now ?? nowIso();
  const pastDueGraceDays = Math.max(0, options.pastDueGraceDays ?? 7);
  const result: SubscriptionLifecycleReconcileResult = {
    checked: 0,
    canceledAtPeriodEnd: 0,
    markedPastDue: 0,
    downgradedPastDue: 0,
    expiredTrials: 0,
  };
  const row = existingSubscriptionForUser(db, userId);

  if (!row) return result;

  return reconcileSubscriptionRows(db, [row], { now, pastDueGraceDays });
}

export function listAccountInvoices(
  db: AppDatabase,
  userId: string,
  options: ListAccountInvoicesOptions = {},
): BillingInvoicesResponse {
  getUserOrThrow(db, userId);
  const where = options.status
    ? and(eq(billingInvoices.userId, userId), eq(billingInvoices.status, options.status))
    : eq(billingInvoices.userId, userId);
  const invoices = db
    .select()
    .from(billingInvoices)
    .where(where)
    .orderBy(desc(billingInvoices.createdAt))
    .all()
    .map(invoiceFromRow);

  return {
    invoices,
    summary: invoiceSummary(invoices),
  };
}

export function upsertAccountSubscription(
  db: AppDatabase,
  userId: string,
  input: UpsertAccountSubscriptionInput,
  eventOptions?: {
    eventType?: string;
    providerEventId?: string | null;
  },
): AccountSubscriptionResponse {
  const user = getUserOrThrow(db, userId);
  const existing = db
    .select()
    .from(accountSubscriptions)
    .where(eq(accountSubscriptions.userId, userId))
    .limit(1)
    .get();
  const timestamp = nowIso();
  const subscriptionId = existing?.id ?? `sub_${randomUUID()}`;
  const fromTier = normalizeAccountTier(user.accountTier);
  const fromStatus = normalizeSubscriptionStatus(existing?.status);

  if (existing) {
    db.update(accountSubscriptions)
      .set({
        tier: input.tier,
        status: input.status,
        source: input.source,
        provider: input.provider ?? existing.provider,
        providerCustomerId: input.providerCustomerId ?? existing.providerCustomerId,
        providerSubscriptionId: input.providerSubscriptionId ?? existing.providerSubscriptionId,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ? 1 : 0,
        updatedAt: timestamp,
      })
      .where(eq(accountSubscriptions.id, subscriptionId))
      .run();
  } else {
    db.insert(accountSubscriptions)
      .values({
        id: subscriptionId,
        userId,
        tier: input.tier,
        status: input.status,
        source: input.source,
        provider: input.provider ?? null,
        providerCustomerId: input.providerCustomerId ?? null,
        providerSubscriptionId: input.providerSubscriptionId ?? null,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ? 1 : 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }

  db.update(users)
    .set({
      accountTier: input.tier,
      updatedAt: timestamp,
    })
    .where(eq(users.id, userId))
    .run();
  syncOwnedWorkspaceTier(db, userId, input.tier, timestamp);

  writeSubscriptionEvent(db, {
    userId,
    subscriptionId,
    eventType: eventOptions?.eventType ?? "subscription_updated",
    providerEventId: eventOptions?.providerEventId ?? null,
    fromTier,
    toTier: input.tier,
    fromStatus,
    toStatus: input.status,
    source: input.source,
    metadata: input.metadata,
    createdAt: timestamp,
  });

  return getAccountSubscription(db, userId);
}

export function createCheckoutSession(
  db: AppDatabase,
  userId: string,
  input: CreateCheckoutSessionInput,
): Promise<CheckoutSessionResponse> | CheckoutSessionResponse {
  const user = getUserOrThrow(db, userId);

  if (input.tier === "free" || input.tier === "enterprise") {
    throw new InvalidSubscriptionInputError("Only Pro and Business plans support self-service checkout");
  }

  const timestamp = nowIso();
  const checkoutId = `checkout_${randomUUID()}`;
  const providerAdapter = input.providerAdapter ?? createConfiguredBillingProvider();

  const persistCheckoutSession = (session: {
    providerSessionId: string;
    checkoutUrl: string;
    expiresAt?: string | null;
    provider: "local_checkout" | "billing_provider";
    eventSource: SubscriptionSource;
  }) => {
    db.insert(billingCheckoutSessions)
      .values({
        id: checkoutId,
        userId,
        tier: input.tier,
        status: "open",
        provider: session.provider,
        providerSessionId: session.providerSessionId,
        checkoutUrl: session.checkoutUrl,
        expiresAt: session.expiresAt ?? addHoursIso(timestamp, 1),
        completedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    writeSubscriptionEvent(db, {
      userId,
      eventType: "checkout_started",
      fromTier: null,
      toTier: input.tier,
      fromStatus: null,
      toStatus: "none",
      source: session.eventSource,
      metadata: { checkoutSessionId: checkoutId, providerSessionId: session.providerSessionId },
      createdAt: timestamp,
    });

    const row = db
      .select()
      .from(billingCheckoutSessions)
      .where(eq(billingCheckoutSessions.id, checkoutId))
      .limit(1)
      .get();

    if (!row) {
      throw new InvalidSubscriptionInputError("Checkout session could not be created");
    }

    return { checkoutSession: checkoutSessionFromRow(row) };
  };

  if (providerAdapter) {
    if (!user.email) {
      throw new InvalidSubscriptionInputError("User email is required for provider checkout");
    }

    return providerAdapter.createCheckoutSession({
      userId,
      email: user.email,
      tier: input.tier,
      priceId: stripePriceIdForTier(input.tier),
      successUrl: checkoutSuccessUrl({ checkoutSessionId: checkoutId, origin: input.origin }),
      cancelUrl: checkoutCancelUrl(input.origin),
    }).then((providerSession) =>
      persistCheckoutSession({
        provider: "billing_provider",
        eventSource: "billing_provider",
        ...providerSession,
      }),
    );
  }

  const isHostedProvider = Boolean(process.env.BILLING_CHECKOUT_URL_TEMPLATE?.trim());
  const providerSessionId = `${isHostedProvider ? billingProviderName() : "local"}_cs_${randomUUID()}`;

  return persistCheckoutSession({
    provider: isHostedProvider ? "billing_provider" : "local_checkout",
    eventSource: isHostedProvider ? "billing_provider" : "local_checkout",
    providerSessionId,
    checkoutUrl: hostedCheckoutUrl({
      checkoutSessionId: checkoutId,
      providerSessionId,
      tier: input.tier,
      userId,
      origin: input.origin,
    }),
    expiresAt: addHoursIso(timestamp, 1),
  });
}

export function createCustomerPortalSession(
  db: AppDatabase,
  userId: string,
  input: CreateCustomerPortalSessionInput = {},
): Promise<CustomerPortalSessionResponse> | CustomerPortalSessionResponse {
  getUserOrThrow(db, userId);

  const subscription = existingSubscriptionForUser(db, userId);
  const providerAdapter = input.providerAdapter ?? createConfiguredBillingProvider();
  const isHostedProvider = Boolean(process.env.BILLING_CUSTOMER_PORTAL_URL_TEMPLATE?.trim());
  const returnUrl = settingsReturnUrl(input.origin);

  if (providerAdapter) {
    if (!subscription?.providerCustomerId) {
      throw new InvalidSubscriptionInputError("Provider customer id is required for billing portal");
    }

    return providerAdapter.createCustomerPortalSession({
      userId,
      providerCustomerId: subscription.providerCustomerId,
      returnUrl,
    }).then((providerSession) => ({
      portalSession: {
        userId,
        provider: "billing_provider",
        portalUrl: providerSession.portalUrl,
        returnUrl,
        createdAt: nowIso(),
      },
    }));
  }

  return {
    portalSession: {
      userId,
      provider: isHostedProvider ? "billing_provider" : "local_checkout",
      portalUrl: hostedCustomerPortalUrl({
        userId,
        providerCustomerId: subscription?.providerCustomerId,
        providerSubscriptionId: subscription?.providerSubscriptionId,
        origin: input.origin,
      }),
      returnUrl,
      createdAt: nowIso(),
    },
  };
}

function findProviderEvent(db: AppDatabase, providerEventId: string) {
  return db
    .select()
    .from(subscriptionEvents)
    .where(eq(subscriptionEvents.providerEventId, providerEventId))
    .limit(1)
    .get();
}

function findUserForProviderEvent(db: AppDatabase, event: BillingProviderEvent) {
  if (event.userId) {
    return getUserOrThrow(db, event.userId);
  }

  if (event.email) {
    const user = db.select().from(users).where(eq(users.email, event.email)).limit(1).get();
    if (user) return user;
  }

  if (event.providerSubscriptionId || event.providerCustomerId) {
    const row = db
      .select()
      .from(accountSubscriptions)
      .where(
        or(
          event.providerSubscriptionId
            ? eq(accountSubscriptions.providerSubscriptionId, event.providerSubscriptionId)
            : undefined,
          event.providerCustomerId
            ? eq(accountSubscriptions.providerCustomerId, event.providerCustomerId)
            : undefined,
        ),
      )
      .limit(1)
      .get();
    if (row) return getUserOrThrow(db, row.userId);
  }

  throw new InvalidSubscriptionInputError("Provider event must identify a user");
}

function normalizedProviderEventTierForUser(
  db: AppDatabase,
  userId: string,
  event: BillingProviderEvent,
): AccountTier {
  if (event.type === "subscription.deleted") return "free";
  if (isAccountTier(event.tier)) return event.tier;

  if (providerEventIsInvoice(event)) {
    const existing = existingSubscriptionForUser(db, userId);
    if (existing) return normalizeAccountTier(existing.tier);

    return normalizeAccountTier(getUserOrThrow(db, userId).accountTier);
  }

  throw new InvalidSubscriptionInputError("Provider event must include a valid tier");
}

function normalizedProviderEventStatus(event: BillingProviderEvent): SubscriptionStatus {
  if (event.type === "subscription.deleted") {
    return "canceled";
  }

  if (event.type === "invoice.paid") {
    return isSubscriptionStatus(event.status) ? event.status : "active";
  }

  if (event.type === "invoice.payment_failed") {
    return "past_due";
  }

  if (!isSubscriptionStatus(event.status)) {
    throw new InvalidSubscriptionInputError("Provider event must include a valid subscription status");
  }

  return event.status;
}

export function applyBillingProviderEvent(
  db: AppDatabase,
  event: BillingProviderEvent,
): AccountSubscriptionResponse {
  if (!event.id || !event.type) {
    throw new InvalidSubscriptionInputError("Provider event must include id and type");
  }

  const user = findUserForProviderEvent(db, event);
  const existingProviderEvent = findProviderEvent(db, event.id);

  if (existingProviderEvent) {
    return getAccountSubscription(db, user.id);
  }

  const tier = normalizedProviderEventTierForUser(db, user.id, event);
  const status = normalizedProviderEventStatus(event);
  const invoice = upsertBillingInvoice(db, user.id, event);
  if (invoice?.status === "payment_failed") {
    enqueuePaymentFailedNotification(db, user.id, invoice);
  }
  const result = upsertAccountSubscription(
    db,
    user.id,
    {
      tier,
      status,
      source: "billing_provider",
      provider: event.provider ?? "billing_provider",
      providerCustomerId: event.providerCustomerId ?? null,
      providerSubscriptionId: event.providerSubscriptionId ?? null,
      currentPeriodEnd: event.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: event.cancelAtPeriodEnd ?? false,
      metadata: {
        ...event.metadata,
        providerEventType: event.type,
        providerSessionId: event.providerSessionId ?? null,
      },
    },
    {
      eventType: event.type,
      providerEventId: event.id,
    },
  );

  if (event.providerSessionId) {
    const timestamp = nowIso();

    db.update(billingCheckoutSessions)
      .set({
        status: event.type === "checkout.completed" ? "completed" : "open",
        completedAt: event.type === "checkout.completed" ? timestamp : null,
        updatedAt: timestamp,
      })
      .where(eq(billingCheckoutSessions.providerSessionId, event.providerSessionId))
      .run();
  }

  return result;
}

export function cancelAccountSubscription(
  db: AppDatabase,
  userId: string,
  options: { providerAdapter?: BillingProviderAdapter | null } = {},
): Promise<AccountSubscriptionResponse> | AccountSubscriptionResponse {
  getUserOrThrow(db, userId);
  const row = db
    .select()
    .from(accountSubscriptions)
    .where(eq(accountSubscriptions.userId, userId))
    .limit(1)
    .get();

  if (!row || normalizeSubscriptionStatus(row.status) === "none") {
    throw new InvalidSubscriptionInputError("No active subscription to cancel");
  }

  const timestamp = nowIso();
  const status = normalizeSubscriptionStatus(row.status);
  const tier = normalizeAccountTier(row.tier);
  const providerAdapter = options.providerAdapter ?? createConfiguredBillingProvider();

  const markLocalCancellation = (providerResult?: { currentPeriodEnd?: string | null; status?: SubscriptionStatus }) => {
    const nextStatus = providerResult?.status ?? status;

    db.update(accountSubscriptions)
      .set({
        status: nextStatus,
        currentPeriodEnd: providerResult?.currentPeriodEnd ?? row.currentPeriodEnd,
        cancelAtPeriodEnd: 1,
        updatedAt: timestamp,
      })
      .where(eq(accountSubscriptions.id, row.id))
      .run();

    writeSubscriptionEvent(db, {
      userId,
      subscriptionId: row.id,
      eventType: "subscription_cancel_scheduled",
      fromTier: tier,
      toTier: tier,
      fromStatus: status,
      toStatus: nextStatus,
      source: normalizeSubscriptionSource(row.source),
      metadata: { providerSubscriptionId: row.providerSubscriptionId },
      createdAt: timestamp,
    });

    return getAccountSubscription(db, userId);
  };

  if (providerAdapter && normalizeSubscriptionSource(row.source) === "billing_provider") {
    if (!row.providerSubscriptionId) {
      throw new InvalidSubscriptionInputError("Provider subscription id is required to cancel subscription");
    }

    return providerAdapter.scheduleSubscriptionCancel({
      userId,
      providerSubscriptionId: row.providerSubscriptionId,
    }).then((providerResult) => markLocalCancellation(providerResult));
  }

  return markLocalCancellation();
}
