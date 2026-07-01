import { describe, expect, it, vi } from "vitest";
import {
  findOrganizationDeadlineReminderRowFromMysql,
  listOrganizationDeadlineReminderRowsFromMysql,
  updateOrganizationDeadlineReminderRowFromMysql,
} from "./repository";

describe("deadline reminder MySQL repository", () => {
  it("lists organization reminders from MySQL in due date order", async () => {
    const query = vi.fn(async () => [[
      {
        id: "deadline_reminder_1",
        organizationId: "org_1",
        userId: "user_1",
        intentId: "intent_1",
        bidId: "bid_1",
        kind: "bid_deadline",
        linkedObjectType: "bid",
        linkedObjectId: "bid_1",
        dedupeKey: "org_1:intent_1:bid_deadline:bid:bid_1",
        title: "Bid deadline",
        dueAt: "2026-06-15",
        reminderAt: "2026-06-13T00:00:00.000Z",
        status: "active",
        priority: "high",
        source: "generated",
        metadataJson: "{}",
        acknowledgedAt: null,
        snoozedUntil: null,
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ]]);

    const rows = await listOrganizationDeadlineReminderRowsFromMysql({ query }, "org_1");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "deadline_reminder_1",
      organizationId: "org_1",
      linkedObjectType: "bid",
      dueAt: "2026-06-15",
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM deadline_reminders"), ["org_1"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("ORDER BY due_at ASC, kind ASC, id ASC"), ["org_1"]);
  });

  it("finds and updates organization reminders from MySQL", async () => {
    const query = vi.fn(async () => [[
      {
        id: "deadline_reminder_1",
        organizationId: "org_1",
        userId: "user_1",
        intentId: "intent_1",
        bidId: "bid_1",
        kind: "bid_deadline",
        linkedObjectType: "bid",
        linkedObjectId: "bid_1",
        dedupeKey: "org_1:intent_1:bid_deadline:bid:bid_1",
        title: "Bid deadline",
        dueAt: "2026-06-15",
        reminderAt: "2026-06-13T00:00:00.000Z",
        status: "active",
        priority: "high",
        source: "generated",
        metadataJson: "{}",
        acknowledgedAt: null,
        snoozedUntil: null,
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ]]);
    const execute = vi.fn(async () => [{ affectedRows: 1, insertId: 0 }]);
    const mysql = { query, execute };

    const row = await findOrganizationDeadlineReminderRowFromMysql(mysql, "org_1", "deadline_reminder_1");
    await updateOrganizationDeadlineReminderRowFromMysql(mysql, "org_1", "deadline_reminder_1", {
      status: "acknowledged",
      acknowledgedAt: "2026-06-08T01:00:00.000Z",
      snoozedUntil: null,
      updatedAt: "2026-06-08T01:00:00.000Z",
    });

    expect(row?.id).toBe("deadline_reminder_1");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE organization_id = ? AND id = ?"), [
      "org_1",
      "deadline_reminder_1",
    ]);
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("UPDATE deadline_reminders"), [
      "acknowledged",
      "2026-06-08T01:00:00.000Z",
      null,
      "2026-06-08T01:00:00.000Z",
      "org_1",
      "deadline_reminder_1",
    ]);
  });
});
