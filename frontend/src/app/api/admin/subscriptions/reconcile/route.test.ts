import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAuthError } from "@/server/admin/auth";
import * as adminAuth from "@/server/admin/auth";
import * as subscriptionService from "@/server/billing/subscriptions";
import { POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/auth")>();
  return { ...actual, requireAdmin: vi.fn() };
});
vi.mock("@/server/billing/subscriptions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/billing/subscriptions")>();
  return { ...actual, reconcileSubscriptionLifecycle: vi.fn() };
});

describe("POST /api/admin/subscriptions/reconcile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows admins to reconcile expired subscription access", async () => {
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

  it("denies non-admin requests", async () => {
    vi.mocked(adminAuth.requireAdmin).mockRejectedValueOnce(new AdminAuthError());

    const response = await POST(new Request("http://localhost/api/admin/subscriptions/reconcile", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});
