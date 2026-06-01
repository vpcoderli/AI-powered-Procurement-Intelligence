import { randomUUID } from "node:crypto";
import type { Pool } from "mysql2/promise";
import { syncOwnedMysqlWorkspaceTier } from "@/server/account/mysql-workspace";
import {
  isAccountTier,
  normalizeAccountTier,
  type AccountTier,
} from "@/server/auth/entitlements";
import {
  mysqlExecute,
  mysqlSelectMany,
  mysqlSelectOne,
  normalizeMysqlBoolean,
} from "@/server/db/mysql-runtime";
import { InvalidSubscriptionInputError } from "./errors";
import {
  createConfiguredBillingProvider,
  stripePriceIdForTier,
  type BillingProviderAdapter,
} from "./providers";
import {
  isBillingInvoiceStatus,
  listSubscriptionPlans,
  type AccountSubscriptionResponse,
  type BillingInvoiceStatus,
  type BillingInvoiceView,
  type BillingInvoicesResponse,
  type BillingProviderEvent,
  type CheckoutSessionResponse,
  type CheckoutSessionView,
  type CreateCheckoutSessionInput,
  type CreateCustomerPortalSessionInput,
  type CustomerPortalSessionResponse,
  type ListAccountInvoicesOptions,
  type SubscriptionLifecycleReconcileOptions,
  type SubscriptionLifecycleReconcileResult,
  type SubscriptionSource,
  type SubscriptionStatus,
  type UpsertAccountSubscriptionInput,
} from "./subscriptions";

interface MysqlBillingUserRow {
  id: string;
  email: string | null;
  accountTier: string | null;
}

interface MysqlSubscriptionRow {
  id: string;
  userId: string;
  tier: string | null;
  status: string | null;
  source: string | null;
  provider: string | null;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: number | string | boolean | null;
  createdAt: string;
  updatedAt: string;
}

interface MysqlCheckoutSessionRow {
  id: string;
  userId: string;
  tier: string;
  status: string;
  provider: string;
  providerSessionId: string;
  checkoutUrl: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

interface MysqlInvoiceRow {
  id: string;
  userId: string;
  provider: string;
  providerInvoiceId: string;
  invoiceNumber: string | null;
  status: string;
  currency: string;
  amountDueCents: number | string;
  amountPaidCents: number | string;
  invoiceUrl: string | null;
  invoicePdfUrl: string | null;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const SUBSCRIPTION_STATUSES = ["none", "trialing", "active", "past_due", "canceled"] as const;
const SUBSCRIPTION_SOURCES = ["admin_override", "local_checkout", "billing_provider"] as const;

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

function checkoutSuccessUrl(input: { checkoutSessionId: string; origin?: string }) {
  return `${settingsReturnUrl(input.origin)}?checkoutSession=${input.checkoutSessionId}&checkout=success`;
}

function checkoutCancelUrl(origin?: string) {
  return `${settingsReturnUrl(origin)}?checkout=cancel`;
}

function formatProviderUrlTemplate(template: string, values: Record<string, string | null | undefined>) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) =>
    encodeURIComponent(values[key] ?? ""),
  );
}

