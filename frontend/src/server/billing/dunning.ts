import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";
import { billingInvoices, users } from "@/server/db/schema";
import { enqueueNotification, enqueueNotificationFromMysql } from "@/server/notifications/outbox-repository";
import type { BillingInvoiceStatus, BillingInvoiceView } from "./subscriptions";

export interface DunningReminderStage {
  key: string;
  delayDays: number;
  label: string;
}

export interface ScheduleDunningRemindersOptions {
  now?: string;
  limit?: number;
  stages?: DunningReminderStage[];
}

export interface ScheduleDunningRemindersResult {
  checkedInvoices: number;
  queued: number;
  skippedAlreadyQueued: number;
  skippedNotDue: number;
  skippedResolved: number;
  skippedNoRecipient: number;
}

interface MysqlDunningStore {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

interface MysqlDunningInvoiceRow {
  id: string;
  userId: string;
  provider: string;
  providerInvoiceId: string;
  invoiceNumber: string | null;
  status: string;
  currency: string;
  amountDueCents: number | string;
  amountPaidCents: number | string;
  invoiceUrl: string | null;
  invoicePdfUrl: string | null;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_DUNNING_STAGES: DunningReminderStage[] = [
  { key: "day2", delayDays: 2, label: "second reminder" },
  { key: "day5", delayDays: 5, label: "final reminder" },
];

function invoiceFromRow(row: typeof billingInvoices.$inferSelect): BillingInvoiceView {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    providerInvoiceId: row.providerInvoiceId,
    invoiceNumber: row.invoiceNumber,
    status: normalizeInvoiceStatus(row.status),
    currency: row.currency,
    amountDueCents: row.amountDueCents,
    amountPaidCents: row.amountPaidCents,
    invoiceUrl: row.invoiceUrl,
    invoicePdfUrl: row.invoicePdfUrl,
    dueAt: row.dueAt,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function invoiceFromMysqlRow(row: MysqlDunningInvoiceRow): BillingInvoiceView {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    providerInvoiceId: row.providerInvoiceId,
    invoiceNumber: row.invoiceNumber,
    status: normalizeInvoiceStatus(row.status),
    currency: row.currency,
    amountDueCents: Number(row.amountDueCents),
    amountPaidCents: Number(row.amountPaidCents),
    invoiceUrl: row.invoiceUrl,
    invoicePdfUrl: row.invoicePdfUrl,
    dueAt: row.dueAt,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeInvoiceStatus(value: unknown): BillingInvoiceStatus {
  return value === "paid" ||
    value === "payment_failed" ||
    value === "void" ||
    value === "uncollectible"
    ? value
    : "open";
}

function isStageDue(invoice: BillingInvoiceView, stage: DunningReminderStage, now: string) {
  const failedAt = new Date(invoice.updatedAt).getTime();
  const dueAt = failedAt + stage.delayDays * 24 * 60 * 60 * 1000;

  return dueAt <= new Date(now).getTime();
}

function findUserEmail(db: AppDatabase, userId: string) {
  const user = db.select().from(users).where(eq(users.id, userId)).limit(1).get();

  return user?.email?.trim() || null;
}

async function findMysqlUserEmail(mysql: Pick<MysqlDunningStore, "query">, userId: string) {
  const row = await mysqlSelectOne<{ email: string | null }>(
    mysql,
    "SELECT email FROM users WHERE id = ? LIMIT 1",
    [userId],
  );

  return row?.email?.trim() || null;
}

function dunningBody(invoice: BillingInvoiceView, stage: DunningReminderStage) {
  const invoiceLabel = invoice.invoiceNumber ?? invoice.providerInvoiceId;
  const amountLabel = `${invoice.currency} ${(invoice.amountDueCents / 100).toFixed(2)}`;
  const retryLine = invoice.invoiceUrl
    ? `Pay or update your payment method here: ${invoice.invoiceUrl}`
    : "Open WinBids Settings > Billing to update your payment method.";

  return [
    `This is your ${stage.label} for invoice ${invoiceLabel}.`,
    `Amount due: ${amountLabel}.`,
    invoice.dueAt ? `Due date: ${invoice.dueAt}.` : null,
    retryLine,
    "If the invoice remains unpaid, paid WinBids features may be limited after the grace period.",
  ].filter(Boolean).join("\n");
}

export function scheduleDunningReminders(
  db: AppDatabase,
  options: ScheduleDunningRemindersOptions = {},
): ScheduleDunningRemindersResult {
  const now = options.now ?? new Date().toISOString();
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const stages = options.stages ?? DEFAULT_DUNNING_STAGES;
  const result: ScheduleDunningRemindersResult = {
    checkedInvoices: 0,
    queued: 0,
    skippedAlreadyQueued: 0,
    skippedNotDue: 0,
    skippedResolved: 0,
    skippedNoRecipient: 0,
  };
  const invoices = db
    .select()
    .from(billingInvoices)
    .orderBy(asc(billingInvoices.updatedAt), asc(billingInvoices.id))
    .limit(limit)
    .all()
    .map(invoiceFromRow);

  for (const invoice of invoices) {
    result.checkedInvoices += 1;

    if (invoice.status !== "payment_failed") {
      result.skippedResolved += 1;
      continue;
    }

    const recipient = findUserEmail(db, invoice.userId);
    if (!recipient) {
      result.skippedNoRecipient += 1;
      continue;
    }

    for (const stage of stages) {
      if (!isStageDue(invoice, stage, now)) {
        result.skippedNotDue += 1;
        continue;
      }

      const invoiceLabel = invoice.invoiceNumber ?? invoice.providerInvoiceId;
      const enqueueResult = enqueueNotification(db, {
        id: `notification_${randomUUID()}`,
        alertId: `billing_invoice:${invoice.providerInvoiceId}:${stage.key}`,
        userId: invoice.userId,
        channel: "email",
        recipient,
        frequency: "daily",
        dedupeKey: `billing:dunning:${stage.key}:${invoice.providerInvoiceId}`,
        subject: `Payment reminder for invoice ${invoiceLabel}`,
        bodyText: dunningBody(invoice, stage),
        matchedBidIds: [],
        createdAt: now,
      });

      if (enqueueResult.created) {
        result.queued += 1;
      } else {
        result.skippedAlreadyQueued += 1;
      }
    }
  }

  return result;
}

export async function scheduleDunningRemindersFromMysql(
  mysql: MysqlDunningStore,
  options: ScheduleDunningRemindersOptions = {},
): Promise<ScheduleDunningRemindersResult> {
  const now = options.now ?? new Date().toISOString();
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const stages = options.stages ?? DEFAULT_DUNNING_STAGES;
  const result: ScheduleDunningRemindersResult = {
    checkedInvoices: 0,
    queued: 0,
    skippedAlreadyQueued: 0,
    skippedNotDue: 0,
    skippedResolved: 0,
    skippedNoRecipient: 0,
  };
  const rows = await mysqlSelectMany<MysqlDunningInvoiceRow>(
    mysql,
    `
      SELECT
        id,
        user_id AS userId,
        provider,
        provider_invoice_id AS providerInvoiceId,
        invoice_number AS invoiceNumber,
        status,
        currency,
        amount_due_cents AS amountDueCents,
        amount_paid_cents AS amountPaidCents,
        invoice_url AS invoiceUrl,
        invoice_pdf_url AS invoicePdfUrl,
        due_at AS dueAt,
        paid_at AS paidAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM billing_invoices
      ORDER BY updated_at ASC, id ASC
      LIMIT ?
    `,
    [limit],
  );

  for (const invoice of rows.map(invoiceFromMysqlRow)) {
    result.checkedInvoices += 1;

    if (invoice.status !== "payment_failed") {
      result.skippedResolved += 1;
      continue;
    }

    const recipient = await findMysqlUserEmail(mysql, invoice.userId);
    if (!recipient) {
      result.skippedNoRecipient += 1;
      continue;
    }

    for (const stage of stages) {
      if (!isStageDue(invoice, stage, now)) {
        result.skippedNotDue += 1;
        continue;
      }

      const invoiceLabel = invoice.invoiceNumber ?? invoice.providerInvoiceId;
      const enqueueResult = await enqueueNotificationFromMysql(mysql, {
        id: `notification_${randomUUID()}`,
        alertId: `billing_invoice:${invoice.providerInvoiceId}:${stage.key}`,
        userId: invoice.userId,
        channel: "email",
        recipient,
        frequency: "daily",
        dedupeKey: `billing:dunning:${stage.key}:${invoice.providerInvoiceId}`,
        subject: `Payment reminder for invoice ${invoiceLabel}`,
        bodyText: dunningBody(invoice, stage),
        matchedBidIds: [],
        createdAt: now,
      });

      if (enqueueResult.created) {
        result.queued += 1;
      } else {
        result.skippedAlreadyQueued += 1;
      }
    }
  }

  return result;
}
