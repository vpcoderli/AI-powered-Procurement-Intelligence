import Stripe from "stripe";
import type { AccountTier } from "@/server/auth/entitlements";
import { isAccountTier } from "@/server/auth/entitlements";
import type { BillingProviderEvent, SubscriptionStatus } from "./subscriptions";
import { InvalidSubscriptionInputError } from "./errors";

export interface BillingCheckoutProviderRequest {
  userId: string;
  email: string;
  tier: AccountTier;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface BillingCheckoutProviderResponse {
  providerSessionId: string;
  checkoutUrl: string;
  expiresAt?: string | null;
}

export interface BillingPortalProviderRequest {
  userId: string;
  providerCustomerId: string;
  returnUrl: string;
}

export interface BillingPortalProviderResponse {
  portalUrl: string;
}

export interface BillingCancelProviderRequest {
  userId: string;
  providerSubscriptionId: string;
}

export interface BillingCancelProviderResponse {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd?: string | null;
  status?: SubscriptionStatus;
}

export interface BillingProviderAdapter {
  name: string;
  createCheckoutSession(input: BillingCheckoutProviderRequest): Promise<BillingCheckoutProviderResponse>;
  createCustomerPortalSession(input: BillingPortalProviderRequest): Promise<BillingPortalProviderResponse>;
  scheduleSubscriptionCancel(input: BillingCancelProviderRequest): Promise<BillingCancelProviderResponse>;
}

type Env = Record<string, string | undefined>;

function unixSecondsToIso(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
    return value.id;
  }
  return null;
}

function metadataValue(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeStripeSubscriptionStatus(status: unknown): SubscriptionStatus {
  if (status === "trialing" || status === "active" || status === "past_due" || status === "canceled") {
    return status;
  }
  if (status === "incomplete" || status === "incomplete_expired" || status === "unpaid") {
    return "past_due";
  }
  return "active";
}

function stripeSubscriptionFields(value: unknown) {
  if (!value || typeof value !== "object") {
    return {
      providerSubscriptionId: stringValue(value),
      status: undefined,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      metadata: null,
    };
  }

  const object = value as Record<string, unknown>;
  const firstItem = object.items &&
    typeof object.items === "object" &&
    Array.isArray((object.items as Record<string, unknown>).data)
    ? ((object.items as { data: unknown[] }).data[0] as Record<string, unknown> | undefined)
    : undefined;

  return {
    providerSubscriptionId: stringValue(object),
    status: object.status,
    currentPeriodEnd: unixSecondsToIso(object.current_period_end) ?? unixSecondsToIso(firstItem?.current_period_end),
    cancelAtPeriodEnd: object.cancel_at_period_end === true,
    metadata: object.metadata,
  };
}

function objectFromStripeEvent(stripeEvent: unknown) {
  if (!stripeEvent || typeof stripeEvent !== "object") {
    throw new InvalidSubscriptionInputError("Stripe event payload is invalid");
  }

  const event = stripeEvent as Record<string, unknown>;
  const data = event.data;

  if (!data || typeof data !== "object" || !("object" in data)) {
    throw new InvalidSubscriptionInputError("Stripe event payload is missing data.object");
  }

  return {
    id: typeof event.id === "string" ? event.id : "",
    type: typeof event.type === "string" ? event.type : "",
    object: (data as { object: Record<string, unknown> }).object,
  };
}

export function stripePriceIdForTier(tier: AccountTier, env: Env = process.env) {
  const keyByTier: Partial<Record<AccountTier, string>> = {
    pro: "STRIPE_PRICE_PRO_MONTHLY",
    business: "STRIPE_PRICE_BUSINESS_MONTHLY",
  };
  const key = keyByTier[tier];
  const priceId = key ? env[key]?.trim() : undefined;

  if (!key || !priceId) {
    throw new InvalidSubscriptionInputError(`Stripe price id is not configured for ${tier}`);
  }

  return priceId;
}

export function normalizeStripeWebhookEvent(stripeEvent: unknown): BillingProviderEvent {
  const { id, type, object } = objectFromStripeEvent(stripeEvent);

  if (!id || !type) {
    throw new InvalidSubscriptionInputError("Stripe event must include id and type");
  }

  if (type === "checkout.session.completed") {
    const subscription = stripeSubscriptionFields(object.subscription);
    const tier = metadataValue(object.metadata, "tier");

    if (!isAccountTier(tier)) {
      throw new InvalidSubscriptionInputError("Stripe checkout event must include a valid tier");
    }

    return {
      id,
      type: "checkout.completed",
      provider: "stripe",
      userId: metadataValue(object.metadata, "userId") ?? stringValue(object.client_reference_id) ?? undefined,
      email:
        typeof object.customer_details === "object" &&
        object.customer_details !== null &&
        typeof (object.customer_details as Record<string, unknown>).email === "string"
          ? (object.customer_details as Record<string, string>).email
          : undefined,
      providerCustomerId: stringValue(object.customer),
      providerSubscriptionId: subscription.providerSubscriptionId,
      providerSessionId: stringValue(object.id),
      tier,
      status: normalizeStripeSubscriptionStatus(subscription.status),
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      metadata: { stripeEventType: type },
    };
  }

  if (type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
    const subscription = stripeSubscriptionFields(object);
    const tier = metadataValue(object.metadata, "tier");
    const status = type === "customer.subscription.deleted"
      ? "canceled"
      : normalizeStripeSubscriptionStatus(object.status);

    return {
      id,
      type: type === "customer.subscription.deleted" ? "subscription.deleted" : "subscription.updated",
      provider: "stripe",
      userId: metadataValue(object.metadata, "userId") ?? undefined,
      providerCustomerId: stringValue(object.customer),
      providerSubscriptionId: stringValue(object.id),
      tier: isAccountTier(tier) ? tier : undefined,
      status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      metadata: { stripeEventType: type },
    };
  }

  if (type === "invoice.paid" || type === "invoice.payment_failed") {
    const tier = metadataValue(object.metadata, "tier");
    const paidAt = type === "invoice.paid"
      ? unixSecondsToIso(object.status_transitions && typeof object.status_transitions === "object"
        ? (object.status_transitions as Record<string, unknown>).paid_at
        : object.created)
      : null;

    return {
      id,
      type,
      provider: "stripe",
      userId: metadataValue(object.metadata, "userId") ?? undefined,
      providerCustomerId: stringValue(object.customer),
      providerSubscriptionId: stringValue(object.subscription),
      providerInvoiceId: stringValue(object.id),
      invoiceNumber: typeof object.number === "string" ? object.number : null,
      invoiceUrl: typeof object.hosted_invoice_url === "string" ? object.hosted_invoice_url : null,
      invoicePdfUrl: typeof object.invoice_pdf === "string" ? object.invoice_pdf : null,
      amountDueCents: typeof object.amount_due === "number" ? object.amount_due : 0,
      amountPaidCents: typeof object.amount_paid === "number" ? object.amount_paid : 0,
      currency: typeof object.currency === "string" ? object.currency.toUpperCase() : "USD",
      dueAt: unixSecondsToIso(object.due_date),
      paidAt,
      tier: isAccountTier(tier) ? tier : undefined,
      status: type === "invoice.payment_failed" ? "past_due" : "active",
      metadata: { stripeEventType: type },
    };
  }

  throw new InvalidSubscriptionInputError(`Unsupported Stripe event type: ${type}`);
}

function stripeApiVersion() {
  return process.env.STRIPE_API_VERSION?.trim() || undefined;
}

function stripeConfig(): ConstructorParameters<typeof Stripe>[1] | undefined {
  const apiVersion = stripeApiVersion();

  return apiVersion
    ? { apiVersion: apiVersion as NonNullable<ConstructorParameters<typeof Stripe>[1]>["apiVersion"] }
    : undefined;
}

export function constructStripeWebhookEvent(rawBody: string, signature: string, secret: string) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY?.trim() || "sk_test_placeholder", stripeConfig());

  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

