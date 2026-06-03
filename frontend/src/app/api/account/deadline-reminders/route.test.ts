import { describe, expect, it, vi } from "vitest";
import type { AccountDeadlineReminderCenter } from "@/server/deadlines/types";
import * as deadlineService from "@/server/deadlines/service";

vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(async () => ({
    kind: "authenticated",
    userId: "user_1",
    role: "user",
    tier: "business",
    features: ["deadline_notifications"],
  })),
}));

vi.mock("@/server/db/client", () => ({ db: {} }));

vi.mock("@/server/deadlines/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/deadlines/service")>();

  return {
    ...actual,
    acknowledgeAccountDeadlineReminder: vi.fn(),
    getAccountDeadlineReminderCenter: vi.fn(),
    snoozeAccountDeadlineReminder: vi.fn(),
  };
});

const center: AccountDeadlineReminderCenter = {
  organizationId: "org_1",
  summary: {
    total: 1,
    active: 1,
    dueSoon: 1,
    overdue: 0,
    acknowledged: 0,
    snoozed: 0,
  },
  reminders: [
    {
      id: "deadline_reminder_1",
      organizationId: "org_1",
      userId: "user_1",
      intentId: "intent_1",
      bidId: "bid_1",
      kind: "bid_deadline",
      linkedObjectType: "bid",
      linkedObjectId: "bid_1",
      title: "Bid deadline: Cloud migration",
      dueAt: "2026-06-15",
      reminderAt: "2026-06-13T00:00:00.000Z",
      status: "active",
      priority: "high",
      source: "generated",
      metadata: {},
      acknowledgedAt: null,
      snoozedUntil: null,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
  ],
};

describe("GET /api/account/deadline-reminders", () => {
  it("returns the account reminder center for users with deadline notification access", async () => {
    vi.mocked(deadlineService.getAccountDeadlineReminderCenter).mockResolvedValueOnce(center);
    const { GET } = await import("./route");

    const response = await GET(new Request("http://localhost/api/account/deadline-reminders"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.center).toEqual(center);
    expect(deadlineService.getAccountDeadlineReminderCenter).toHaveBeenCalledWith({}, "user_1");
  });

  it("returns FEATURE_NOT_AVAILABLE below Business", async () => {
    const principal = await import("@/server/auth/principal");
    vi.mocked(principal.resolvePrincipal).mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "pro",
      features: [],
    });
    const { GET } = await import("./route");

    const response = await GET(new Request("http://localhost/api/account/deadline-reminders"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FEATURE_NOT_AVAILABLE");
    expect(body.error.feature).toBe("deadline_notifications");
  });
});

describe("PATCH /api/account/deadline-reminders", () => {
  it("acknowledges a reminder", async () => {
    vi.mocked(deadlineService.acknowledgeAccountDeadlineReminder).mockResolvedValueOnce({
      ...center,
      summary: { ...center.summary, active: 0, acknowledged: 1 },
      reminders: [{ ...center.reminders[0], status: "acknowledged" }],
    });
    const { PATCH } = await import("./route");

    const response = await PATCH(new Request("http://localhost/api/account/deadline-reminders", {
      method: "PATCH",
      body: JSON.stringify({ reminderId: "deadline_reminder_1", action: "acknowledge" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.center.summary.acknowledged).toBe(1);
    expect(deadlineService.acknowledgeAccountDeadlineReminder).toHaveBeenCalledWith({}, "user_1", {
      reminderId: "deadline_reminder_1",
    });
  });
});
