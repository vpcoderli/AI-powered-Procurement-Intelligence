import { randomUUID } from "node:crypto";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute, mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";
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

export interface EventOutboxRow {
  id: string;
  eventLogId: string;
  destination: string;
  status: "pending" | "delivered" | "failed";
  attemptCount: number;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface EventOutboxDeliveryOptions {
  now?: string;
  limit?: number;
  maxAttempts?: number;
}

export interface EventOutboxDeliveryResult {
  attempted: number;
  delivered: number;
  failed: number;
  skipped: number;
}

export type EventOutboxHandler = (row: EventOutboxRow) => Promise<{ ok: true } | { ok: false; error: string }>;

interface MysqlEventLogStore {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
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

function parseOutboxRow(row: Record<string, unknown>): EventOutboxRow {
  return {
    id: String(row.id),
    eventLogId: String(row.event_log_id),
    destination: String(row.destination),
    status: row.status === "delivered" || row.status === "failed" ? row.status : "pending",
    attemptCount: Number(row.attempt_count ?? 0),
    lastError: (row.last_error as string | null) ?? null,
    createdAt: String(row.created_at),
    deliveredAt: (row.delivered_at as string | null) ?? null,
  };
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Error &&
    ("code" in error ? String((error as { code?: unknown }).code) === "SQLITE_CONSTRAINT_UNIQUE" : false)
  );
}

function isMysqlDuplicateError(error: unknown) {
  return error instanceof Error && ("code" in error ? String((error as { code?: unknown }).code) === "ER_DUP_ENTRY" : false);
}

export function getEventByIdempotencyKey(db: AppDatabase, idempotencyKey: string): EventLogEntry | null {
  const row = db.$client.prepare("SELECT * FROM event_log WHERE idempotency_key = ?").get(idempotencyKey);
  return row ? parseEntry(row as Record<string, unknown>) : null;
}

export async function getEventByIdempotencyKeyFromMysql(
  mysql: MysqlEventLogStore,
  idempotencyKey: string,
): Promise<EventLogEntry | null> {
  const row = await mysqlSelectOne<Record<string, unknown>>(
    mysql,
    "SELECT * FROM event_log WHERE idempotency_key = ? LIMIT 1",
    [idempotencyKey],
  );

  return row ? parseEntry(row) : null;
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

export async function writeEventFromMysql(
  mysql: MysqlEventLogStore,
  input: WriteEventInput,
): Promise<EventLogEntry> {
  if (input.idempotencyKey) {
    const existing = await getEventByIdempotencyKeyFromMysql(mysql, input.idempotencyKey);
    if (existing) return existing;
  }

  const now = input.occurredAt ?? new Date().toISOString();
  const id = `event_${randomUUID()}`;

  try {
    await mysqlExecute(
      mysql,
      `
        INSERT INTO event_log (
          id,
          event_name,
          occurred_at,
          environment,
          organization_id,
          actor_type,
          actor_id,
          actor_role,
          target_type,
          target_id,
          source,
          outcome,
          severity,
          request_id,
          correlation_id,
          idempotency_key,
          metadata_json,
          before_after_json,
          retention_class,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        input.eventName,
        now,
        input.environment ?? process.env.NODE_ENV ?? "local",
        input.organizationId ?? null,
        input.actorType ?? "system",
        input.actorId ?? null,
        input.actorRole ?? null,
        input.targetType ?? null,
        input.targetId ?? null,
        input.source,
        input.outcome,
        input.severity ?? "info",
        input.requestContext?.requestId ?? null,
        input.requestContext?.correlationId ?? null,
        input.idempotencyKey ?? null,
        JSON.stringify(sanitizeEventMetadata(input.metadata)),
        JSON.stringify(sanitizeEventMetadata(input.beforeAfter)),
        input.retentionClass ?? "standard",
        now,
      ],
    );

    for (const destination of input.outboxDestinations ?? []) {
      await mysqlExecute(
        mysql,
        `
          INSERT INTO event_outbox (
            id,
            event_log_id,
            destination,
            status,
            attempt_count,
            last_error,
            created_at,
            delivered_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [`event_outbox_${randomUUID()}`, id, destination, "pending", 0, null, now, null],
      );
    }
  } catch (error) {
    if (input.idempotencyKey && isMysqlDuplicateError(error)) {
      const existing = await getEventByIdempotencyKeyFromMysql(mysql, input.idempotencyKey);
      if (existing) return existing;
    }

    throw error;
  }

  const row = await mysqlSelectOne<Record<string, unknown>>(mysql, "SELECT * FROM event_log WHERE id = ?", [id]);
  if (!row) {
    throw new Error("Event log write failed.");
  }

  return parseEntry(row);
}

export function writeAuditEvent(db: AppDatabase, input: Omit<WriteEventInput, "source"> & { source?: string }) {
  return writeEvent(db, {
    ...input,
    source: input.source ?? "audit",
    retentionClass: input.retentionClass ?? "audit",
  });
}

export function writeAuditEventFromMysql(
  mysql: MysqlEventLogStore,
  input: Omit<WriteEventInput, "source"> & { source?: string },
) {
  return writeEventFromMysql(mysql, {
    ...input,
    source: input.source ?? "audit",
    retentionClass: input.retentionClass ?? "audit",
  });
}

async function defaultEventOutboxHandler() {
  return { ok: true as const };
}

export function listDeliverableEventOutboxRows(
  db: AppDatabase,
  options: Pick<EventOutboxDeliveryOptions, "limit" | "maxAttempts"> = {},
) {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);

  return db.$client
    .prepare(`
      SELECT *
      FROM event_outbox
      WHERE status IN ('pending', 'failed')
        AND attempt_count < ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `)
    .all(maxAttempts, limit)
    .map((row) => parseOutboxRow(row as Record<string, unknown>));
}

export async function listDeliverableEventOutboxRowsFromMysql(
  mysql: Pick<MysqlEventLogStore, "query">,
  options: Pick<EventOutboxDeliveryOptions, "limit" | "maxAttempts"> = {},
) {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const rows = await mysqlSelectOne<{ candidateCount: number | string }>(
    mysql,
    "SELECT COUNT(*) AS candidateCount FROM event_outbox WHERE status IN ('pending', 'failed')",
  );

  const deliverableRows = await mysqlSelectMany<Record<string, unknown>>(
    mysql,
    `
      SELECT *
      FROM event_outbox
      WHERE status IN ('pending', 'failed')
        AND attempt_count < ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `,
    [maxAttempts, limit],
  );

  return {
    rows: deliverableRows.map(parseOutboxRow),
    candidateCount: Number(rows?.candidateCount ?? 0),
  };
}

function countPendingEventOutboxRows(db: AppDatabase) {
  const row = db.$client
    .prepare("SELECT COUNT(*) AS candidateCount FROM event_outbox WHERE status IN ('pending', 'failed')")
    .get() as { candidateCount?: number | string } | undefined;

  return Number(row?.candidateCount ?? 0);
}

export async function deliverPendingEventOutboxRows(
  db: AppDatabase,
  handler: EventOutboxHandler = defaultEventOutboxHandler,
  options: EventOutboxDeliveryOptions = {},
): Promise<EventOutboxDeliveryResult> {
  const now = options.now ?? new Date().toISOString();
  const rows = listDeliverableEventOutboxRows(db, options);
  const candidateCount = countPendingEventOutboxRows(db);
  const result: EventOutboxDeliveryResult = { attempted: 0, delivered: 0, failed: 0, skipped: 0 };

  for (const row of rows) {
    result.attempted += 1;
    const delivery = await handler(row).catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : "Event outbox handler threw an unknown error",
    }));

    if (delivery.ok) {
      db.$client
        .prepare("UPDATE event_outbox SET status = 'delivered', delivered_at = ?, last_error = NULL WHERE id = ?")
        .run(now, row.id);
      result.delivered += 1;
    } else {
      db.$client
        .prepare("UPDATE event_outbox SET status = 'failed', attempt_count = attempt_count + 1, last_error = ? WHERE id = ?")
        .run(delivery.error, row.id);
      result.failed += 1;
    }
  }

  result.skipped = Math.max(0, candidateCount - rows.length);
  return result;
}

