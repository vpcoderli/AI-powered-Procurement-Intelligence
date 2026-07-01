import type { AppDatabase } from "@/server/db/client";
import { mysqlSelectMany, mysqlSelectOne } from "@/server/db/mysql-runtime";

const requestDemoEventName = "marketing.request_demo_submitted";
const crmHandoffEventName = "marketing.crm_handoff_queued";
const crmDestination = "crm.marketing_leads";

interface MarketingLeadEventRow {
  id: string;
  occurred_at: string;
  metadata_json: string;
}

interface NotificationStatusRow {
  status: string | null;
  attempt_count?: number | string | null;
  attemptCount?: number | string | null;
  last_error?: string | null;
  lastError?: string | null;
}

interface CrmStatusRow {
  status: string | null;
}

interface MysqlMarketingLeadExportStore {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
}

export interface MarketingLeadExportRow {
  leadEventId: string;
  occurredAt: string;
  email: string | null;
  fullName: string | null;
  companyName: string | null;
  role: string | null;
  serviceStates: string;
  language: string;
  sourcePath: string;
  nextUrl: string;
  notificationStatus: string;
  notificationAttemptCount: number;
  notificationLastError: string | null;
  crmHandoffStatus: string;
}

function limitValue(value: number | undefined) {
  return Math.max(1, Math.min(value ?? 500, 5000));
}

