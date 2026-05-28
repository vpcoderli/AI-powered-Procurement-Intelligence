import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAuthError } from "@/server/admin/auth";
import * as adminAuth from "@/server/admin/auth";
import * as outboxRepository from "@/server/notifications/outbox-repository";
import { GET } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/auth")>();
  return { ...actual, requireAdmin: vi.fn() };
});
vi.mock("@/server/notifications/outbox-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/notifications/outbox-repository")>();
  return { ...actual, listRecentNotifications: vi.fn() };
});

describe("GET /api/admin/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows admins to inspect recent notification outbox rows", async () => {
    vi.mocked(adminAuth.requireAdmin).mockResolvedValueOnce({ kind: "admin", userId: "admin_1" });
    vi.mocked(outboxRepository.listRecentNotifications).mockReturnValueOnce([
      {
        id: "notification_1",
        alertId: "workspace_invite:invite_1",
        userId: "user_1",
        channel: "email",
        recipient: "buyer@example.com",
        frequency: "daily",
        dedupeKey: "workspace_invite:invite_1:token",
        subject: "Invite",
        bodyText: "Accept invite",
        matchedBidIds: [],
        status: "failed",
        attemptCount: 2,
        lastError: "Provider unavailable",
        createdAt: "2026-05-28T00:00:00.000Z",
        sentAt: null,
      },
    ]);

    const response = await GET(new Request("http://localhost/api/admin/notifications?limit=10&status=failed"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.notifications).toHaveLength(1);
    expect(outboxRepository.listRecentNotifications).toHaveBeenCalledWith({}, {
      limit: 10,
      status: "failed",
    });
  });

  it("denies non-admin requests", async () => {
    vi.mocked(adminAuth.requireAdmin).mockRejectedValueOnce(new AdminAuthError());

    const response = await GET(new Request("http://localhost/api/admin/notifications"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});
