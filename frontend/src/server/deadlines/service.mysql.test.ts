import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeadlineReminderRow } from "./repository";

const mocks = vi.hoisted(() => {
  const fakeMysql = {
    execute: vi.fn(),
    query: vi.fn(),
  };

  return {
    fakeMysql,
    ensureMysqlUserWorkspace: vi.fn(),
    ensureUserWorkspace: vi.fn(() => {
      throw new Error("SQLite workspace should not be used in MySQL mode.");
    }),
    listOrganizationDeadlineReminderRowsFromMysql: vi.fn(),
    findOrganizationDeadlineReminderRowFromMysql: vi.fn(),
    updateOrganizationDeadlineReminderRowFromMysql: vi.fn(),
  };
});

vi.mock("@/server/db/mysql", () => ({
  isMysqlDatabaseUrlConfigured: vi.fn(() => true),
  resolveMysqlPool: vi.fn(() => mocks.fakeMysql),
}));

vi.mock("@/server/account/mysql-workspace", () => ({
  ensureMysqlUserWorkspace: mocks.ensureMysqlUserWorkspace,
}));

vi.mock("@/server/account/workspace", () => ({
  ensureUserWorkspace: mocks.ensureUserWorkspace,
}));

vi.mock("./repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./repository")>();

  return {
    ...actual,
    listOrganizationDeadlineReminderRowsFromMysql: mocks.listOrganizationDeadlineReminderRowsFromMysql,
    findOrganizationDeadlineReminderRowFromMysql: mocks.findOrganizationDeadlineReminderRowFromMysql,
    updateOrganizationDeadlineReminderRowFromMysql: mocks.updateOrganizationDeadlineReminderRowFromMysql,
  };
});

const reminderRow: DeadlineReminderRow = {
  id: "deadline_reminder_1",
  organizationId: "org_1",
  userId: "user_1",
  intentId: "intent_1",
  bidId: "bid_1",
  kind: "bid_deadline",
  linkedObjectType: "bid",
  linkedObjectId: "bid_1",
  dedupeKey: "org_1:intent_1:bid_deadline:bid:bid_1",
  title: "Bid deadline: Enterprise Cloud Migration Services",
  dueAt: "2026-06-15",
  reminderAt: "2026-06-13T00:00:00.000Z",
  status: "active",
  priority: "high",
  source: "generated",
  metadataJson: "{}",
  acknowledgedAt: null,
  snoozedUntil: null,
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:00.000Z",
};

describe("deadline notification service with MySQL runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureMysqlUserWorkspace.mockResolvedValue({
      organizationId: "org_1",
      organizationName: "Acme Workspace",
      role: "owner",
      tier: "business",
    });
    mocks.listOrganizationDeadlineReminderRowsFromMysql.mockResolvedValue([reminderRow]);
    mocks.findOrganizationDeadlineReminderRowFromMysql.mockResolvedValue(reminderRow);
    mocks.updateOrganizationDeadlineReminderRowFromMysql.mockResolvedValue(undefined);
  });

  it("lists account reminders from the MySQL workspace", async () => {
    const { getAccountDeadlineReminderCenter } = await import("./service");

    const center = await getAccountDeadlineReminderCenter({} as never, "user_1", {
      now: "2026-06-08T00:00:00.000Z",
    });

    expect(center.organizationId).toBe("org_1");
    expect(center.summary).toMatchObject({ total: 1, active: 1 });
    expect(center.reminders[0]).toMatchObject({ id: "deadline_reminder_1", status: "active" });
    expect(mocks.ensureMysqlUserWorkspace).toHaveBeenCalledWith(mocks.fakeMysql, "user_1");
    expect(mocks.listOrganizationDeadlineReminderRowsFromMysql).toHaveBeenCalledWith(mocks.fakeMysql, "org_1");
    expect(mocks.ensureUserWorkspace).not.toHaveBeenCalled();
  });

  it("updates account reminders through the MySQL repository", async () => {
    const { acknowledgeAccountDeadlineReminder } = await import("./service");

    await acknowledgeAccountDeadlineReminder({} as never, "user_1", {
      reminderId: "deadline_reminder_1",
      now: "2026-06-08T01:00:00.000Z",
    });

    expect(mocks.findOrganizationDeadlineReminderRowFromMysql).toHaveBeenCalledWith(
      mocks.fakeMysql,
      "org_1",
      "deadline_reminder_1",
    );
    expect(mocks.updateOrganizationDeadlineReminderRowFromMysql).toHaveBeenCalledWith(
      mocks.fakeMysql,
      "org_1",
      "deadline_reminder_1",
      {
        status: "acknowledged",
        acknowledgedAt: "2026-06-08T01:00:00.000Z",
        snoozedUntil: null,
        updatedAt: "2026-06-08T01:00:00.000Z",
      },
    );
    expect(mocks.ensureUserWorkspace).not.toHaveBeenCalled();
  });
});
