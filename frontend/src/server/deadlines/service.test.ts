import { describe, expect, it } from "vitest";
import { createSupplierArtifact } from "@/server/artifacts/service";
import { createIntentForBid } from "@/server/intents/service";
import { createQuoteRequest } from "@/server/quotes/service";
import { getOrCreateResponseWorkspace, updateResponseWorkspaceItem } from "@/server/response-workspace/service";
import { createSubmissionConfirmation, getOrCreateSubmissionGuidance } from "@/server/submission/service";
import { createTestDatabase } from "@/server/db/test-utils";
import { users } from "@/server/db/schema";
import {
  acknowledgeDeadlineReminder,
  acknowledgeAccountDeadlineReminder,
  getDeadlineWorkspace,
  getAccountDeadlineReminderCenter,
  snoozeDeadlineReminder,
  snoozeAccountDeadlineReminder,
} from "./service";

describe("deadline notification service", () => {
  const userId = "deadline_user_1";

  function seedRegisteredUser(testDb: Awaited<ReturnType<typeof createTestDatabase>>) {
    testDb.db.insert(users).values({
      id: userId,
      email: "deadline-user@example.com",
      displayName: "Deadline User",
      accountTier: "business",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    }).run();
  }

  it("generates active reminders from bid, response, quote, and artifact dates without duplicates", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      seedRegisteredUser(testDb);
      const intent = await createIntentForBid(testDb.db, userId, "1");
      const responseWorkspace = await getOrCreateResponseWorkspace(testDb.db, userId, intent.id);
      const responseItem = responseWorkspace.items.find((item) => item.kind === "task")!;
      await updateResponseWorkspaceItem(testDb.db, userId, intent.id, {
        itemId: responseItem.id,
        status: "in_progress",
        notes: "Needs owner review.",
      });
      await createSupplierArtifact(testDb.db, userId, intent.id, {
        title: "Insurance certificate",
        artifactType: "insurance",
        purpose: "compliance_evidence",
        expiresAt: "2026-06-11",
        file: new File(["insurance"], "insurance.pdf", { type: "application/pdf" }),
      }, { storageRoot: testDb.directory });
      await createQuoteRequest(testDb.db, userId, intent.id, {
        partnerName: "Acme Supply",
        title: "Hardware quote",
        requestedDueAt: "2026-06-12",
      });

      const first = await getDeadlineWorkspace(testDb.db, userId, intent.id, {
        now: "2026-06-08T00:00:00.000Z",
      });
      const second = await getDeadlineWorkspace(testDb.db, userId, intent.id, {
        now: "2026-06-08T00:00:00.000Z",
      });

      expect(first.summary.total).toBeGreaterThanOrEqual(4);
      expect(second.summary.total).toBe(first.summary.total);
      expect(first.reminders.map((reminder) => reminder.kind)).toEqual(expect.arrayContaining([
        "bid_deadline",
        "response_task",
        "quote_due",
        "artifact_expiry",
      ]));
      expect(first.summary.dueSoon).toBeGreaterThan(0);
      expect(first.reminders).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "quote_due",
          title: expect.stringContaining("Hardware quote"),
          dueAt: "2026-06-12",
          status: "active",
        }),
        expect.objectContaining({
          kind: "artifact_expiry",
          title: expect.stringContaining("Insurance certificate"),
          dueAt: "2026-06-11",
        }),
      ]));
    } finally {
      await testDb.cleanup();
    }
  });

  it("bridges submission checkpoints and confirmation recovery reminders without duplicates", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      seedRegisteredUser(testDb);
      const intent = await createIntentForBid(testDb.db, userId, "1");
      await getOrCreateSubmissionGuidance(testDb.db, userId, intent.id);
      await createSubmissionConfirmation(testDb.db, userId, intent.id, {
        submittedAt: "2026-06-08T12:00:00.000Z",
        method: "external_portal",
        confirmationNotes: "Portal accepted the response but did not show a receipt.",
      });

      const first = await getDeadlineWorkspace(testDb.db, userId, intent.id, {
        now: "2026-06-08T13:00:00.000Z",
      });
      const second = await getDeadlineWorkspace(testDb.db, userId, intent.id, {
        now: "2026-06-08T13:00:00.000Z",
      });
      const checkpoint = first.reminders.find((item) => item.kind === "submission_checkpoint")!;
      const recovery = first.reminders.find((item) => item.kind === "submission_confirmation_recovery")!;

      expect(first.reminders.filter((item) => item.kind === "submission_checkpoint")).toHaveLength(1);
      expect(first.reminders.filter((item) => item.kind === "submission_confirmation_recovery")).toHaveLength(1);
      expect(second.summary.total).toBe(first.summary.total);
      expect(checkpoint).toEqual(expect.objectContaining({
        linkedObjectType: "submission_path",
        title: expect.stringContaining("Submission checkpoint"),
        status: "active",
      }));
      expect(recovery).toEqual(expect.objectContaining({
        linkedObjectType: "submission_confirmation",
        title: expect.stringContaining("Recover confirmation"),
        priority: "high",
        status: "active",
      }));

      const acknowledged = await acknowledgeDeadlineReminder(testDb.db, userId, intent.id, {
        reminderId: checkpoint.id,
        now: "2026-06-08T14:00:00.000Z",
      });
      expect(acknowledged.reminders.find((item) => item.id === checkpoint.id)).toMatchObject({
        status: "acknowledged",
        acknowledgedAt: "2026-06-08T14:00:00.000Z",
      });

      const snoozed = await snoozeDeadlineReminder(testDb.db, userId, intent.id, {
        reminderId: recovery.id,
        snoozedUntil: "2026-06-09T09:00:00.000Z",
        now: "2026-06-08T15:00:00.000Z",
      });
      expect(snoozed.reminders.find((item) => item.id === recovery.id)).toMatchObject({
        status: "snoozed",
        snoozedUntil: "2026-06-09T09:00:00.000Z",
      });
    } finally {
      await testDb.cleanup();
    }
  });

  it("acknowledges and snoozes reminders", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      seedRegisteredUser(testDb);
      const intent = await createIntentForBid(testDb.db, userId, "1");
      const workspace = await getDeadlineWorkspace(testDb.db, userId, intent.id, {
        now: "2026-06-08T00:00:00.000Z",
      });
      const reminder = workspace.reminders.find((item) => item.kind === "bid_deadline")!;

      const acknowledged = await acknowledgeDeadlineReminder(testDb.db, userId, intent.id, {
        reminderId: reminder.id,
        now: "2026-06-08T01:00:00.000Z",
      });
      expect(acknowledged.reminders.find((item) => item.id === reminder.id)).toMatchObject({
        status: "acknowledged",
        acknowledgedAt: "2026-06-08T01:00:00.000Z",
      });

      const snoozed = await snoozeDeadlineReminder(testDb.db, userId, intent.id, {
        reminderId: reminder.id,
        snoozedUntil: "2026-06-10T09:00:00.000Z",
        now: "2026-06-08T02:00:00.000Z",
      });
      expect(snoozed.reminders.find((item) => item.id === reminder.id)).toMatchObject({
        status: "snoozed",
        snoozedUntil: "2026-06-10T09:00:00.000Z",
      });
    } finally {
      await testDb.cleanup();
    }
  });

  it("lists and updates account reminder center across intents", async () => {
    const testDb = await createTestDatabase({ seed: true });

    try {
      seedRegisteredUser(testDb);
      const firstIntent = await createIntentForBid(testDb.db, userId, "1");
      const secondIntent = await createIntentForBid(testDb.db, userId, "2");
      await getDeadlineWorkspace(testDb.db, userId, firstIntent.id, {
        now: "2026-06-08T00:00:00.000Z",
      });
      await getDeadlineWorkspace(testDb.db, userId, secondIntent.id, {
        now: "2026-06-08T00:00:00.000Z",
      });

      const center = await getAccountDeadlineReminderCenter(testDb.db, userId, {
        now: "2026-06-08T00:00:00.000Z",
      });
      const reminder = center.reminders.find((item) => item.intentId === firstIntent.id)!;

      expect(center.summary.total).toBeGreaterThanOrEqual(2);
      expect(center.summary.active).toBe(center.reminders.filter((item) => item.status === "active").length);
      expect(center.reminders.map((item) => item.intentId)).toEqual(expect.arrayContaining([
        firstIntent.id,
        secondIntent.id,
      ]));

      const acknowledged = await acknowledgeAccountDeadlineReminder(testDb.db, userId, {
        reminderId: reminder.id,
        now: "2026-06-08T01:00:00.000Z",
      });
      expect(acknowledged.reminders.find((item) => item.id === reminder.id)).toMatchObject({
        status: "acknowledged",
        acknowledgedAt: "2026-06-08T01:00:00.000Z",
      });

      const snoozed = await snoozeAccountDeadlineReminder(testDb.db, userId, {
        reminderId: reminder.id,
        snoozedUntil: "2026-06-10T09:00:00.000Z",
        now: "2026-06-08T02:00:00.000Z",
      });
      expect(snoozed.reminders.find((item) => item.id === reminder.id)).toMatchObject({
        status: "snoozed",
        snoozedUntil: "2026-06-10T09:00:00.000Z",
      });
    } finally {
      await testDb.cleanup();
    }
  });
});