function parseMetadata(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringOrDefault(value: unknown, fallback: string) {
  return stringOrNull(value) ?? fallback;
}

function serviceStatesFor(metadata: Record<string, unknown>) {
  if (!Array.isArray(metadata.serviceStates)) return "";

  return metadata.serviceStates
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
    .join(";");
}

function nextUrlForLead(id: string) {
  return `/register?intent=demo&lead=${encodeURIComponent(id)}`;
}

function notificationDedupeKey(leadId: string) {
  return `marketing:request_demo:${leadId}:notification`;
}

function rowFromLeadEvent(
  lead: MarketingLeadEventRow,
  statuses: {
    notificationStatus?: string | null;
    notificationAttemptCount?: number | string | null;
    notificationLastError?: string | null;
    crmHandoffStatus?: string | null;
  },
): MarketingLeadExportRow {
  const metadata = parseMetadata(lead.metadata_json);

  return {
    leadEventId: lead.id,
    occurredAt: String(lead.occurred_at),
    email: stringOrNull(metadata.email),
    fullName: stringOrNull(metadata.fullName),
    companyName: stringOrNull(metadata.companyName),
    role: stringOrNull(metadata.role),
    serviceStates: serviceStatesFor(metadata),
    language: stringOrDefault(metadata.language, "en"),
    sourcePath: stringOrDefault(metadata.sourcePath, "/request-demo"),
    nextUrl: nextUrlForLead(lead.id),
    notificationStatus: statuses.notificationStatus ?? "missing",
    notificationAttemptCount: Number(statuses.notificationAttemptCount ?? 0),
    notificationLastError: statuses.notificationLastError ?? null,
    crmHandoffStatus: statuses.crmHandoffStatus ?? "missing",
  };
}

function getNotificationStatus(db: AppDatabase, leadId: string) {
  const row = db.$client
    .prepare("SELECT status, attempt_count, last_error FROM notification_outbox WHERE dedupe_key = ? LIMIT 1")
    .get(notificationDedupeKey(leadId)) as NotificationStatusRow | undefined;

  return {
    status: row?.status ?? null,
    attemptCount: row?.attempt_count ?? 0,
    lastError: row?.last_error ?? null,
  };
}

function getCrmHandoffStatus(db: AppDatabase, leadId: string) {
  const row = db.$client
    .prepare(`
      SELECT event_outbox.status AS status
      FROM event_log
      INNER JOIN event_outbox ON event_outbox.event_log_id = event_log.id
      WHERE event_log.event_name = ?
        AND event_log.target_type = 'marketing_lead'
        AND event_log.target_id = ?
        AND event_outbox.destination = ?
      ORDER BY event_log.occurred_at DESC, event_outbox.created_at DESC
      LIMIT 1
    `)
    .get(crmHandoffEventName, leadId, crmDestination) as CrmStatusRow | undefined;

  return row?.status ?? null;
}

export function getMarketingLeadExportRows(
  db: AppDatabase,
  options: { limit?: number } = {},
): MarketingLeadExportRow[] {
  const rows = db.$client
    .prepare(`
      SELECT id, occurred_at, metadata_json
      FROM event_log
      WHERE event_name = ?
      ORDER BY occurred_at DESC, id DESC
      LIMIT ?
    `)
    .all(requestDemoEventName, limitValue(options.limit)) as MarketingLeadEventRow[];

  return rows.map((lead) => {
    const notification = getNotificationStatus(db, lead.id);

    return rowFromLeadEvent(lead, {
      notificationStatus: notification.status,
      notificationAttemptCount: notification.attemptCount,
      notificationLastError: notification.lastError,
      crmHandoffStatus: getCrmHandoffStatus(db, lead.id),
    });
  });
}

async function getNotificationStatusFromMysql(mysql: MysqlMarketingLeadExportStore, leadId: string) {
  const row = await mysqlSelectOne<NotificationStatusRow>(
    mysql,
    `
      SELECT
        status,
        attempt_count AS attemptCount,
        last_error AS lastError
      FROM notification_outbox
      WHERE dedupe_key = ?
      LIMIT 1
    `,
    [notificationDedupeKey(leadId)],
  );

  return {
    status: row?.status ?? null,
    attemptCount: row?.attemptCount ?? 0,
    lastError: row?.lastError ?? null,
  };
}

async function getCrmHandoffStatusFromMysql(mysql: MysqlMarketingLeadExportStore, leadId: string) {
  const row = await mysqlSelectOne<CrmStatusRow>(
    mysql,
    `
      SELECT event_outbox.status AS status
      FROM event_log
      INNER JOIN event_outbox ON event_outbox.event_log_id = event_log.id
      WHERE event_log.event_name = ?
        AND event_log.target_type = 'marketing_lead'
        AND event_log.target_id = ?
        AND event_outbox.destination = ?
      ORDER BY event_log.occurred_at DESC, event_outbox.created_at DESC
      LIMIT 1
    `,
    [crmHandoffEventName, leadId, crmDestination],
  );

  return row?.status ?? null;
}

export async function getMarketingLeadExportRowsFromMysql(
  mysql: MysqlMarketingLeadExportStore,
  options: { limit?: number } = {},
): Promise<MarketingLeadExportRow[]> {
  const rows = await mysqlSelectMany<MarketingLeadEventRow>(
    mysql,
    `
      SELECT id, occurred_at, metadata_json
      FROM event_log
      WHERE event_name = ?
      ORDER BY occurred_at DESC, id DESC
      LIMIT ?
    `,
    [requestDemoEventName, limitValue(options.limit)],
  );

  return Promise.all(
    rows.map(async (lead) => {
      const notification = await getNotificationStatusFromMysql(mysql, lead.id);

      return rowFromLeadEvent(
        {
          ...lead,
          occurred_at: String(lead.occurred_at),
        },
        {
          notificationStatus: notification.status,
          notificationAttemptCount: notification.attemptCount,
          notificationLastError: notification.lastError,
          crmHandoffStatus: await getCrmHandoffStatusFromMysql(mysql, lead.id),
        },
      );
    }),
  );
}

const csvHeaders = [
  "lead_event_id",
  "occurred_at",
  "email",
  "full_name",
  "company_name",
  "role",
  "service_states",
  "language",
  "source_path",
  "next_url",
  "notification_status",
  "notification_attempt_count",
  "notification_last_error",
  "crm_handoff_status",
] as const;

function csvCell(value: string | null) {
  return `"${(value ?? "").replaceAll("\"", "\"\"")}"`;
}

export function renderMarketingLeadCsv(rows: MarketingLeadExportRow[]) {
  const body = rows.map((row) =>
    [
      row.leadEventId,
      row.occurredAt,
      row.email,
      row.fullName,
      row.companyName,
      row.role,
      row.serviceStates,
      row.language,
      row.sourcePath,
      row.nextUrl,
      row.notificationStatus,
      String(row.notificationAttemptCount),
      row.notificationLastError,
      row.crmHandoffStatus,
    ].map(csvCell).join(","),
  );

  return [csvHeaders.join(","), ...body].join("\n");
}
