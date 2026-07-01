import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { recordRequestDemoLead } from "./funnel";
import {
  deliverPendingRequestDemoNotifications,
  queueRequestDemoLeadOperations,
  queueRequestDemoLeadOperationsFromMysql,
} from "./ops";

describe("marketing operations handoff", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("queues a deduplicated notification and CRM outbox event for a request-demo lead", () => {
    const leadInput = {
      email: "ops-lead@example.com",
      fullName: "Ops Lead",
      companyName: "Acme Growth",
      role: "owner",
      serviceStates: ["CA", "TX"],
      notes: "Wants demo follow-up.",
      language: "en" as const,
      occurredAt: "2026-06-30T00:00:00.000Z",
    };
    const lead = recordRequestDemoLead(testDb.db, leadInput);

    const first = queueRequestDemoLeadOperations(testDb.db, {
      lead,
      leadInput,
      occurredAt: "2026-06-30T00:00:01.000Z",
    });
    const second = queueRequestDemoLeadOperations(testDb.db, {
      lead,
      leadInput,
      occurredAt: "2026-06-30T00:00:02.000Z",
    });
    const notifications = testDb.db.$client.prepare("SELECT * FROM notification_outbox").all();
    const crmEvents = testDb.db.$client
      .prepare("SELECT * FROM event_log WHERE event_name = 'marketing.crm_handoff_queued'")
      .all() as Record<string, unknown>[];
    const crmOutbox = testDb.db.$client.prepare("SELECT * FROM event_outbox").all();

    expect(first.notification.created).toBe(true);
    expect(second.notification.created).toBe(false);
    expect(second.crmEvent.id).toBe(first.crmEvent.id);
    expect(notifications).toHaveLength(1);
    expect(crmEvents).toHaveLength(1);
    expect(crmOutbox).toHaveLength(1);
    expect(crmEvents[0]).toMatchObject({
      event_name: "marketing.crm_handoff_queued",
      target_type: "marketing_lead",
      target_id: lead.id,
      source: "marketing.request-demo",
      idempotency_key: `marketing:crm_handoff:${lead.id}`,
      retention_class: "marketing",
    });
  });

  it("queues MySQL-compatible notification and CRM outbox records", async () => {
    const notifications = new Map<string, Record<string, unknown>>();
    const events = new Map<string, Record<string, unknown>>();
    const eventOutbox: Record<string, unknown>[] = [];
    const mysql = {
      execute: async (sql: string, values: unknown[] = []) => {
        if (sql.includes("INSERT INTO notification_outbox")) {
          notifications.set(String(values[6]), {
            id: values[0],
            alertId: values[1],
            userId: values[2],
            channel: values[3],
            recipient: values[4],
            frequency: values[5],
            dedupeKey: values[6],
            subject: values[7],
            bodyText: values[8],
            matchedBidIds: values[9],
            status: "pending",
            attemptCount: 0,
            lastError: null,
            createdAt: values[12],
            sentAt: null,
          });
        }

        if (sql.includes("INSERT INTO event_log")) {
          events.set(String(values[0]), {
            id: values[0],
            event_name: values[1],
            occurred_at: values[2],
            environment: values[3],
            organization_id: values[4],
            actor_type: values[5],
            actor_id: values[6],
            actor_role: values[7],
            target_type: values[8],
            target_id: values[9],
            source: values[10],
            outcome: values[11],
            severity: values[12],
            request_id: values[13],
            correlation_id: values[14],
            idempotency_key: values[15],
            metadata_json: values[16],
            before_after_json: values[17],
            retention_class: values[18],
            created_at: values[19],
          });
        }

        if (sql.includes("INSERT INTO event_outbox")) {
          eventOutbox.push({
            id: values[0],
            event_log_id: values[1],
            destination: values[2],
            status: values[3],
          });
        }

        return [{ affectedRows: 1 }, undefined];
      },
      query: async (sql: string, values: unknown[] = []) => {
        if (sql.includes("FROM notification_outbox") && sql.includes("WHERE dedupe_key = ?")) {
          return [[[...notifications.values()].find((row) => row.dedupeKey === values[0])].filter(Boolean), undefined];
        }

        if (sql.includes("FROM event_log") && sql.includes("WHERE idempotency_key = ?")) {
          return [[[...events.values()].find((row) => row.idempotency_key === values[0])].filter(Boolean), undefined];
        }

        if (sql.includes("FROM event_log") && sql.includes("WHERE id = ?")) {
          return [[[...events.values()].find((row) => row.id === values[0])].filter(Boolean), undefined];
        }

        return [[], undefined];
      },
    };

    const result = await queueRequestDemoLeadOperationsFromMysql(mysql, {
      lead: { id: "event_mysql_lead", nextUrl: "/register?intent=demo&lead=event_mysql_lead" },
      leadInput: {
        email: "mysql-lead@example.com",
        companyName: "MySQL Growth",
        serviceStates: ["ca"],
      },
      occurredAt: "2026-06-30T00:00:00.000Z",
    });

    expect(result.notification.created).toBe(true);
    expect(result.crmEvent).toMatchObject({
      eventName: "marketing.crm_handoff_queued",
      targetType: "marketing_lead",
      targetId: "event_mysql_lead",
    });
    expect(notifications.size).toBe(1);
    expect(eventOutbox).toEqual([expect.objectContaining({ destination: "crm.marketing_leads", status: "pending" })]);
  });

  it("delivers pending request-demo notifications with a local fake provider", async () => {
    const sentInput = {
      email: "sent-demo@example.com",
      fullName: "Sent Demo",
      companyName: "Sent Co",
      serviceStates: ["CA"],
      language: "en" as const,
      occurredAt: "2026-06-30T00:10:00.000Z",
    };
    const failedInput = {
      email: "failed-demo@example.com",
      fullName: "Failed Demo",
      companyName: "Failed Co",
      serviceStates: ["TX"],
      language: "en" as const,
      occurredAt: "2026-06-30T00:11:00.000Z",
    };
    const sentLead = recordRequestDemoLead(testDb.db, sentInput);
    const failedLead = recordRequestDemoLead(testDb.db, failedInput);

    queueRequestDemoLeadOperations(testDb.db, {
      lead: sentLead,
      leadInput: sentInput,
      occurredAt: "2026-06-30T00:10:01.000Z",
    });
    queueRequestDemoLeadOperations(testDb.db, {
      lead: failedLead,
      leadInput: failedInput,
      occurredAt: "2026-06-30T00:11:01.000Z",
    });

    const result = await deliverPendingRequestDemoNotifications(testDb.db, {
      now: "2026-06-30T00:12:00.000Z",
      outcomes: {
        [sentLead.id]: { ok: true },
        [failedLead.id]: { ok: false, error: "fake provider rejected demo lead" },
      },
    });

    const rows = testDb.db.$client
      .prepare("SELECT dedupe_key, status, attempt_count, last_error, sent_at FROM notification_outbox ORDER BY created_at")
      .all() as Array<Record<string, unknown>>;

    expect(result).toEqual({ attempted: 2, sent: 1, failed: 1, skipped: 0 });
    expect(rows).toEqual([
      expect.objectContaining({
        dedupe_key: `marketing:request_demo:${sentLead.id}:notification`,
        status: "sent",
        attempt_count: 1,
        last_error: null,
        sent_at: "2026-06-30T00:12:00.000Z",
      }),
      expect.objectContaining({
        dedupe_key: `marketing:request_demo:${failedLead.id}:notification`,
        status: "failed",
        attempt_count: 1,
        last_error: "fake provider rejected demo lead",
        sent_at: null,
      }),
    ]);
  });
});
