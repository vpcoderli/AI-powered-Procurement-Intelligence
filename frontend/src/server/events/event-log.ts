import { randomUUID } from "node:crypto";
import type { AppDatabase } from "@/server/db/client";
import { eventLog, eventOutbox } from "@/server/db/schema";
import type { RequestContext } from "@/server/http/request-context";

export type EventOutcome = "success" | "failure" | "denied" | "skipped";
export type EventSeverity = "debug" | "info" | "warning" | "error" | "critical";
export type EventActorType = "user" | "admin" | "operator" | "support" | "system" | "service";

export interface WriteEventInput {
  eventName: string;
  environment?: string;
  organizationId?: string | null;
  actorType?: EventActorType;
  actorId?: string | null;
  actorRole?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  source: string;
  outcome: EventOutcome;
  severity?: EventSeverity;
  requestContext?: RequestContext;
  idempotencyKey?: string | null;
  metadata?: unknown;
  beforeAfter?: unknown;
  retentionClass?: string;
  outboxDestinations?: string[];
  occurredAt?: string;
}

export interface EventLogEntry {
  id: string;
  eventName: string;
  occurredAt: string;
  environment: string;
  organizationId: string | null;
  actorType: EventActorType;
  actorId: string | null;
  actorRole: string | null;
  targetType: string | null;
  targetId: string | null;
  source: string;
  outcome: EventOutcome;
  severity: EventSeverity;
  requestId: string | null;
  correlationId: string | null;
  idempotencyKey: string | null;
  metadata: unknown;
  beforeAfter: unknown;
  retentionClass: string;
  createdAt: string;
}

const sensitiveKeyPattern = /(secret|token|password|authorization|cookie|credential|api[_-]?key|stack)/i;

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (sensitiveKeyPattern.test(key)) {
      sanitized[key] = "[redacted]";
      continue;
    }

    sanitized[key] = sanitizeValue(nestedValue);
  }

  return sanitized;
}

export function sanitizeEventMetadata(metadata: unknown) {
  return sanitizeValue(metadata ?? {});
}

function parseEntry(row: Record<string, unknown>): EventLogEntry {
  return {
    id: String(row.id),
    eventName: String(row.event_name),
    occurredAt: String(row.occurred_at),
    environment: String(row.environment),
    organizationId: (row.organization_id as string | null) ?? null,
    actorType: row.actor_type as EventActorType,
    actorId: (row.actor_id as string | null) ?? null,
    actorRole: (row.actor_role as string | null) ?? null,
    targetType: (row.target_type as string | null) ?? null,
    targetId: (row.target_id as string | null) ?? null,
    source: String(row.source),
    outcome: row.outcome as EventOutcome,
    severity: row.severity as EventSeverity,
    requestId: (row.request_id as string | null) ?? null,
    correlationId: (row.correlation_id as string | null) ?? null,
    idempotencyKey: (row.idempotency_key as string | null) ?? null,
    metadata: JSON.parse(String(row.metadata_json || "{}")),
    beforeAfter: JSON.parse(String(row.before_after_json || "{}")),
    retentionClass: String(row.retention_class),
    createdAt: String(row.created_at),
  };
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Error &&
    ("code" in error ? String((error as { code?: unknown }).code) === "SQLITE_CONSTRAINT_UNIQUE" : false)
  );
}

export function getEventByIdempotencyKey(db: AppDatabase, idempotencyKey: string): EventLogEntry | null {
  const row = db.$client.prepare("SELECT * FROM event_log WHERE idempotency_key = ?").get(idempotencyKey);
  return row ? parseEntry(row as Record<string, unknown>) : null;
}

export function writeEvent(db: AppDatabase, input: WriteEventInput): EventLogEntry {
  if (input.idempotencyKey) {
    const existing = getEventByIdempotencyKey(db, input.idempotencyKey);
    if (existing) return existing;
  }

  const now = input.occurredAt ?? new Date().toISOString();
  const id = `event_${randomUUID()}`;

  const insertEvent = db.$client.transaction(() => {
    db.insert(eventLog)
      .values({
        id,
        eventName: input.eventName,
        occurredAt: now,
        environment: input.environment ?? process.env.NODE_ENV ?? "local",
        organizationId: input.organizationId ?? null,
        actorType: input.actorType ?? "system",
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        source: input.source,
        outcome: input.outcome,
        severity: input.severity ?? "info",
        requestId: input.requestContext?.requestId ?? null,
        correlationId: input.requestContext?.correlationId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        metadataJson: JSON.stringify(sanitizeEventMetadata(input.metadata)),
        beforeAfterJson: JSON.stringify(sanitizeEventMetadata(input.beforeAfter)),
        retentionClass: input.retentionClass ?? "standard",
        createdAt: now,
      })
      .run();

    for (const destination of input.outboxDestinations ?? []) {
      db.insert(eventOutbox)
        .values({
          id: `event_outbox_${randomUUID()}`,
          eventLogId: id,
          destination,
          status: "pending",
          attemptCount: 0,
          lastError: null,
          createdAt: now,
          deliveredAt: null,
        })
        .run();
    }

    const row = db.$client.prepare("SELECT * FROM event_log WHERE id = ?").get(id);
    return parseEntry(row as Record<string, unknown>);
  });

  try {
    return insertEvent();
  } catch (error) {
    if (input.idempotencyKey && isUniqueConstraintError(error)) {
      const existing = getEventByIdempotencyKey(db, input.idempotencyKey);
      if (existing) return existing;
    }

    throw error;
  }
}

export function writeAuditEvent(db: AppDatabase, input: Omit<WriteEventInput, "source"> & { source?: string }) {
  return writeEvent(db, {
    ...input,
    source: input.source ?? "audit",
    retentionClass: input.retentionClass ?? "audit",
  });
}
