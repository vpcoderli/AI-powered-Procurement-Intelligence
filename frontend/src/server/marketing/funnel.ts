import type { AppDatabase } from "@/server/db/client";
import { mysqlSelectMany } from "@/server/db/mysql-runtime";
import {
  writeEvent,
  writeEventFromMysql,
  type EventLogEntry,
  type EventActorType,
} from "@/server/events/event-log";

export const MARKETING_FUNNEL_EVENT_NAMES = [
  "marketing.request_demo_submitted",
  "marketing.start_signup",
  "marketing.complete_signup",
  "marketing.start_supplier_profile",
  "marketing.complete_supplier_profile",
  "marketing.first_matched_bid_viewed",
] as const;

export type MarketingFunnelEventName = (typeof MARKETING_FUNNEL_EVENT_NAMES)[number];

export interface RequestDemoLeadInput {
  email: string;
  fullName?: string;
  companyName?: string;
  role?: string;
  serviceStates?: string[];
  notes?: string;
  language?: "en" | "zh";
  sourcePath?: string;
  occurredAt?: string;
}

export interface RequestDemoLeadResult {
  id: string;
  nextUrl: string;
}

export interface RecordMarketingFunnelEventInput {
  eventName: MarketingFunnelEventName;
  actorType?: EventActorType;
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  source?: string;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}

export interface MarketingFunnelCounts {
  requestDemoSubmitted: number;
  startSignup: number;
  completeSignup: number;
  startSupplierProfile: number;
  completeSupplierProfile: number;
  firstMatchedBidViewed: number;
}

export interface MarketingFunnelLeadSummary {
  eventId: string;
  occurredAt: string;
  email: string | null;
  fullName?: string | null;
  companyName?: string | null;
  role?: string | null;
  serviceStates?: string[];
}

export interface MarketingFunnelSummary {
  counts: MarketingFunnelCounts;
  latestRequestDemoLeads: MarketingFunnelLeadSummary[];
}

interface MysqlMarketingFunnelStore {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute?: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

interface MarketingFunnelEventRow {
  id: string;
  event_name: string;
  occurred_at: string;
  metadata_json: string;
}

const emptyCounts = (): MarketingFunnelCounts => ({
  requestDemoSubmitted: 0,
  startSignup: 0,
  completeSignup: 0,
  startSupplierProfile: 0,
  completeSupplierProfile: 0,
  firstMatchedBidViewed: 0,
});

const countKeyByEventName: Record<MarketingFunnelEventName, keyof MarketingFunnelCounts> = {
  "marketing.request_demo_submitted": "requestDemoSubmitted",
  "marketing.start_signup": "startSignup",
  "marketing.complete_signup": "completeSignup",
  "marketing.start_supplier_profile": "startSupplierProfile",
  "marketing.complete_supplier_profile": "completeSupplierProfile",
  "marketing.first_matched_bid_viewed": "firstMatchedBidViewed",
};

function normalizeString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeStates(values: string[] | undefined) {
  if (!Array.isArray(values)) return [];

  return [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))];
}

function requestDemoMetadata(input: RequestDemoLeadInput) {
  return {
    email: normalizeEmail(input.email),
    ...(normalizeString(input.fullName) ? { fullName: normalizeString(input.fullName) } : {}),
    ...(normalizeString(input.companyName) ? { companyName: normalizeString(input.companyName) } : {}),
    ...(normalizeString(input.role) ? { role: normalizeString(input.role) } : {}),
    serviceStates: normalizeStates(input.serviceStates),
    ...(normalizeString(input.notes) ? { notes: normalizeString(input.notes) } : {}),
    language: input.language ?? "en",
    sourcePath: input.sourcePath ?? "/request-demo",
  };
}

function nextUrlForLead(id: string) {
  return `/register?intent=demo&lead=${encodeURIComponent(id)}`;
}

