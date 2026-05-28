import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { accountSubscriptions, subscriptionEvents } from "@/server/db/schema";
import {
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

  it("exposes the product plan catalog", () => {
    expect(listSubscriptionPlans()).toEqual([
      expect.objectContaining({ tier: "free", priceMonthlyUsd: 0 }),
      expect.objectContaining({ tier: "pro", priceMonthlyUsd: 79 }),
      expect.objectContaining({ tier: "business", priceMonthlyUsd: 249 }),
      expect.objectContaining({ tier: "enterprise", priceMonthlyUsd: null }),
    ]);
  });
});
