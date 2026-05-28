import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { accountSubscriptions, billingCheckoutSessions, billingInvoices, subscriptionEvents } from "@/server/db/schema";
import type { BillingProviderAdapter } from "./providers";
import {
  applyBillingProviderEvent,
  cancelAccountSubscription,
  createCheckoutSession,
  createCustomerPortalSession,
  InvalidSubscriptionInputError,
  getAccountSubscription,
  listAccountInvoices,
  listSubscriptionPlans,
  reconcileSubscriptionLifecycle,
  reconcileUserSubscriptionLifecycle,
  upsertAccountSubscription,
} from "./subscriptions";

describe("billing subscriptions service", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(users).values({
      id: "user_buyer",
      email: "buyer@example.com",
      displayName: "Buyer",
      role: "user",
      accountTier: "free",
      isDisabled: 0,
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z",
    }).run();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await testDb.cleanup();
  });

  it("returns a default subscription view for users without provider records", () => {
    const result = getAccountSubscription(testDb.db, "user_buyer");

    expect(result.subscription).toMatchObject({
      userId: "user_buyer",
      tier: "free",
      status: "none",
      source: "admin_override",
      cancelAtPeriodEnd: false,
    });
    expect(result.plans.map((plan) => plan.tier)).toEqual(["free", "pro", "business", "enterprise"]);
  });

  it("updates effective tier and writes a subscription event", () => {
    const result = upsertAccountSubscription(testDb.db, "user_buyer", {
      tier: "pro",
      status: "active",
      source: "local_checkout",
      currentPeriodEnd: "2026-06-28T00:00:00.000Z",
    });

    expect(result.subscription).toMatchObject({
      userId: "user_buyer",
      tier: "pro",
      status: "active",
      source: "local_checkout",
      currentPeriodEnd: "2026-06-28T00:00:00.000Z",
    });
    expect(
      testDb.db.select().from(users).where(eq(users.id, "user_buyer")).limit(1).get()?.accountTier,
    ).toBe("pro");
    expect(testDb.db.select().from(accountSubscriptions).all()).toHaveLength(1);
    expect(testDb.db.select().from(subscriptionEvents).all()).toEqual([
      expect.objectContaining({
        userId: "user_buyer",
        eventType: "subscription_updated",
        providerEventId: null,
        fromTier: "free",
        toTier: "pro",
        fromStatus: "none",
        toStatus: "active",
      }),
    ]);
  });

  it("rejects missing users", () => {
    expect(() => getAccountSubscription(testDb.db, "missing_user")).toThrow(InvalidSubscriptionInputError);
  });

  it("creates a local checkout session for a paid self-service plan", () => {
    const result = createCheckoutSession(testDb.db, "user_buyer", {
      tier: "pro",
      origin: "http://localhost:3000",
    });

    expect(result.checkoutSession).toMatchObject({
      userId: "user_buyer",
      tier: "pro",
      status: "open",
      provider: "local_checkout",
    });
    expect(result.checkoutSession.checkoutUrl).toContain("/settings?checkoutSession=");
    expect(testDb.db.select().from(billingCheckoutSessions).all()).toEqual([
      expect.objectContaining({
        userId: "user_buyer",
        tier: "pro",
        status: "open",
      }),
    ]);
    expect(testDb.db.select().from(subscriptionEvents).all()).toEqual([
      expect.objectContaining({
        userId: "user_buyer",
        eventType: "checkout_started",
        source: "local_checkout",
      }),
    ]);
  });

  it("rejects checkout sessions for free and enterprise plans", () => {
    expect(() => createCheckoutSession(testDb.db, "user_buyer", { tier: "free" })).toThrow(
      InvalidSubscriptionInputError,
    );
    expect(() => createCheckoutSession(testDb.db, "user_buyer", { tier: "enterprise" })).toThrow(
      InvalidSubscriptionInputError,
    );
  });

  it("uses the configured hosted checkout template for production providers", () => {
    vi.stubEnv("BILLING_PROVIDER", "stripe");
    vi.stubEnv(
      "BILLING_CHECKOUT_URL_TEMPLATE",
      "https://billing.example.test/checkout?session={providerSessionId}&tier={tier}&user={userId}&success={successUrl}&cancel={cancelUrl}",
    );

    const result = createCheckoutSession(testDb.db, "user_buyer", {
      tier: "business",
      origin: "http://localhost:3000",
    });

    expect(result.checkoutSession).toMatchObject({
      provider: "billing_provider",
      tier: "business",
      status: "open",
    });
    expect(result.checkoutSession.checkoutUrl).toContain("https://billing.example.test/checkout");
    expect(result.checkoutSession.checkoutUrl).toContain("tier=business");
    expect(result.checkoutSession.checkoutUrl).toContain("user=user_buyer");
    expect(result.checkoutSession.checkoutUrl).toContain(encodeURIComponent("http://localhost:3000/settings"));
  });

  it("creates checkout through a real provider adapter when one is configured", async () => {
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_pro_monthly");
    const providerAdapter: BillingProviderAdapter = {
      name: "stripe",
      createCheckoutSession: vi.fn().mockResolvedValue({
        providerSessionId: "cs_test_123",
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123",
        expiresAt: "2026-05-28T01:00:00.000Z",
      }),
      createCustomerPortalSession: vi.fn(),
      scheduleSubscriptionCancel: vi.fn(),
    };

    const result = await createCheckoutSession(testDb.db, "user_buyer", {
      tier: "pro",
      origin: "http://localhost:3000",
      providerAdapter,
    });

    expect(providerAdapter.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_buyer",
        email: "buyer@example.com",
        tier: "pro",
        priceId: "price_pro_monthly",
        successUrl: expect.stringContaining("checkout=success"),
        cancelUrl: "http://localhost:3000/settings?checkout=cancel",
      }),
    );
    expect(result.checkoutSession).toMatchObject({
      provider: "billing_provider",
      providerSessionId: "cs_test_123",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123",
      expiresAt: "2026-05-28T01:00:00.000Z",
    });
    expect(testDb.db.select().from(subscriptionEvents).all()).toEqual([
      expect.objectContaining({
        eventType: "checkout_started",
        source: "billing_provider",
      }),
    ]);
  });

  it("creates a customer portal session from provider customer state", () => {
    vi.stubEnv("BILLING_PROVIDER", "stripe");
    vi.stubEnv(
      "BILLING_CUSTOMER_PORTAL_URL_TEMPLATE",
      "https://billing.example.test/portal?customer={providerCustomerId}&return={returnUrl}",
    );
    upsertAccountSubscription(testDb.db, "user_buyer", {
      tier: "pro",
      status: "active",
      source: "billing_provider",
      provider: "stripe",
      providerCustomerId: "cus_123",
      providerSubscriptionId: "sub_123",
      currentPeriodEnd: "2026-06-28T00:00:00.000Z",
    });

    const result = createCustomerPortalSession(testDb.db, "user_buyer", {
      origin: "http://localhost:3000",
    });

    expect(result.portalSession).toMatchObject({
      userId: "user_buyer",
      provider: "billing_provider",
    });
    expect(result.portalSession.portalUrl).toContain("https://billing.example.test/portal");
    expect(result.portalSession.portalUrl).toContain("customer=cus_123");
    expect(result.portalSession.portalUrl).toContain(encodeURIComponent("http://localhost:3000/settings"));
  });

  it("creates customer portal through a real provider adapter when one is configured", async () => {
    upsertAccountSubscription(testDb.db, "user_buyer", {
      tier: "business",
      status: "active",
      source: "billing_provider",
      provider: "stripe",
      providerCustomerId: "cus_123",
      providerSubscriptionId: "sub_123",
      currentPeriodEnd: "2026-06-28T00:00:00.000Z",
    });
    const providerAdapter: BillingProviderAdapter = {
      name: "stripe",
      createCheckoutSession: vi.fn(),
      createCustomerPortalSession: vi.fn().mockResolvedValue({
        portalUrl: "https://billing.stripe.com/session/bps_123",
      }),
      scheduleSubscriptionCancel: vi.fn(),
    };

    const result = await createCustomerPortalSession(testDb.db, "user_buyer", {
      origin: "http://localhost:3000",
      providerAdapter,
    });

    expect(providerAdapter.createCustomerPortalSession).toHaveBeenCalledWith({
      userId: "user_buyer",
      providerCustomerId: "cus_123",
      returnUrl: "http://localhost:3000/settings",
    });
    expect(result.portalSession).toMatchObject({
      provider: "billing_provider",
      portalUrl: "https://billing.stripe.com/session/bps_123",
    });
  });

  it("syncs a provider checkout completion into the subscription tier", () => {
    const checkout = createCheckoutSession(testDb.db, "user_buyer", { tier: "business" }).checkoutSession;

    const result = applyBillingProviderEvent(testDb.db, {
      id: "evt_checkout_completed_1",
      type: "checkout.completed",
      provider: "local",
      userId: "user_buyer",
      providerCustomerId: "cus_123",
      providerSubscriptionId: "sub_123",
      providerSessionId: checkout.providerSessionId,
      tier: "business",
      status: "active",
      currentPeriodEnd: "2026-06-28T00:00:00.000Z",
    });

    expect(result.subscription).toMatchObject({
      tier: "business",
      status: "active",
      source: "billing_provider",
      currentPeriodEnd: "2026-06-28T00:00:00.000Z",
    });
    expect(
      testDb.db.select().from(users).where(eq(users.id, "user_buyer")).limit(1).get()?.accountTier,
    ).toBe("business");
    expect(
      testDb.db
        .select()
        .from(billingCheckoutSessions)
        .where(eq(billingCheckoutSessions.id, checkout.id))
        .limit(1)
        .get(),
    ).toEqual(expect.objectContaining({ status: "completed" }));
    expect(testDb.db.select().from(subscriptionEvents).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerEventId: "evt_checkout_completed_1",
          eventType: "checkout.completed",
          fromTier: "free",
          toTier: "business",
        }),
      ]),
    );
  });

  it("ignores duplicate provider events", () => {
    const event = {
      id: "evt_subscription_updated_1",
      type: "subscription.updated" as const,
      provider: "stripe",
      userId: "user_buyer",
      providerCustomerId: "cus_123",
      providerSubscriptionId: "sub_123",
      tier: "pro" as const,
      status: "active" as const,
      currentPeriodEnd: "2026-06-28T00:00:00.000Z",
    };

    applyBillingProviderEvent(testDb.db, event);
    applyBillingProviderEvent(testDb.db, event);

    expect(
      testDb.db
        .select()
        .from(subscriptionEvents)
        .where(eq(subscriptionEvents.providerEventId, "evt_subscription_updated_1"))
        .all(),
    ).toHaveLength(1);
  });

  it("stores paid provider invoices and exposes them in billing history", () => {
    upsertAccountSubscription(testDb.db, "user_buyer", {
      tier: "pro",
      status: "active",
      source: "local_checkout",
      provider: "stripe",
      providerCustomerId: "cus_123",
      providerSubscriptionId: "sub_123",
      currentPeriodEnd: "2026-06-28T00:00:00.000Z",
    });

    applyBillingProviderEvent(testDb.db, {
      id: "evt_invoice_paid_1",
      type: "invoice.paid",
      provider: "stripe",
      providerCustomerId: "cus_123",
      providerSubscriptionId: "sub_123",
      providerInvoiceId: "in_123",
      invoiceNumber: "WIN-1001",
      invoiceUrl: "https://billing.example.test/invoices/in_123",
      invoicePdfUrl: "https://billing.example.test/invoices/in_123.pdf",
      amountDueCents: 7900,
      amountPaidCents: 7900,
      currency: "USD",
      status: "active",
      paidAt: "2026-05-28T00:00:00.000Z",
      dueAt: "2026-05-28T00:00:00.000Z",
    });

    expect(testDb.db.select().from(billingInvoices).all()).toEqual([
      expect.objectContaining({
        userId: "user_buyer",
        providerInvoiceId: "in_123",
        invoiceNumber: "WIN-1001",
        status: "paid",
        amountPaidCents: 7900,
      }),
    ]);
    expect(listAccountInvoices(testDb.db, "user_buyer")).toEqual({
      invoices: [
        expect.objectContaining({
          invoiceNumber: "WIN-1001",
          status: "paid",
          amountPaidCents: 7900,
          invoiceUrl: "https://billing.example.test/invoices/in_123",
        }),
      ],
    });
  });

  it("updates invoice history and subscription state for failed invoice payments", () => {
    upsertAccountSubscription(testDb.db, "user_buyer", {
      tier: "business",
      status: "active",
      source: "local_checkout",
      provider: "stripe",
      providerCustomerId: "cus_123",
      providerSubscriptionId: "sub_123",
      currentPeriodEnd: "2026-06-28T00:00:00.000Z",
    });

    const result = applyBillingProviderEvent(testDb.db, {
      id: "evt_invoice_failed_1",
      type: "invoice.payment_failed",
      provider: "stripe",
      providerCustomerId: "cus_123",
      providerSubscriptionId: "sub_123",
      providerInvoiceId: "in_failed",
      invoiceNumber: "WIN-1002",
      amountDueCents: 24900,
      amountPaidCents: 0,
      currency: "USD",
      status: "past_due",
      dueAt: "2026-05-28T00:00:00.000Z",
    });

    expect(result.subscription).toMatchObject({
      tier: "business",
      status: "past_due",
    });
    expect(listAccountInvoices(testDb.db, "user_buyer").invoices).toEqual([
      expect.objectContaining({
        invoiceNumber: "WIN-1002",
        status: "payment_failed",
        amountDueCents: 24900,
      }),
    ]);
  });

  it("marks a subscription to cancel at period end", () => {
    upsertAccountSubscription(testDb.db, "user_buyer", {
      tier: "pro",
      status: "active",
      source: "local_checkout",
      currentPeriodEnd: "2026-06-28T00:00:00.000Z",
    });

    const result = cancelAccountSubscription(testDb.db, "user_buyer");

    expect(result.subscription).toMatchObject({
      tier: "pro",
      status: "active",
      cancelAtPeriodEnd: true,
    });
    expect(testDb.db.select().from(subscriptionEvents).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: "user_buyer",
          eventType: "subscription_cancel_scheduled",
          toStatus: "active",
        }),
      ]),
    );
  });

  it("schedules provider-side cancellation before marking local subscription canceling", async () => {
    upsertAccountSubscription(testDb.db, "user_buyer", {
      tier: "pro",
      status: "active",
      source: "billing_provider",
      provider: "stripe",
      providerCustomerId: "cus_123",
      providerSubscriptionId: "sub_123",
      currentPeriodEnd: "2026-06-28T00:00:00.000Z",
    });
    const providerAdapter: BillingProviderAdapter = {
      name: "stripe",
      createCheckoutSession: vi.fn(),
      createCustomerPortalSession: vi.fn(),
      scheduleSubscriptionCancel: vi.fn().mockResolvedValue({
        cancelAtPeriodEnd: true,
        currentPeriodEnd: "2026-06-28T00:00:00.000Z",
      }),
    };

    const result = await cancelAccountSubscription(testDb.db, "user_buyer", { providerAdapter });

    expect(providerAdapter.scheduleSubscriptionCancel).toHaveBeenCalledWith({
      userId: "user_buyer",
      providerSubscriptionId: "sub_123",
    });
    expect(result.subscription).toMatchObject({
      tier: "pro",
      status: "active",
      cancelAtPeriodEnd: true,
    });
  });

  it("cancels subscriptions scheduled to end after the paid period expires", () => {
    upsertAccountSubscription(testDb.db, "user_buyer", {
      tier: "pro",
      status: "active",
      source: "local_checkout",
      currentPeriodEnd: "2026-05-20T00:00:00.000Z",
      cancelAtPeriodEnd: true,
    });

    const result = reconcileSubscriptionLifecycle(testDb.db, {
      now: "2026-05-28T00:00:00.000Z",
    });

    expect(result).toMatchObject({
      checked: 1,
      canceledAtPeriodEnd: 1,
      markedPastDue: 0,
      downgradedPastDue: 0,
      expiredTrials: 0,
    });
    expect(getAccountSubscription(testDb.db, "user_buyer").subscription).toMatchObject({
      tier: "free",
      status: "canceled",
      cancelAtPeriodEnd: false,
    });
    expect(testDb.db.select().from(users).where(eq(users.id, "user_buyer")).get()?.accountTier).toBe("free");
    expect(testDb.db.select().from(subscriptionEvents).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "subscription_canceled_at_period_end",
          fromTier: "pro",
          toTier: "free",
          fromStatus: "active",
          toStatus: "canceled",
        }),
      ]),
    );
  });

  it("marks expired active subscriptions past due while keeping paid access during grace", () => {
    upsertAccountSubscription(testDb.db, "user_buyer", {
      tier: "business",
      status: "active",
      source: "billing_provider",
      currentPeriodEnd: "2026-05-27T00:00:00.000Z",
      provider: "stripe",
      providerCustomerId: "cus_123",
      providerSubscriptionId: "sub_123",
    });

    const result = reconcileUserSubscriptionLifecycle(testDb.db, "user_buyer", {
      now: "2026-05-28T00:00:00.000Z",
    });

    expect(result).toMatchObject({
      checked: 1,
      markedPastDue: 1,
      downgradedPastDue: 0,
    });
    expect(getAccountSubscription(testDb.db, "user_buyer").subscription).toMatchObject({
      tier: "business",
      status: "past_due",
    });
    expect(testDb.db.select().from(users).where(eq(users.id, "user_buyer")).get()?.accountTier).toBe("business");
  });

  it("downgrades past due subscriptions after the grace period", () => {
    upsertAccountSubscription(testDb.db, "user_buyer", {
      tier: "business",
      status: "past_due",
      source: "billing_provider",
      currentPeriodEnd: "2026-05-20T00:00:00.000Z",
      provider: "stripe",
      providerCustomerId: "cus_123",
      providerSubscriptionId: "sub_123",
    });

    const result = reconcileSubscriptionLifecycle(testDb.db, {
      now: "2026-05-28T00:00:00.000Z",
      pastDueGraceDays: 7,
    });

    expect(result).toMatchObject({
      checked: 1,
      downgradedPastDue: 1,
    });
    expect(getAccountSubscription(testDb.db, "user_buyer").subscription).toMatchObject({
      tier: "free",
      status: "canceled",
    });
    expect(testDb.db.select().from(users).where(eq(users.id, "user_buyer")).get()?.accountTier).toBe("free");
  });

  it("expires trialing subscriptions and removes paid access", () => {
    upsertAccountSubscription(testDb.db, "user_buyer", {
      tier: "pro",
      status: "trialing",
      source: "billing_provider",
      currentPeriodEnd: "2026-05-20T00:00:00.000Z",
      provider: "stripe",
      providerCustomerId: "cus_123",
      providerSubscriptionId: "sub_123",
    });

    const result = reconcileSubscriptionLifecycle(testDb.db, {
      now: "2026-05-28T00:00:00.000Z",
    });

    expect(result).toMatchObject({
      checked: 1,
      expiredTrials: 1,
    });
    expect(getAccountSubscription(testDb.db, "user_buyer").subscription).toMatchObject({
      tier: "free",
      status: "canceled",
    });
  });

  it("exposes the product plan catalog", () => {
    expect(listSubscriptionPlans()).toEqual([
      expect.objectContaining({ tier: "free", priceMonthlyUsd: 0 }),
      expect.objectContaining({ tier: "pro", priceMonthlyUsd: 79 }),
      expect.objectContaining({ tier: "business", priceMonthlyUsd: 249 }),
      expect.objectContaining({ tier: "enterprise", priceMonthlyUsd: null }),
    ]);
  });
});