export async function deliverPendingEventOutboxRowsFromMysql(
  mysql: MysqlEventLogStore,
  handler: EventOutboxHandler = defaultEventOutboxHandler,
  options: EventOutboxDeliveryOptions = {},
): Promise<EventOutboxDeliveryResult> {
  const now = options.now ?? new Date().toISOString();
  const deliverable = await listDeliverableEventOutboxRowsFromMysql(mysql, options);
  const result: EventOutboxDeliveryResult = { attempted: 0, delivered: 0, failed: 0, skipped: 0 };

  for (const row of deliverable.rows) {
    result.attempted += 1;
    const delivery = await handler(row).catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : "Event outbox handler threw an unknown error",
    }));

    if (delivery.ok) {
      await mysqlExecute(
        mysql,
        "UPDATE event_outbox SET status = 'delivered', delivered_at = ?, last_error = NULL WHERE id = ?",
        [now, row.id],
      );
      result.delivered += 1;
    } else {
      await mysqlExecute(
        mysql,
        "UPDATE event_outbox SET status = 'failed', attempt_count = attempt_count + 1, last_error = ? WHERE id = ?",
        [delivery.error, row.id],
      );
      result.failed += 1;
    }
  }

  result.skipped = Math.max(0, deliverable.candidateCount - deliverable.rows.length);
  return result;
}
