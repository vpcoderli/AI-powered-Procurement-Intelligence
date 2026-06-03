import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { billingInvoices, notificationOutbox, users } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { scheduleDunningReminders, scheduleDunningRemindersFromMysql } from "./dunning";

describe("billing dunning reminders", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(users).values({
      id: "user_buyer",
      email: "buyer@example.com",
      displayName: "Buyer",
      role: "user",
      accountTier: "business",
      isDisabled: 0,
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z",
    }).run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  function insertInvoice(input: Partial<typeof billingInvoices.$inferInsert> = {}) {
    testDb.db.insert(billingInvoices).values({
      id: "invoice_1",
      userId: "user_buyer",
      provider: "stripe",
      providerCustomerId: "cus_123",
      providerSubscriptionId: "sub_123",
      providerInvoiceId: "in_failed",
      invoiceNumber: "WIN-1003",
      status: "payment_failed",
      currency: "USD",
      amountDueCents: 24900,
      amountPaidCents: 0,
      invoiceUrl: "https://billing.example.test/invoices/in_failed",
      invoicePdfUrl: null,
      dueAt: "2026-05-28T00:00:00.000Z",
      paidAt: null,
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z",
      ...input,
    }).run();
  }

  it("queues only due staged reminders and dedupes each stage", () => {
    insertInvoice();

    const first = scheduleDunningReminders(testDb.db, {
      now: "2026-05-30T00:00:00.000Z",
    });
    const second = scheduleDunningReminders(testDb.db, {
      now: "2026-05-30T00:00:00.000Z",
    });

    expect(first).toMatchObject({
      checkedInvoices: 1,
      queued: 1,
      skippedAlreadyQueued: 0,
      skippedNotDue: 1,
      skippedResolved: 0,
    });
    expect(second).toMatchObject({
      checkedInvoices: 1,
      queued: 0,
      skippedAlreadyQueued: 1,
      skippedNotDue: 1,
    });
    expect(testDb.db.select().from(notificationOutbox).all()).toEqual([
      expect.objectContaining({
        alertId: "billing_invoice:in_failed:day2",
        dedupeKey: "billing:dunning:day2:in_failed",
        recipient: "buyer@example.com",
        subject: "Payment reminder for invoice WIN-1003",
        bodyText: expect.stringContaining("https://billing.example.test/invoices/in_failed"),
      }),
    ]);
  });

  it("queues later-stage reminders while preserving earlier-stage dedupe", () => {
    insertInvoice();
    scheduleDunningReminders(testDb.db, { now: "2026-05-30T00:00:00.000Z" });

    const result = scheduleDunningReminders(testDb.db, {
      now: "2026-06-02T00:00:00.000Z",
    });

    expect(result).toMatchObject({
      checkedInvoices: 1,
      queued: 1,
      skippedAlreadyQueued: 1,
      skippedNotDue: 0,
    });
    expect(testDb.db.select().from(notificationOutbox).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dedupeKey: "billing:dunning:day2:in_failed" }),
        expect.objectContaining({ dedupeKey: "billing:dunning:day5:in_failed" }),
      ]),
    );
  });

  it("suppresses staged reminders after an invoice is paid", () => {
    insertInvoice({
      status: "paid",
      amountPaidCents: 24900,
      paidAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z",
    });

    const result = scheduleDunningReminders(testDb.db, {
      now: "2026-06-02T00:00:00.000Z",
    });

    expect(result).toMatchObject({
      checkedInvoices: 1,
      queued: 0,
      skippedResolved: 1,
    });
    expect(testDb.db.select().from(notificationOutbox).all()).toHaveLength(0);
  });

  it("skips dunning when the user has no email recipient", () => {
    testDb.db.update(users).set({ email: null }).where(eq(users.id, "user_buyer")).run();
    insertInvoice();

    const result = scheduleDunningReminders(testDb.db, {
      now: "2026-06-02T00:00:00.000Z",
    });

    expect(result).toMatchObject({
      checkedInvoices: 1,
      queued: 0,
      skippedNoRecipient: 1,
    });
    expect(testDb.db.select().from(notificationOutbox).all()).toHaveLength(0);
  });

  it("queues due staged reminders through MySQL and dedupes each stage", async () => {
    const outbox = new Map<string, {
      id: string;
      alertId: string;
      userId: string;
      channel: string;
      recipient: string;
      frequency: string;
      dedupeKey: string;
      subject: string;
      bodyText: string;
      matchedBidIds: string;
      status: string;
      attemptCount: number;
      lastError: string | null;
      createdAt: string;
      sentAt: string | null;
    }>();
    const mysql = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("FROM billing_invoices")) {
          return [[{
            id: "invoice_1",
            userId: "user_buyer",
            provider: "stripe",
            providerInvoiceId: "in_failed",
            invoiceNumber: "WIN-1003",
            status: "payment_failed",
            currency: "USD",
            amountDueCents: 24900,
            amountPaidCents: 0,
            invoiceUrl: "https://billing.example.test/invoices/in_failed",
            invoicePdfUrl: null,
            dueAt: "2026-05-28T00:00:00.000Z",
            paidAt: null,
            createdAt: "2026-05-28T00:00:00.000Z",
            updatedAt: "2026-05-28T00:00:00.000Z",
          }], undefined];
        }

        if (sql.includes("FROM users")) {
          return [[{ email: "buyer@example.com" }], undefined];
        }

        if (sql.includes("FROM notification_outbox") && sql.includes("dedupe_key")) {
          return [[...outbox.values()].filter((row) => row.dedupeKey === values?.[0]), undefined];
        }

        return [[], undefined];
      }),
      execute: vi.fn(async (_sql: string, values?: never[]) => {
        const input = values as unknown[] | undefined;
        if (input) {
          outbox.set(String(input[6]), {
            id: String(input[0]),
            alertId: String(input[1]),
            userId: String(input[2]),
            channel: String(input[3]),
            recipient: String(input[4]),
            frequency: String(input[5]),
            dedupeKey: String(input[6]),
            subject: String(input[7]),
            bodyText: String(input[8]),
            matchedBidIds: String(input[9]),
            status: String(input[10]),
            attemptCount: Number(input[11]),
            lastError: null,
            createdAt: String(input[12]),
            sentAt: null,
          });
        }

        return [{ affectedRows: 1 }, undefined];
      }),
    };

    const first = await scheduleDunningRemindersFromMysql(mysql, {
      now: "2026-05-30T00:00:00.000Z",
    });
    const second = await scheduleDunningRemindersFromMysql(mysql, {
      now: "2026-05-30T00:00:00.000Z",
    });

    expect(first).toMatchObject({
      checkedInvoices: 1,
      queued: 1,
      skippedAlreadyQueued: 0,
      skippedNotDue: 1,
      skippedResolved: 0,
    });
    expect(second).toMatchObject({
      checkedInvoices: 1,
      queued: 0,
      skippedAlreadyQueued: 1,
      skippedNotDue: 1,
    });
    expect([...outbox.values()]).toEqual([
      expect.objectContaining({
        alertId: "billing_invoice:in_failed:day2",
        dedupeKey: "billing:dunning:day2:in_failed",
        recipient: "buyer@example.com",
        subject: "Payment reminder for invoice WIN-1003",
        bodyText: expect.stringContaining("https://billing.example.test/invoices/in_failed"),
      }),
    ]);
  });
});
