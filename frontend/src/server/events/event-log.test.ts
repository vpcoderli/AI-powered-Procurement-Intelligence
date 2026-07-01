import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createRequestContext } from "@/server/http/request-context";
import {
  deliverPendingEventOutboxRows,
  deliverPendingEventOutboxRowsFromMysql,
  sanitizeEventMetadata,
  writeAuditEvent,
  writeAuditEventFromMysql,
  writeEvent,
} from "./event-log";

describe("event log", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("writes durable event payloads with request context", () => {
    const requestContext = createRequestContext(new Request("http://localhost/api/admin/config", {
      headers: {
        "x-request-id": "req_123",
        "x-correlation-id": "corr_123",
      },
    }));
    const entry = writeEvent(testDb.db, {
      eventName: "admin.config.updated",
      environment: "test",
      organizationId: "org_1",
      actorType: "admin",
      actorId: "admin_1",
      actorRole: "admin",
      targetType: "config",
      targetId: "cfg_1",
      source: "admin.config",
      outcome: "success",
      severity: "info",
      requestContext,
      idempotencyKey: "config:cfg_1:2026-06-01",
      metadata: { module: "source" },
      beforeAfter: { before: { enabled: false }, after: { enabled: true } },
      retentionClass: "audit",
      occurredAt: "2026-06-01T00:00:00.000Z",
    });

    expect(entry).toEqual(expect.objectContaining({
      eventName: "admin.config.updated",
      environment: "test",
      organizationId: "org_1",
      actorType: "admin",
      actorId: "admin_1",
      targetType: "config",
      targetId: "cfg_1",
      outcome: "success",
      severity: "info",
      requestId: "req_123",
      correlationId: "corr_123",
      idempotencyKey: "config:cfg_1:2026-06-01",
      metadata: { module: "source" },
      beforeAfter: { before: { enabled: false }, after: { enabled: true } },
      retentionClass: "audit",
    }));
  });

  it("redacts sensitive metadata fields", () => {
    expect(sanitizeEventMetadata({
      apiKey: "sk_test_secret",
      nested: {
        password: "secret",
        safe: "value",
        stack: "Error stack",
      },
    })).toEqual({
      apiKey: "[redacted]",
      nested: {
        password: "[redacted]",
        safe: "value",
        stack: "[redacted]",
      },
    });
  });

  it("returns the original event for duplicate idempotency keys", () => {
    const first = writeAuditEvent(testDb.db, {
      eventName: "plan.limit_reached",
      source: "quota",
      outcome: "denied",
      idempotencyKey: "limit:org_1:saved_bids",
      metadata: { currentUsage: 5, limitValue: 5 },
      occurredAt: "2026-06-01T00:00:00.000Z",
    });
    const second = writeAuditEvent(testDb.db, {
      eventName: "plan.limit_reached",
      source: "quota",
      outcome: "denied",
      idempotencyKey: "limit:org_1:saved_bids",
      metadata: { currentUsage: 10, limitValue: 5 },
      occurredAt: "2026-06-01T00:01:00.000Z",
    });

    expect(second.id).toBe(first.id);
    expect(second.metadata).toEqual({ currentUsage: 5, limitValue: 5 });
  });

  it("creates event outbox rows for requested destinations", () => {
    const entry = writeEvent(testDb.db, {
      eventName: "source.unavailable",
      source: "crawler",
      outcome: "failure",
      severity: "warning",
      outboxDestinations: ["ops-alerts"],
      occurredAt: "2026-06-01T00:00:00.000Z",
    });

    const outbox = testDb.db.$client
      .prepare("SELECT event_log_id, destination, status FROM event_outbox WHERE event_log_id = ?")
      .all(entry.id);

    expect(outbox).toEqual([{ event_log_id: entry.id, destination: "ops-alerts", status: "pending" }]);
  });

  it("delivers pending SQLite event outbox rows and records failures", async () => {
    const delivered = writeEvent(testDb.db, {
      eventName: "source.restored",
      source: "crawler",
      outcome: "success",
      outboxDestinations: ["ops-alerts"],
      occurredAt: "2026-06-01T00:00:00.000Z",
    });
    const failed = writeEvent(testDb.db, {
      eventName: "source.unavailable",
      source: "crawler",
      outcome: "failure",
      outboxDestinations: ["ops-alerts"],
      occurredAt: "2026-06-01T00:01:00.000Z",
    });

    const result = await deliverPendingEventOutboxRows(
      testDb.db,
      async (row) => row.eventLogId === failed.id ? { ok: false, error: "send failed" } : { ok: true },
      { now: "2026-06-01T00:02:00.000Z" },
    );
    const rows = testDb.db.$client
      .prepare("SELECT event_log_id, status, attempt_count, last_error, delivered_at FROM event_outbox ORDER BY created_at ASC")
      .all() as Record<string, unknown>[];

    expect(result).toEqual({ attempted: 2, delivered: 1, failed: 1, skipped: 0 });
    expect(rows).toEqual([
      expect.objectContaining({
        event_log_id: delivered.id,
        status: "delivered",
        attempt_count: 0,
        last_error: null,
        delivered_at: "2026-06-01T00:02:00.000Z",
      }),
      expect.objectContaining({
        event_log_id: failed.id,
        status: "failed",
        attempt_count: 1,
        last_error: "send failed",
        delivered_at: null,
      }),
    ]);
  });

  it("writes audit events through the MySQL runtime helper", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const outboxRows: Record<string, unknown>[] = [];
    const mysql = {
      execute: async (sql: string, values: unknown[] = []) => {
        if (sql.includes("INSERT INTO event_log")) {
          rows.set(values[0] as string, {
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
          outboxRows.push({
            id: values[0],
            event_log_id: values[1],
            destination: values[2],
            status: values[3],
          });
        }

        return [{ affectedRows: 1 }, undefined];
      },
      query: async (sql: string, values: unknown[] = []) => {
        if (sql.includes("idempotency_key = ?")) {
          return [[...rows.values()].filter((row) => row.idempotency_key === values[0]), undefined];
        }

        return [[...rows.values()].filter((row) => row.id === values[0]), undefined];
      },
    };

    const entry = await writeAuditEventFromMysql(mysql, {
      eventName: "admin.config.upserted",
      environment: "test",
      targetType: "config",
      targetId: "cfg_1",
      outcome: "success",
      outboxDestinations: ["ops"],
      metadata: { apiKey: "secret", module: "source" },
      occurredAt: "2026-06-01T00:00:00.000Z",
    });

    expect(entry).toMatchObject({
      eventName: "admin.config.upserted",
      source: "audit",
      retentionClass: "audit",
      metadata: { apiKey: "[redacted]", module: "source" },
    });
    expect(outboxRows).toEqual([expect.objectContaining({ event_log_id: entry.id, destination: "ops" })]);
  });

  it("delivers pending MySQL event outbox rows", async () => {
    const outboxRows = new Map<string, Record<string, unknown>>([
      ["event_outbox_1", {
        id: "event_outbox_1",
        event_log_id: "event_1",
        destination: "ops",
        status: "pending",
        attempt_count: 0,
        last_error: null,
        created_at: "2026-06-01T00:00:00.000Z",
        delivered_at: null,
      }],
      ["event_outbox_2", {
        id: "event_outbox_2",
        event_log_id: "event_2",
        destination: "ops",
        status: "failed",
        attempt_count: 3,
        last_error: "old failure",
        created_at: "2026-06-01T00:01:00.000Z",
        delivered_at: null,
      }],
      ["event_outbox_3", {
        id: "event_outbox_3",
        event_log_id: "event_3",
        destination: "crm.marketing_leads",
        status: "pending",
        attempt_count: 0,
        last_error: null,
        created_at: "2026-06-01T00:01:30.000Z",
        delivered_at: null,
      }],
    ]);
    const mysql = {
      query: async (sql: string, values: unknown[] = []) => {
        if (sql.includes("COUNT(*)")) {
          const destinationFilter = sql.includes("destination IN");
          const destinations = destinationFilter ? values.map(String) : [];
          return [[{
            candidateCount: [...outboxRows.values()].filter((row) =>
              !destinationFilter || destinations.includes(String(row.destination))
            ).length,
          }], undefined];
        }

        if (sql.includes("FROM event_outbox")) {
          const destinationFilter = sql.includes("destination IN");
          const destinationCount = destinationFilter ? 1 : 0;
          const destinations = destinationFilter ? values.slice(0, destinationCount).map(String) : [];
          const maxAttempts = Number(values[destinationCount]);
          const limit = Number(values[destinationCount + 1]);
          return [[...outboxRows.values()]
            .filter((row) =>
              (!destinationFilter || destinations.includes(String(row.destination))) &&
              Number(row.attempt_count) < maxAttempts
            )
            .slice(0, limit), undefined];
        }

        return [[], undefined];
      },
      execute: async (sql: string, values: unknown[] = []) => {
        const id = String(values[1]);
        const row = outboxRows.get(id);
        if (row && sql.includes("status = 'delivered'")) {
          row.status = "delivered";
          row.delivered_at = values[0];
          row.last_error = null;
        }

        return [{ affectedRows: row ? 1 : 0 }, undefined];
      },
    };

    const result = await deliverPendingEventOutboxRowsFromMysql(
      mysql,
      async (row) => row.destination === "ops" ? { ok: true } : { ok: false, error: "unexpected destination" },
      { now: "2026-06-01T00:02:00.000Z", maxAttempts: 3, destinations: ["ops"] },
    );

    expect(result).toEqual({ attempted: 1, delivered: 1, failed: 0, skipped: 1 });
    expect(outboxRows.get("event_outbox_1")).toEqual(expect.objectContaining({
      status: "delivered",
      delivered_at: "2026-06-01T00:02:00.000Z",
    }));
    expect(outboxRows.get("event_outbox_2")).toEqual(expect.objectContaining({
      status: "failed",
      attempt_count: 3,
    }));
    expect(outboxRows.get("event_outbox_3")).toEqual(expect.objectContaining({
      status: "pending",
      destination: "crm.marketing_leads",
    }));
  });
});