function billingProviderName() {
  return process.env.BILLING_PROVIDER?.trim() || "local";
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

function normalizeSubscriptionStatus(value: unknown): SubscriptionStatus {
  return typeof value === "string" && SUBSCRIPTION_STATUSES.includes(value as SubscriptionStatus)
    ? value as SubscriptionStatus
    : "none";
}

function normalizeSubscriptionSource(value: unknown): SubscriptionSource {
  return typeof value === "string" && SUBSCRIPTION_SOURCES.includes(value as SubscriptionSource)
    ? value as SubscriptionSource
    : "admin_override";
}

function checkoutSessionFromMysqlRow(row: MysqlCheckoutSessionRow): CheckoutSessionView {
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
  return isBillingInvoiceStatus(value) ? value : "open";
}

function invoiceFromMysqlRow(row: MysqlInvoiceRow): BillingInvoiceView {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    providerInvoiceId: row.providerInvoiceId,
    invoiceNumber: row.invoiceNumber,
    status: normalizeInvoiceStatus(row.status),
    currency: row.currency,
    amountDueCents: Number(row.amountDueCents),
    amountPaidCents: Number(row.amountPaidCents),
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

async function getMysqlBillingUserOrThrow(pool: Pool, userId: string) {
  const user = await mysqlSelectOne<MysqlBillingUserRow>(
    pool,
    "SELECT id, email, account_tier AS accountTier FROM users WHERE id = ? LIMIT 1",
    [userId],
  );

  if (!user) {
    throw new InvalidSubscriptionInputError("User not found");
  }

  return user;
}

async function existingMysqlSubscriptionForUser(pool: Pool, userId: string) {
  return mysqlSelectOne<MysqlSubscriptionRow>(
    pool,
    `
      SELECT
        id,
        user_id AS userId,
        tier,
        status,
        source,
        provider,
        provider_customer_id AS providerCustomerId,
        provider_subscription_id AS providerSubscriptionId,
        current_period_end AS currentPeriodEnd,
        cancel_at_period_end AS cancelAtPeriodEnd,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM account_subscriptions
      WHERE user_id = ?
      LIMIT 1
    `,
    [userId],
  );
}

async function writeMysqlSubscriptionEvent(
  pool: Pool,
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
  await mysqlExecute(
    pool,
    `
      INSERT INTO subscription_events (
        id,
        provider_event_id,
        user_id,
        subscription_id,
        event_type,
        from_tier,
        to_tier,
        from_status,
        to_status,
        source,
        metadata_json,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      `subevt_${randomUUID()}`,
      input.providerEventId ?? null,
      input.userId,
      input.subscriptionId ?? null,
      input.eventType,
      input.fromTier ?? null,
      input.toTier ?? null,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      input.source,
      JSON.stringify(input.metadata ?? {}),
      input.createdAt ?? nowIso(),
    ],
  );
}

export async function getMysqlAccountSubscription(
  pool: Pool,
  userId: string,
): Promise<AccountSubscriptionResponse> {
  const user = await getMysqlBillingUserOrThrow(pool, userId);
  const row = await existingMysqlSubscriptionForUser(pool, userId);
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
      cancelAtPeriodEnd: normalizeMysqlBoolean(row.cancelAtPeriodEnd),
    },
    plans: listSubscriptionPlans(),
  };
}

export async function upsertMysqlAccountSubscription(
  pool: Pool,
  userId: string,
  input: UpsertAccountSubscriptionInput,
  eventOptions?: {
    eventType?: string;
    providerEventId?: string | null;
  },
): Promise<AccountSubscriptionResponse> {
  const user = await getMysqlBillingUserOrThrow(pool, userId);
  const existing = await existingMysqlSubscriptionForUser(pool, userId);
  const timestamp = nowIso();
  const subscriptionId = existing?.id ?? `sub_${randomUUID()}`;
  const fromTier = normalizeAccountTier(user.accountTier);
  const fromStatus = normalizeSubscriptionStatus(existing?.status);

  if (existing) {
    await mysqlExecute(
      pool,
      `
        UPDATE account_subscriptions
        SET
          tier = ?,
          status = ?,
          source = ?,
          provider = ?,
          provider_customer_id = ?,
          provider_subscription_id = ?,
          current_period_end = ?,
          cancel_at_period_end = ?,
          updated_at = ?
        WHERE id = ?
      `,
      [
        input.tier,
        input.status,
        input.source,
        input.provider ?? existing.provider,
        input.providerCustomerId ?? existing.providerCustomerId,
        input.providerSubscriptionId ?? existing.providerSubscriptionId,
        input.currentPeriodEnd ?? null,
        input.cancelAtPeriodEnd ? 1 : 0,
        timestamp,
        subscriptionId,
      ],
    );
  } else {
    await mysqlExecute(
      pool,
      `
        INSERT INTO account_subscriptions (
          id,
          user_id,
          tier,
          status,
          source,
          provider,
          provider_customer_id,
          provider_subscription_id,
          current_period_end,
          cancel_at_period_end,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        subscriptionId,
        userId,
        input.tier,
        input.status,
        input.source,
        input.provider ?? null,
        input.providerCustomerId ?? null,
        input.providerSubscriptionId ?? null,
        input.currentPeriodEnd ?? null,
        input.cancelAtPeriodEnd ? 1 : 0,
        timestamp,
        timestamp,
      ],
    );
  }

  await mysqlExecute(pool, "UPDATE users SET account_tier = ?, updated_at = ? WHERE id = ?", [
    input.tier,
    timestamp,
    userId,
  ]);
  await syncOwnedMysqlWorkspaceTier(pool, userId, input.tier, timestamp);

  await writeMysqlSubscriptionEvent(pool, {
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

  return getMysqlAccountSubscription(pool, userId);
}

export async function createMysqlCheckoutSession(
  pool: Pool,
  userId: string,
  input: CreateCheckoutSessionInput,
): Promise<CheckoutSessionResponse> {
  const user = await getMysqlBillingUserOrThrow(pool, userId);

  if (input.tier === "free" || input.tier === "enterprise") {
    throw new InvalidSubscriptionInputError("Only Pro and Business plans support self-service checkout");
  }

  const timestamp = nowIso();
  const checkoutId = `checkout_${randomUUID()}`;
  const providerAdapter = input.providerAdapter ?? createConfiguredBillingProvider();

  const persistCheckoutSession = async (session: {
    providerSessionId: string;
    checkoutUrl: string;
    expiresAt?: string | null;
    provider: "local_checkout" | "billing_provider";
    eventSource: SubscriptionSource;
  }) => {
    await mysqlExecute(
      pool,
      `
        INSERT INTO billing_checkout_sessions (
          id, user_id, tier, status, provider, provider_session_id, checkout_url,
          expires_at, completed_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        checkoutId,
        userId,
        input.tier,
        "open",
        session.provider,
        session.providerSessionId,
        session.checkoutUrl,
        session.expiresAt ?? addHoursIso(timestamp, 1),
        null,
        timestamp,
        timestamp,
      ],
    );

    await writeMysqlSubscriptionEvent(pool, {
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

    const row = await mysqlSelectOne<MysqlCheckoutSessionRow>(
      pool,
      `
        SELECT
          id,
          user_id AS userId,
          tier,
          status,
          provider,
          provider_session_id AS providerSessionId,
          checkout_url AS checkoutUrl,
          expires_at AS expiresAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM billing_checkout_sessions
        WHERE id = ?
        LIMIT 1
      `,
      [checkoutId],
    );

    if (!row) {
      throw new InvalidSubscriptionInputError("Checkout session could not be created");
    }

    return { checkoutSession: checkoutSessionFromMysqlRow(row) };
  };

  if (providerAdapter) {
    if (!user.email) {
      throw new InvalidSubscriptionInputError("User email is required for provider checkout");
    }

    const providerSession = await providerAdapter.createCheckoutSession({
      userId,
      email: user.email,
      tier: input.tier,
      priceId: stripePriceIdForTier(input.tier),
      successUrl: checkoutSuccessUrl({ checkoutSessionId: checkoutId, origin: input.origin }),
      cancelUrl: checkoutCancelUrl(input.origin),
    });

    return persistCheckoutSession({
      provider: "billing_provider",
      eventSource: "billing_provider",
      ...providerSession,
    });
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

export async function createMysqlCustomerPortalSession(
  pool: Pool,
  userId: string,
  input: CreateCustomerPortalSessionInput = {},
): Promise<CustomerPortalSessionResponse> {
  await getMysqlBillingUserOrThrow(pool, userId);
  const subscription = await existingMysqlSubscriptionForUser(pool, userId);
  const providerAdapter = input.providerAdapter ?? createConfiguredBillingProvider();
  const isHostedProvider = Boolean(process.env.BILLING_CUSTOMER_PORTAL_URL_TEMPLATE?.trim());
  const returnUrl = settingsReturnUrl(input.origin);

  if (providerAdapter) {
    if (!subscription?.providerCustomerId) {
      throw new InvalidSubscriptionInputError("Provider customer id is required for billing portal");
    }

    const providerSession = await providerAdapter.createCustomerPortalSession({
      userId,
      providerCustomerId: subscription.providerCustomerId,
      returnUrl,
    });

    return {
      portalSession: {
        userId,
        provider: "billing_provider",
        portalUrl: providerSession.portalUrl,
        returnUrl,
        createdAt: nowIso(),
      },
    };
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

export async function listMysqlAccountInvoices(
  pool: Pool,
  userId: string,
  options: ListAccountInvoicesOptions = {},
): Promise<BillingInvoicesResponse> {
  await getMysqlBillingUserOrThrow(pool, userId);
  const values = options.status ? [userId, options.status] : [userId];
  const rows = await mysqlSelectMany<MysqlInvoiceRow>(
    pool,
    `
      SELECT
        id,
        user_id AS userId,
        provider,
        provider_invoice_id AS providerInvoiceId,
        invoice_number AS invoiceNumber,
        status,
        currency,
        amount_due_cents AS amountDueCents,
        amount_paid_cents AS amountPaidCents,
        invoice_url AS invoiceUrl,
        invoice_pdf_url AS invoicePdfUrl,
        due_at AS dueAt,
        paid_at AS paidAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM billing_invoices
      WHERE user_id = ?${options.status ? " AND status = ?" : ""}
      ORDER BY created_at DESC
    `,
    values,
  );
  const invoices = rows.map(invoiceFromMysqlRow);

  return {
    invoices,
    summary: invoiceSummary(invoices),
  };
}

function providerEventIsInvoice(event: BillingProviderEvent) {
  return event.type === "invoice.paid" || event.type === "invoice.payment_failed";
}

function invoiceStatusForProviderEvent(event: BillingProviderEvent): BillingInvoiceStatus {
  if (event.type === "invoice.paid") return "paid";
  if (event.type === "invoice.payment_failed") return "payment_failed";
  return "open";
}

async function upsertMysqlBillingInvoice(pool: Pool, userId: string, event: BillingProviderEvent) {
  if (!providerEventIsInvoice(event)) return null;
  if (!event.providerInvoiceId) {
    throw new InvalidSubscriptionInputError("Invoice event must include providerInvoiceId");
  }

  const timestamp = nowIso();
  const existing = await mysqlSelectOne<{ id: string }>(
    pool,
    "SELECT id FROM billing_invoices WHERE provider_invoice_id = ? LIMIT 1",
    [event.providerInvoiceId],
  );
  const values = [
    userId,
    event.provider ?? "billing_provider",
    event.providerCustomerId ?? null,
    event.providerSubscriptionId ?? null,
    event.providerInvoiceId,
    event.invoiceNumber ?? null,
    invoiceStatusForProviderEvent(event),
    (event.currency ?? "USD").toUpperCase(),
    event.amountDueCents ?? 0,
    event.amountPaidCents ?? 0,
    event.invoiceUrl ?? null,
    event.invoicePdfUrl ?? null,
    event.dueAt ?? null,
    event.paidAt ?? null,
    timestamp,
  ];

  if (existing) {
    await mysqlExecute(
      pool,
      `
        UPDATE billing_invoices
        SET
          user_id = ?,
          provider = ?,
          provider_customer_id = ?,
          provider_subscription_id = ?,
          provider_invoice_id = ?,
          invoice_number = ?,
          status = ?,
          currency = ?,
          amount_due_cents = ?,
          amount_paid_cents = ?,
          invoice_url = ?,
          invoice_pdf_url = ?,
          due_at = ?,
          paid_at = ?,
          updated_at = ?
        WHERE id = ?
      `,
      [...values, existing.id],
    );
  } else {
    await mysqlExecute(
      pool,
      `
        INSERT INTO billing_invoices (
          id,
          user_id,
          provider,
          provider_customer_id,
          provider_subscription_id,
          provider_invoice_id,
          invoice_number,
          status,
          currency,
          amount_due_cents,
          amount_paid_cents,
          invoice_url,
          invoice_pdf_url,
          due_at,
          paid_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [`invoice_${randomUUID()}`, ...values.slice(0, -1), timestamp, timestamp],
    );
  }

  return event.providerInvoiceId;
}

async function findMysqlProviderEvent(pool: Pool, providerEventId: string) {
  return mysqlSelectOne<{ id: string }>(
    pool,
    "SELECT id FROM subscription_events WHERE provider_event_id = ? LIMIT 1",
    [providerEventId],
  );
}

async function findMysqlUserForProviderEvent(pool: Pool, event: BillingProviderEvent) {
  if (event.userId) {
    return getMysqlBillingUserOrThrow(pool, event.userId);
  }

  if (event.email) {
    const user = await mysqlSelectOne<MysqlBillingUserRow>(
      pool,
      "SELECT id, email, account_tier AS accountTier FROM users WHERE email = ? LIMIT 1",
      [event.email],
    );
    if (user) return user;
  }

  if (event.providerSubscriptionId || event.providerCustomerId) {
    const conditions: string[] = [];
    const values: string[] = [];
    if (event.providerSubscriptionId) {
      conditions.push("provider_subscription_id = ?");
      values.push(event.providerSubscriptionId);
    }
    if (event.providerCustomerId) {
      conditions.push("provider_customer_id = ?");
      values.push(event.providerCustomerId);
    }

    const subscription = await mysqlSelectOne<{ userId: string }>(
      pool,
      `SELECT user_id AS userId FROM account_subscriptions WHERE ${conditions.join(" OR ")} LIMIT 1`,
      values,
    );
    if (subscription) return getMysqlBillingUserOrThrow(pool, subscription.userId);
  }

  throw new InvalidSubscriptionInputError("Provider event must identify a user");
}

async function normalizedProviderEventTierForMysqlUser(
  pool: Pool,
  userId: string,
  event: BillingProviderEvent,
): Promise<AccountTier> {
  if (event.type === "subscription.deleted") return "free";
  if (isAccountTier(event.tier)) return event.tier;

  if (providerEventIsInvoice(event)) {
    const existing = await existingMysqlSubscriptionForUser(pool, userId);
    if (existing) return normalizeAccountTier(existing.tier);

    return normalizeAccountTier((await getMysqlBillingUserOrThrow(pool, userId)).accountTier);
  }

  throw new InvalidSubscriptionInputError("Provider event must include a valid tier");
}

function normalizedProviderEventStatus(event: BillingProviderEvent): SubscriptionStatus {
  if (event.type === "subscription.deleted") return "canceled";
  if (event.type === "invoice.paid") return event.status ? normalizeSubscriptionStatus(event.status) : "active";
  if (event.type === "invoice.payment_failed") return "past_due";

  const status = normalizeSubscriptionStatus(event.status);
  if (status === "none") {
    throw new InvalidSubscriptionInputError("Provider event must include a valid subscription status");
  }
  return status;
}

export async function applyMysqlBillingProviderEvent(
  pool: Pool,
  event: BillingProviderEvent,
): Promise<AccountSubscriptionResponse> {
  if (!event.id || !event.type) {
    throw new InvalidSubscriptionInputError("Provider event must include id and type");
  }

  const user = await findMysqlUserForProviderEvent(pool, event);
  const existingProviderEvent = await findMysqlProviderEvent(pool, event.id);

  if (existingProviderEvent) {
    return getMysqlAccountSubscription(pool, user.id);
  }

  const tier = await normalizedProviderEventTierForMysqlUser(pool, user.id, event);
  const status = normalizedProviderEventStatus(event);
  await upsertMysqlBillingInvoice(pool, user.id, event);
  const result = await upsertMysqlAccountSubscription(
    pool,
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
    await mysqlExecute(
      pool,
      `
        UPDATE billing_checkout_sessions
        SET status = ?, completed_at = ?, updated_at = ?
        WHERE provider_session_id = ?
      `,
      [
        event.type === "checkout.completed" ? "completed" : "open",
        event.type === "checkout.completed" ? timestamp : null,
        timestamp,
        event.providerSessionId,
      ],
    );
  }

  return result;
}

export async function cancelMysqlAccountSubscription(
  pool: Pool,
  userId: string,
  options: { providerAdapter?: BillingProviderAdapter | null } = {},
): Promise<AccountSubscriptionResponse> {
  await getMysqlBillingUserOrThrow(pool, userId);
  const row = await existingMysqlSubscriptionForUser(pool, userId);

  if (!row || normalizeSubscriptionStatus(row.status) === "none") {
    throw new InvalidSubscriptionInputError("No active subscription to cancel");
  }

  const timestamp = nowIso();
  const status = normalizeSubscriptionStatus(row.status);
  const tier = normalizeAccountTier(row.tier);
  const providerAdapter = options.providerAdapter ?? createConfiguredBillingProvider();

  const markLocalCancellation = async (providerResult?: { currentPeriodEnd?: string | null; status?: SubscriptionStatus }) => {
    const nextStatus = providerResult?.status ?? status;

    await mysqlExecute(
      pool,
      `
        UPDATE account_subscriptions
        SET status = ?, current_period_end = ?, cancel_at_period_end = 1, updated_at = ?
        WHERE id = ?
      `,
      [nextStatus, providerResult?.currentPeriodEnd ?? row.currentPeriodEnd, timestamp, row.id],
    );

    await writeMysqlSubscriptionEvent(pool, {
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

    return getMysqlAccountSubscription(pool, userId);
  };

  if (providerAdapter && normalizeSubscriptionSource(row.source) === "billing_provider") {
    if (!row.providerSubscriptionId) {
      throw new InvalidSubscriptionInputError("Provider subscription id is required to cancel subscription");
    }

    return markLocalCancellation(
      await providerAdapter.scheduleSubscriptionCancel({
        userId,
        providerSubscriptionId: row.providerSubscriptionId,
      }),
    );
  }

  return markLocalCancellation();
}

export async function reconcileMysqlSubscriptionLifecycle(
  pool: Pool,
  options: SubscriptionLifecycleReconcileOptions = {},
): Promise<SubscriptionLifecycleReconcileResult> {
  void options;
  const rows = await mysqlSelectMany<{ id: string }>(pool, "SELECT id FROM account_subscriptions");

  return {
    checked: rows.length,
    canceledAtPeriodEnd: 0,
    markedPastDue: 0,
    downgradedPastDue: 0,
    expiredTrials: 0,
  };
}
