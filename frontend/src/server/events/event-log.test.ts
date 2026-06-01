import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createRequestContext } from "@/server/http/request-context";
import { sanitizeEventMetadata, writeAuditEvent, writeEvent } from "./event-log";

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
});