function parseMetadata(value: string) {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function leadFromRow(row: MarketingFunnelEventRow): MarketingFunnelLeadSummary {
  const metadata = parseMetadata(row.metadata_json);
  const serviceStates = Array.isArray(metadata.serviceStates)
    ? metadata.serviceStates.filter((item): item is string => typeof item === "string")
    : [];

  return {
    eventId: row.id,
    occurredAt: row.occurred_at,
    email: stringOrNull(metadata.email),
    fullName: stringOrNull(metadata.fullName),
    companyName: stringOrNull(metadata.companyName),
    role: stringOrNull(metadata.role),
    serviceStates,
  };
}

function summarizeRows(rows: MarketingFunnelEventRow[]): MarketingFunnelSummary {
  const counts = emptyCounts();
  const latestRequestDemoLeads: MarketingFunnelLeadSummary[] = [];

  for (const row of rows) {
    if (!MARKETING_FUNNEL_EVENT_NAMES.includes(row.event_name as MarketingFunnelEventName)) {
      continue;
    }

    const eventName = row.event_name as MarketingFunnelEventName;
    counts[countKeyByEventName[eventName]] += 1;

    if (eventName === "marketing.request_demo_submitted" && latestRequestDemoLeads.length < 10) {
      latestRequestDemoLeads.push(leadFromRow(row));
    }
  }

  return { counts, latestRequestDemoLeads };
}

function eventNamePlaceholders() {
  return MARKETING_FUNNEL_EVENT_NAMES.map(() => "?").join(", ");
}

export function recordMarketingFunnelEvent(
  db: AppDatabase,
  input: RecordMarketingFunnelEventInput,
): EventLogEntry {
  return writeEvent(db, {
    eventName: input.eventName,
    actorType: input.actorType ?? (input.actorId ? "user" : "system"),
    actorId: input.actorId ?? null,
    targetType: input.targetType ?? "marketing_funnel",
    targetId: input.targetId ?? null,
    source: input.source ?? "marketing.funnel",
    outcome: "success",
    severity: "info",
    idempotencyKey: input.idempotencyKey ?? null,
    retentionClass: "marketing",
    metadata: input.metadata ?? {},
    occurredAt: input.occurredAt,
  });
}

export function recordRequestDemoLead(
  db: AppDatabase,
  input: RequestDemoLeadInput,
): RequestDemoLeadResult {
  const event = recordMarketingFunnelEvent(db, {
    eventName: "marketing.request_demo_submitted",
    targetType: "marketing_lead",
    source: "marketing.request-demo",
    metadata: requestDemoMetadata(input),
    occurredAt: input.occurredAt,
  });

  return {
    id: event.id,
    nextUrl: nextUrlForLead(event.id),
  };
}

export async function recordMarketingFunnelEventFromMysql(
  mysql: MysqlMarketingFunnelStore,
  input: RecordMarketingFunnelEventInput,
): Promise<EventLogEntry> {
  return writeEventFromMysql(mysql as Required<MysqlMarketingFunnelStore>, {
    eventName: input.eventName,
    actorType: input.actorType ?? (input.actorId ? "user" : "system"),
    actorId: input.actorId ?? null,
    targetType: input.targetType ?? "marketing_funnel",
    targetId: input.targetId ?? null,
    source: input.source ?? "marketing.funnel",
    outcome: "success",
    severity: "info",
    idempotencyKey: input.idempotencyKey ?? null,
    retentionClass: "marketing",
    metadata: input.metadata ?? {},
    occurredAt: input.occurredAt,
  });
}

export async function recordRequestDemoLeadFromMysql(
  mysql: Required<MysqlMarketingFunnelStore>,
  input: RequestDemoLeadInput,
): Promise<RequestDemoLeadResult> {
  const event = await recordMarketingFunnelEventFromMysql(mysql, {
    eventName: "marketing.request_demo_submitted",
    targetType: "marketing_lead",
    source: "marketing.request-demo",
    metadata: requestDemoMetadata(input),
    occurredAt: input.occurredAt,
  });

  return {
    id: event.id,
    nextUrl: nextUrlForLead(event.id),
  };
}

export function getMarketingFunnelSummary(db: AppDatabase, options: { limit?: number } = {}): MarketingFunnelSummary {
  const limit = Math.max(1, Math.min(options.limit ?? 1000, 5000));
  const rows = db.$client
    .prepare(`
      SELECT id, event_name, occurred_at, metadata_json
      FROM event_log
      WHERE event_name IN (${eventNamePlaceholders()})
      ORDER BY occurred_at DESC, id DESC
      LIMIT ?
    `)
    .all(...MARKETING_FUNNEL_EVENT_NAMES, limit) as MarketingFunnelEventRow[];

  return summarizeRows(rows);
}

export async function getMarketingFunnelSummaryFromMysql(
  mysql: Pick<MysqlMarketingFunnelStore, "query">,
  options: { limit?: number } = {},
): Promise<MarketingFunnelSummary> {
  const limit = Math.max(1, Math.min(options.limit ?? 1000, 5000));
  const rows = await mysqlSelectMany<MarketingFunnelEventRow>(
    mysql,
    `
      SELECT id, event_name, occurred_at, metadata_json
      FROM event_log
      WHERE event_name IN (${eventNamePlaceholders()})
      ORDER BY occurred_at DESC, id DESC
      LIMIT ?
    `,
    [...MARKETING_FUNNEL_EVENT_NAMES, limit],
  );

  return summarizeRows(rows);
}