const productionLikeRuntimeValues = new Set(["production", "prod"]);

function isProductionLikeRuntime(env: Env) {
  return [env.NODE_ENV, env.APP_ENV, env.DEPLOY_ENV, env.VERCEL_ENV, env.RUNTIME_ENV].some((raw) =>
    productionLikeRuntimeValues.has((raw ?? "").trim().toLowerCase()),
  );
}

/**
 * Fail-closed guard against booting the real billing provider with a Stripe test
 * key while running in a production-like environment. This runs on every
 * createStripeBillingProvider() call (checkout, portal, cancel) rather than only
 * in the opt-in CLI preflight scripts, so a misconfigured production deploy cannot
 * silently process real subscriptions against sk_test_ credentials.
 */
export function assertStripeKeyModeForRuntime(secretKey: string, env: Env = process.env) {
  const trimmed = secretKey.trim();
  if (!trimmed) return;

  if (isProductionLikeRuntime(env) && !trimmed.startsWith("sk_live_")) {
    throw new InvalidSubscriptionInputError(
      "STRIPE_SECRET_KEY must be a Stripe live mode secret key (sk_live_...) when running in a production-like environment",
    );
  }
}

export function createStripeBillingProvider(secretKey = process.env.STRIPE_SECRET_KEY): BillingProviderAdapter | null {
  if (!secretKey?.trim()) return null;

  assertStripeKeyModeForRuntime(secretKey);

  const stripe = new Stripe(secretKey, stripeConfig());

  return {
    name: "stripe",
    async createCheckoutSession(input) {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer_email: input.email,
        client_reference_id: input.userId,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        line_items: [{ price: input.priceId, quantity: 1 }],
        metadata: {
          userId: input.userId,
          tier: input.tier,
        },
        subscription_data: {
          metadata: {
            userId: input.userId,
            tier: input.tier,
          },
        },
      });

      if (!session.url) {
        throw new InvalidSubscriptionInputError("Stripe checkout session did not include a redirect URL");
      }

      return {
        providerSessionId: session.id,
        checkoutUrl: session.url,
        expiresAt: unixSecondsToIso(session.expires_at),
      };
    },
    async createCustomerPortalSession(input) {
      const session = await stripe.billingPortal.sessions.create({
        customer: input.providerCustomerId,
        return_url: input.returnUrl,
      });

      return { portalUrl: session.url };
    },
    async scheduleSubscriptionCancel(input) {
      const subscription = await stripe.subscriptions.update(input.providerSubscriptionId, {
        cancel_at_period_end: true,
      });
      const fields = stripeSubscriptionFields(subscription);

      return {
        cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
        currentPeriodEnd: fields.currentPeriodEnd,
        status: normalizeStripeSubscriptionStatus(subscription.status),
      };
    },
  };
}

export function createConfiguredBillingProvider() {
  if (process.env.BILLING_PROVIDER?.trim().toLowerCase() !== "stripe") return null;

  return createStripeBillingProvider();
}
