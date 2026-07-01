import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { recordRequestDemoLead } from "./funnel";
import { queueRequestDemoLeadOperations } from "./ops";
import { deliverPendingMarketingCrmLeadHandoffs, marketingCrmDestination } from "./crm";

describe("local marketing CRM sync adapter", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("marks pending CRM lead handoffs delivered through the local adapter", async () => {
    const leadInput = {
      email: "crm-delivered@example.com",
      fullName: "CRM Delivered",
      companyName: "Acme CRM",
      role: "owner",
      serviceStates: ["CA"],
      notes: "Ready for handoff.",
      language: "en" as const,
      occurredAt: "2026-06-30T00:00:00.000Z",
    };
    const lead = recordRequestDemoLead(testDb.db, leadInput);
    const operations = queueRequestDemoLeadOperations(testDb.db, {
      lead,
      leadInput,
      occurredAt: "2026-06-30T00:00:01.000Z",
    });
    const handledRows: string[] = [];

    const result = await deliverPendingMarketingCrmLeadHandoffs(testDb.db, {
      now: "2026-06-30T00:00:02.000Z",
      adapter: async (row) => {
        handledRows.push(row.eventLogId);
        return { ok: true };
      },
    });
    const outbox = testDb.db.$client
      .prepare("SELECT * FROM event_outbox WHERE event_log_id = ?")
      .get(operations.crmEvent.id) as Record<string, unknown>;

    expect(result).toEqual({ attempted: 1, delivered: 1, failed: 0, skipped: 0 });
    expect(handledRows).toEqual([operations.crmEvent.id]);
    expect(outbox).toMatchObject({
      destination: marketingCrmDestination,
      status: "delivered",
      attempt_count: 0,
      last_error: null,
      delivered_at: "2026-06-30T00:00:02.000Z",
    });
  });

  it("marks failed CRM lead handoffs with attempt count and last error", async () => {
    const leadInput = {
      email: "crm-failed@example.com",
      fullName: "CRM Failed",
      companyName: "Acme CRM",
      role: "growth",
      serviceStates: ["TX"],
      notes: "Adapter should reject this lead.",
      language: "en" as const,
      occurredAt: "2026-06-30T00:01:00.000Z",
    };
    const lead = recordRequestDemoLead(testDb.db, leadInput);
    const operations = queueRequestDemoLeadOperations(testDb.db, {
      lead,
      leadInput,
      occurredAt: "2026-06-30T00:01:01.000Z",
    });

    const result = await deliverPendingMarketingCrmLeadHandoffs(testDb.db, {
      now: "2026-06-30T00:01:02.000Z",
      adapter: async () => ({ ok: false, error: "crm sandbox rejected lead" }),
    });
    const outbox = testDb.db.$client
      .prepare("SELECT * FROM event_outbox WHERE event_log_id = ?")
      .get(operations.crmEvent.id) as Record<string, unknown>;

    expect(result).toEqual({ attempted: 1, delivered: 0, failed: 1, skipped: 0 });
    expect(outbox).toMatchObject({
      destination: marketingCrmDestination,
      status: "failed",
      attempt_count: 1,
      last_error: "crm sandbox rejected lead",
      delivered_at: null,
    });
  });
});
