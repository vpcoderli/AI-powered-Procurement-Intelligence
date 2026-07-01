import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { recordRequestDemoLead } from "./funnel";
import { markRequestDemoNotificationFailed, queueRequestDemoLeadOperations } from "./ops";
import { getMarketingLeadExportRows, getMarketingLeadExportRowsFromMysql, renderMarketingLeadCsv } from "./export";
import { deliverPendingMarketingCrmLeadHandoffs } from "./crm";

describe("marketing lead export", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("exports request-demo leads with notification and CRM handoff status", () => {
    const leadInput = {
      email: "csv.lead@example.com",
      fullName: "CSV Lead",
      companyName: "Acme, Growth",
      role: "proposal lead",
      serviceStates: ["CA", "TX"],
      notes: "Needs CRM follow-up.",
      language: "en" as const,
      sourcePath: "/request-demo",
      occurredAt: "2026-06-30T00:00:00.000Z",
    };
    const lead = recordRequestDemoLead(testDb.db, leadInput);
    queueRequestDemoLeadOperations(testDb.db, {
      lead,
      leadInput,
      occurredAt: "2026-06-30T00:00:01.000Z",
    });

    const rows = getMarketingLeadExportRows(testDb.db);
    const csv = renderMarketingLeadCsv(rows);

    expect(rows).toEqual([
      expect.objectContaining({
        leadEventId: lead.id,
        email: "csv.lead@example.com",
        companyName: "Acme, Growth",
        serviceStates: "CA;TX",
        notificationStatus: "pending",
        notificationAttemptCount: 0,
        notificationLastError: null,
        crmHandoffStatus: "pending",
        nextUrl: `/register?intent=demo&lead=${encodeURIComponent(lead.id)}`,
      }),
    ]);
    expect(csv.split("\n")[0]).toBe(
      "lead_event_id,occurred_at,email,full_name,company_name,role,service_states,language,source_path,next_url,notification_status,notification_attempt_count,notification_last_error,crm_handoff_status",
    );
    expect(csv).toContain(`"${lead.id}"`);
    expect(csv).toContain("\"Acme, Growth\"");
    expect(csv).toContain("\"CA;TX\"");
  });

  it("exports delivered and failed CRM handoff statuses", async () => {
    const deliveredInput = {
      email: "delivered.export@example.com",
      fullName: "Delivered Export",
      companyName: "Delivered Co",
      role: "owner",
      serviceStates: ["CA"],
      notes: "CRM handoff should succeed.",
      language: "en" as const,
      sourcePath: "/request-demo",
      occurredAt: "2026-06-30T00:02:00.000Z",
    };
    const failedInput = {
      email: "failed.export@example.com",
      fullName: "Failed Export",
      companyName: "Failed Co",
      role: "growth",
      serviceStates: ["TX"],
      notes: "CRM handoff should fail.",
      language: "en" as const,
      sourcePath: "/request-demo",
      occurredAt: "2026-06-30T00:03:00.000Z",
    };
    const deliveredLead = recordRequestDemoLead(testDb.db, deliveredInput);
    queueRequestDemoLeadOperations(testDb.db, {
      lead: deliveredLead,
      leadInput: deliveredInput,
      occurredAt: "2026-06-30T00:02:01.000Z",
    });
    const failedLead = recordRequestDemoLead(testDb.db, failedInput);
    const failedOperations = queueRequestDemoLeadOperations(testDb.db, {
      lead: failedLead,
      leadInput: failedInput,
      occurredAt: "2026-06-30T00:03:01.000Z",
    });

    await deliverPendingMarketingCrmLeadHandoffs(testDb.db, {
      now: "2026-06-30T00:04:00.000Z",
      adapter: async (row) =>
        row.eventLogId === failedOperations.crmEvent.id
          ? { ok: false, error: "crm sandbox unavailable" }
          : { ok: true },
    });
    const rows = getMarketingLeadExportRows(testDb.db);
    const csv = renderMarketingLeadCsv(rows);

    expect(rows.find((row) => row.leadEventId === deliveredLead.id)).toEqual(expect.objectContaining({
      crmHandoffStatus: "delivered",
    }));
    expect(rows.find((row) => row.leadEventId === failedLead.id)).toEqual(expect.objectContaining({
      crmHandoffStatus: "failed",
    }));
    expect(csv).toContain("\"delivered\"");
    expect(csv).toContain("\"failed\"");
  });

  it("exports request-demo notification delivery attempts and last errors", () => {
    const leadInput = {
      email: "failed.notification@example.com",
      fullName: "Failed Notification",
      companyName: "Mail Failure Co",
      role: "growth",
      serviceStates: ["WA"],
      notes: "Notification should fail locally.",
      language: "en" as const,
      sourcePath: "/request-demo",
      occurredAt: "2026-06-30T00:20:00.000Z",
    };
    const lead = recordRequestDemoLead(testDb.db, leadInput);
    const operations = queueRequestDemoLeadOperations(testDb.db, {
      lead,
      leadInput,
      occurredAt: "2026-06-30T00:20:01.000Z",
    });

    markRequestDemoNotificationFailed(
      testDb.db,
      operations.notification.notification.id,
      "fake provider rejected demo lead",
      "2026-06-30T00:21:00.000Z",
    );

    const rows = getMarketingLeadExportRows(testDb.db);
    const csv = renderMarketingLeadCsv(rows);

    expect(rows).toEqual([
      expect.objectContaining({
        leadEventId: lead.id,
        notificationStatus: "failed",
        notificationAttemptCount: 1,
        notificationLastError: "fake provider rejected demo lead",
      }),
    ]);
    expect(csv.split("\n")[0]).toContain("notification_attempt_count,notification_last_error");
    expect(csv).toContain("\"1\",\"fake provider rejected demo lead\"");
  });

  it("exports MySQL notification delivery attempts and last errors", async () => {
    const leadId = "event_mysql_export";
    const mysql = {
      query: async (sql: string, values: unknown[] = []) => {
        if (sql.includes("FROM event_log") && sql.includes("WHERE event_name = ?")) {
          return [[{
            id: leadId,
            occurred_at: "2026-06-30T00:30:00.000Z",
            metadata_json: JSON.stringify({
              email: "mysql.export@example.com",
              fullName: "MySQL Export",
              companyName: "MySQL Co",
              role: "ops",
              serviceStates: ["ca"],
              language: "en",
              sourcePath: "/request-demo",
            }),
          }], undefined];
        }

        if (sql.includes("FROM notification_outbox")) {
          expect(values).toEqual([`marketing:request_demo:${leadId}:notification`]);

          return [[{
            status: "failed",
            attemptCount: "2",
            lastError: "fake mysql provider rejected demo lead",
          }], undefined];
        }

        if (sql.includes("INNER JOIN event_outbox")) {
          return [[{ status: "pending" }], undefined];
        }

        return [[], undefined];
      },
    };

    const rows = await getMarketingLeadExportRowsFromMysql(mysql);

    expect(rows).toEqual([
      expect.objectContaining({
        leadEventId: leadId,
        notificationStatus: "failed",
        notificationAttemptCount: 2,
        notificationLastError: "fake mysql provider rejected demo lead",
        crmHandoffStatus: "pending",
      }),
    ]);
  });
});
