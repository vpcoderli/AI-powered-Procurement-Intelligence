import { randomUUID } from "node:crypto";
import { desc, eq, or } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { accountSubscriptions, billingCheckoutSessions, billingInvoices, subscriptionEvents, users } from "@/server/db/schema";
import {
  isAccountTier,
  ACCOUNT_TIER_LABELS,
  normalizeAccountTier,
  type AccountTier,
} from "@/server/auth/entitlements";

export const SUBSCRIPTION_STATUSES = ["none", "trialing", "active", "past_due", "canceled"] as const;
export const SUBSCRIPTION_SOURCES = ["admin_override", "local_checkout", "billing_provider"] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export type SubscriptionSource = (typeof SUBSCRIPTION_SOURCES)[number];

export interface SubscriptionPlan {
  tier: AccountTier;
  label: string;
  priceMonthlyUsd: number | null;
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

export type BillingInvoiceStatus = "open" | "paid" | "payment_failed" | "void" | "uncollectible";

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

export class InvalidSubscriptionInputError extends Error {
  constructor(message = "Invalid subscription input") {
    super(message);
    this.name = "InvalidSubscriptionInputError";
  }
}

const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    tier: "free",
    label: ACCOUNT_TIER_LABELS.free,
    priceMonthlyUsd: 0,
    featureHighlights: ["Search bids", "Save bids", "Supplier profile"],
  },
  {
    tier: "pro",
    label: ACCOUNT_TIER_LABELS.pro,
    priceMonthlyUsd: 79,
    featureHighlights: ["Submission guidance", "Pursue / no-bid workflow", "Full match explanation"],
  },
  {
    tier: "business",
    label: ACCOUNT_TIER_LABELS.business,
    priceMonthlyUsd: 249,
    featureHighlights: ["Compliance manifest", "Quote workflow", "Team-ready bid workspace"],
  },
  {
    tier: "enterprise",
    label: ACCOUNT_TIER_LABELS.enterprise,
    priceMonthlyUsd: null,
    featureHighlights: ["Knowledge Station", "Advanced intelligence", "Higher support limits"],
  },
];

function nowIso() {
  return new Date().toISOString();
}

function addHoursIso(timestamp: string, hours: number) {
  return new Date(new Date(timestamp).getTime() + hours * 60 * 60 * 1000).toISOString();
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

function existingSubscriptionForUser(db: AppDatabase, userId: string) {
  return db
    .select()
    .from(accountSubscriptions)
    .where(eq(accountSubscriptions.userId, userId))
    .limit(1)
    .get();
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
  if (!providerEventIsInvoice(event)) return;
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
    return;
  }

  db.insert(billingInvoices)
    .values({
      id: `invoice_${randomUUID()}`,
      ...invoiceValues,
      createdAt: timestamp,
    })
    .run();
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

export function listAccountInvoices(db: AppDatabase, userId: string): BillingInvoicesResponse {
  getUserOrThrow(db, userId);

  return {
    invoices: db
      .select()
      .from(billingInvoices)
      .where(eq(billingInvoices.userId, userId))
      .orderBy(desc(billingInvoices.createdAt))
      .all()
      .map(invoiceFromRow),
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
): CheckoutSessionResponse {
  getUserOrThrow(db, userId);

  if (input.tier === "free" || input.tier === "enterprise") {
    throw new InvalidSubscriptionInputError("Only Pro and Business plans support self-service checkout");
  }

  const timestamp = nowIso();
  const checkoutId = `checkout_${randomUUID()}`;
  const providerSessionId = `local_cs_${randomUUID()}`;
  const origin = input.origin?.replace(/\/$/, "") ?? "";
  const checkoutUrl = `${origin}/settings?checkoutSession=${checkoutId}`;

  db.insert(billingCheckoutSessions)
    .values({
      id: checkoutId,
      userId,
      tier: input.tier,
      status: "open",
      provider: "local_checkout",
      providerSessionId,
      checkoutUrl,
      expiresAt: addHoursIso(timestamp, 1),
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
    source: "local_checkout",
    metadata: { checkoutSessionId: checkoutId, providerSessionId },
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
  upsertBillingInvoice(db, user.id, event);
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

export function cancelAccountSubscription(db: AppDatabase, userId: string): AccountSubscriptionResponse {
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

  db.update(accountSubscriptions)
    .set({
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
    toStatus: status,
    source: normalizeSubscriptionSource(row.source),
    metadata: { providerSubscriptionId: row.providerSubscriptionId },
    createdAt: timestamp,
  });

  return getAccountSubscription(db, userId);
}
