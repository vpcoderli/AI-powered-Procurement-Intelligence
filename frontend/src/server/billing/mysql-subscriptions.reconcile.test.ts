import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncOwnedMysqlWorkspaceTier } from "@/server/account/mysql-workspace";
import { reconcileMysqlSubscriptionLifecycle } from "./mysql-subscriptions";

vi.mock("@/server/account/mysql-workspace", () => ({
  syncOwnedMysqlWorkspaceTier: vi.fn(),
}));

describe("reconcileMysqlSubscriptionLifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies the same lifecycle transitions as the SQLite reconciler", async () => {
    const rows = [
      {
        id: "sub_trial",
        userId: "user_trial",
        tier: "pro",
        status: "trialing",
        source: "local_checkout",
        provider: null,
        providerCustomerId: null,
        providerSubscriptionId: null,
        currentPeriodEnd: "2026-05-01T00:00:00.000Z",
        cancelAtPeriodEnd: 0,
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
      },
      {
        id: "sub_cancel",
        userId: "user_cancel",
        tier: "business",
        status: "active",
        source: "billing_provider",
        provider: "stripe",
        providerCustomerId: "cus_1",
        providerSubscriptionId: "sub_provider_cancel",
        currentPeriodEnd: "2026-05-15T00:00:00.000Z",
        cancelAtPeriodEnd: 1,
        createdAt: "2026-04-15T00:00:00.000Z",
        updatedAt: "2026-04-15T00:00:00.000Z",
      },
      {
        id: "sub_past_due",
        userId: "user_past_due",
        tier: "pro",
        status: "past_due",
        source: "billing_provider",
        provider: "stripe",
        providerCustomerId: "cus_2",
        providerSubscriptionId: "sub_provider_past_due",
        currentPeriodEnd: "2026-05-20T00:00:00.000Z",
        cancelAtPeriodEnd: 0,
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z",
      },
      {
        id: "sub_active",
        userId: "user_active",
        tier: "business",
        status: "active",
        source: "billing_provider",
        provider: "stripe",
        providerCustomerId: "cus_3",
        providerSubscriptionId: "sub_provider_active",
        currentPeriodEnd: "2026-05-31T00:00:00.000Z",
        cancelAtPeriodEnd: 0,
        createdAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T00:00:00.000Z",
      },
    ];
    const mysql = {
      query: vi.fn(async () => [rows, undefined]),
      execute: vi.fn(async () => [{ affectedRows: 1, insertId: 0 }, undefined]),
    };

    const result = await reconcileMysqlSubscriptionLifecycle(mysql as never, {
      now: "2026-06-03T00:00:00.000Z",
      pastDueGraceDays: 7,
    });

    expect(result).toEqual({
      checked: 4,
      canceledAtPeriodEnd: 1,
      markedPastDue: 1,
      downgradedPastDue: 1,
      expiredTrials: 1,
    });
    expect(syncOwnedMysqlWorkspaceTier).toHaveBeenCalledTimes(4);
    expect(mysql.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE account_subscriptions"),
      expect.arrayContaining(["free", "canceled", "2026-06-03T00:00:00.000Z", "sub_trial"]),
    );
    expect(mysql.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE account_subscriptions"),
      expect.arrayContaining(["business", "past_due", "2026-06-03T00:00:00.000Z", "sub_active"]),
    );
    expect(mysql.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO subscription_events"),
      expect.arrayContaining(["subscription_downgraded_past_due"]),
    );
  });
});
