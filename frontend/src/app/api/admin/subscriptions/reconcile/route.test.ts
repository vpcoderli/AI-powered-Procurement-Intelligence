import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAuthError } from "@/server/admin/auth";
import * as adminAuth from "@/server/admin/auth";
import * as mysqlRuntime from "@/server/db/mysql";
import * as mysqlSubscriptionService from "@/server/billing/mysql-subscriptions";
import * as subscriptionService from "@/server/billing/subscriptions";
import { POST } from "./route";

const dbMockState = vi.hoisted(() => ({ throwOnThen: false }));

vi.mock("@/server/db/client", () => ({
  db: new Proxy({}, {
    get(target, property) {
      if (dbMockState.throwOnThen && property === "then") {
        throw new Error("db.then should not be touched in MySQL mode");
      }

      return Reflect.get(target, property);
    },
  }),
}));
vi.mock("@/server/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/auth")>();
  return { ...actual, requireAdmin: vi.fn() };
});
vi.mock("@/server/billing/subscriptions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/billing/subscriptions")>();
  return { ...actual, reconcileSubscriptionLifecycle: vi.fn() };
});
vi.mock("@/server/db/mysql", () => ({
  isMysqlDatabaseUrlConfigured: vi.fn(() => false),
  resolveMysqlPool: vi.fn(),
}));
vi.mock("@/server/billing/mysql-subscriptions", () => ({
  reconcileMysqlSubscriptionLifecycle: vi.fn(),
}));

describe("POST /api/admin/subscriptions/reconcile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMockState.throwOnThen = false;
    vi.mocked(mysqlRuntime.isMysqlDatabaseUrlConfigured).mockReturnValue(false);
  });

  it("allows admins to reconcile expired subscription access", async () => {
    vi.mocked(mysqlRuntime.isMysqlDatabaseUrlConfigured).mockReturnValueOnce(false);
    vi.mocked(adminAuth.requireAdmin).mockResolvedValueOnce({ kind: "admin", userId: "admin_1" });
    vi.mocked(subscriptionService.reconcileSubscriptionLifecycle).mockReturnValueOnce({
      checked: 4,
      canceledAtPeriodEnd: 1,
      markedPastDue: 1,
      downgradedPastDue: 1,
      expiredTrials: 1,
    });

    const response = await POST(
      new Request("http://localhost/api/admin/subscriptions/reconcile", {
        method: "POST",
        body: JSON.stringify({ pastDueGraceDays: 10 }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      checked: 4,
      canceledAtPeriodEnd: 1,
      markedPastDue: 1,
      downgradedPastDue: 1,
      expiredTrials: 1,
    });
    expect(subscriptionService.reconcileSubscriptionLifecycle).toHaveBeenCalledWith({}, {
      pastDueGraceDays: 10,
    });
  });

  it("uses the MySQL subscription reconciler when MySQL runtime is configured", async () => {
    const mysql = { query: vi.fn() };
    dbMockState.throwOnThen = true;
    vi.mocked(mysqlRuntime.isMysqlDatabaseUrlConfigured).mockReturnValue(true);
    vi.mocked(mysqlRuntime.resolveMysqlPool).mockReturnValueOnce(mysql as never);
    vi.mocked(adminAuth.requireAdmin).mockResolvedValueOnce({ kind: "admin", userId: "admin_1" });
    vi.mocked(mysqlSubscriptionService.reconcileMysqlSubscriptionLifecycle).mockResolvedValueOnce({
      checked: 3,
      canceledAtPeriodEnd: 1,
      markedPastDue: 0,
      downgradedPastDue: 1,
      expiredTrials: 1,
    });

    const response = await POST(
      new Request("http://localhost/api/admin/subscriptions/reconcile", {
        method: "POST",
        body: JSON.stringify({ pastDueGraceDays: 14 }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.checked).toBe(3);
    expect(mysqlSubscriptionService.reconcileMysqlSubscriptionLifecycle).toHaveBeenCalledWith(mysql, {
      pastDueGraceDays: 14,
    });
    expect(subscriptionService.reconcileSubscriptionLifecycle).not.toHaveBeenCalled();
  });

  it("denies non-admin requests", async () => {
    vi.mocked(adminAuth.requireAdmin).mockRejectedValueOnce(new AdminAuthError());

    const response = await POST(new Request("http://localhost/api/admin/subscriptions/reconcile", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});
