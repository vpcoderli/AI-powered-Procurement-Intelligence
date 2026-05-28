import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { accountSubscriptions, billingCheckoutSessions, subscriptionEvents } from "@/server/db/schema";
import {
  applyBillingProviderEvent,
  cancelAccountSubscription,
  createCheckoutSession,
  InvalidSubscriptionInputError,
  getAccountSubscription,
  listSubscriptionPlans,
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

  it("exposes the product plan catalog", () => {
    expect(listSubscriptionPlans()).toEqual([
      expect.objectContaining({ tier: "free", priceMonthlyUsd: 0 }),
      expect.objectContaining({ tier: "pro", priceMonthlyUsd: 79 }),
      expect.objectContaining({ tier: "business", priceMonthlyUsd: 249 }),
      expect.objectContaining({ tier: "enterprise", priceMonthlyUsd: null }),
    ]);
  });
});
