import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase, type AppDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { createMysqlPool, isMysqlDatabaseUrlConfigured, requireMysqlDatabaseUrl } from "../src/server/db/mysql";
import { mysqlSelectMany } from "../src/server/db/mysql-runtime";
import { dataSources } from "../src/server/db/schema";
import {
  listLiveSourceHealthSnapshots,
  listLiveSourceHealthSnapshotsFromMysql,
  sourceHealthTrendBySource,
  type LiveSourceHealthSnapshot,
  type MysqlSourceHealthSnapshotReader,
} from "../src/server/source-validity/health-snapshots";
import type {
  LiveSourceHealthReport,
  LiveSourceHealthResult,
} from "../src/server/source-validity/live-source-health";

export type SourceHealthReportFormat = "markdown" | "json" | "csv";
export type SourceHealthReportRuntime = "sqlite" | "mysql";

export interface SourceHealthReportCliOptions {
  format: SourceHealthReportFormat;
  output: string | null;
  help: boolean;
}

export interface SourceHealthTriage {
  owner: string | null;
  disposition: string | null;
  nextReviewAt: string | null;
}

export interface SourceHealthTriageRow extends SourceHealthTriage {
  sourceId: string;
  stateCode: string;
}

export interface SourceHealthOperationalSource {
  stateCode: string;
  sourceId: string;
  label: string;
  url: string | null;
  status: LiveSourceHealthResult["status"];
  classification: string;
  operationalSeverity: string | null;
  recommendedAction: string | null;
  owner: string | null;
  disposition: string | null;
  nextReviewAt: string | null;
  checkedAt: string | null;
  httpStatus: number | null;
  errorCode: string | null;
  reason: string | null;
  currentStatus: string | null;
  currentStreak: number | null;
  sampleSize: number | null;
  healthyPercent: number | null;
  lastUnhealthyAt: string | null;
}

export interface SourceHealthOperationalReport {
  runtime: SourceHealthReportRuntime;
  generatedAt: string;
  snapshot: {
    id: string;
    ok: boolean;
    checkedAt: string;
    createdAt: string;
  } | null;
  summary: LiveSourceHealthReport["summary"];
  unhealthyClassificationCounts: Record<string, number>;
  sources: SourceHealthOperationalSource[];
}

type SqliteSnapshotDatabase = ReturnType<typeof createDatabase>;
type MysqlReportPool = MysqlSourceHealthSnapshotReader & {
  end: () => Promise<void>;
};

interface LoadSourceHealthReportDeps {
  createSqliteDatabase?: () => SqliteSnapshotDatabase;
  runSqliteMigrations?: (db: SqliteSnapshotDatabase) => void;
  closeSqliteDatabase?: (db: SqliteSnapshotDatabase) => void;
  listSqliteSnapshots?: typeof listLiveSourceHealthSnapshots;
  readSqliteTriageRows?: (db: SqliteSnapshotDatabase) => SourceHealthTriageRow[];
  createMysqlPoolForUrl?: (databaseUrl: string) => MysqlReportPool;
  listMysqlSnapshots?: typeof listLiveSourceHealthSnapshotsFromMysql;
  readMysqlTriageRows?: (mysql: MysqlSourceHealthSnapshotReader) => Promise<SourceHealthTriageRow[]>;
  now?: () => string;
  checkLiveSourceHealth?: unknown;
}

interface BuildSourceHealthReportInput {
  runtime: SourceHealthReportRuntime;
  generatedAt: string;
  snapshots: LiveSourceHealthSnapshot[];
  triageBySourceId: Map<string, SourceHealthTriage>;
}

const emptySummary: LiveSourceHealthReport["summary"] = {
  total: 0,
  healthy: 0,
  unhealthy: 0,
  skipped: 0,
};

export function formatSourceHealthReportHelp() {
  return [
    "Source Health Report Export",
    "",
    "Usage:",
    "  npm run source:health:report -- --format=markdown",
    "  npm run source:health:report -- --format=json --output reports/source-health.json",
    "  npm run source:health:report -- --format=csv --output reports/source-health.csv",
    "",
    "Options:",
    "  --format <value>  markdown, json, or csv. Default: markdown.",
    "  --output <path>   Write the report to a file instead of stdout.",
    "  --help            Print this help.",
    "",
    "This command reads the latest persisted source_health_snapshots row in the current DB runtime.",
    "It does not run live source probes or call public procurement portals.",
  ].join("\n");
}

export function parseSourceHealthReportArgs(argv: string[]): SourceHealthReportCliOptions {
  const options: SourceHealthReportCliOptions = {
    format: "markdown",
    output: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg.startsWith("--format=")) {
      options.format = parseReportFormat(arg.slice("--format=".length));
    } else if (arg === "--format") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--format requires markdown, json, or csv.");
      }
      options.format = parseReportFormat(value);
      index += 1;
    } else if (arg.startsWith("--output=")) {
      options.output = parseOutputPath(arg.slice("--output=".length));
    } else if (arg === "--output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--output requires a file path.");
      }
      options.output = parseOutputPath(value);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parseReportFormat(value: string): SourceHealthReportFormat {
  if (value === "markdown" || value === "json" || value === "csv") return value;
  throw new Error("--format must be markdown, json, or csv.");
}

function parseOutputPath(value: string) {
  const output = value.trim();
  if (!output) {
    throw new Error("--output requires a file path.");
  }

  return output;
}

function missingOptionalTriageField(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("no such table: data_sources") ||
    message.includes("no such column: live_health") ||
    message.includes("unknown column") ||
    message.includes("doesn't exist")
  );
}

function toNullableString(value: unknown) {
  if (value === null || value === undefined) return null;
  const stringValue = String(value).trim();
  return stringValue ? sanitizeReportText(stringValue, 160) : null;
}

export function readSqliteSourceHealthTriageRows(db: AppDatabase): SourceHealthTriageRow[] {
  try {
    return db
      .select({
        sourceId: dataSources.id,
        stateCode: dataSources.stateCode,
        owner: dataSources.liveHealthOwner,
        disposition: dataSources.liveHealthDisposition,
        nextReviewAt: dataSources.liveHealthNextReviewAt,
      })
      .from(dataSources)
      .all()
      .map((row) => ({
        sourceId: row.sourceId,
        stateCode: row.stateCode,
        owner: toNullableString(row.owner),
        disposition: toNullableString(row.disposition),
        nextReviewAt: toNullableString(row.nextReviewAt),
      }));
  } catch (error) {
    if (missingOptionalTriageField(error)) return [];
    throw error;
  }
}

export async function readMysqlSourceHealthTriageRows(
  mysql: MysqlSourceHealthSnapshotReader,
): Promise<SourceHealthTriageRow[]> {
  try {
    const rows = await mysqlSelectMany<{
      sourceId: string;
      stateCode: string;
      owner: string | null;
      disposition: string | null;
      nextReviewAt: string | null;
    }>(
      mysql,
      `
        SELECT
          id AS sourceId,
          state_code AS stateCode,
          live_health_owner AS owner,
          live_health_disposition AS disposition,
          live_health_next_review_at AS nextReviewAt
        FROM data_sources
      `,
    );

    return rows.map((row) => ({
      sourceId: row.sourceId,
      stateCode: row.stateCode,
      owner: toNullableString(row.owner),
      disposition: toNullableString(row.disposition),
      nextReviewAt: toNullableString(row.nextReviewAt),
    }));
  } catch (error) {
    if (missingOptionalTriageField(error)) return [];
    throw error;
  }
}

function triageMapFromRows(rows: SourceHealthTriageRow[]) {
  const triageBySourceId = new Map<string, SourceHealthTriage>();

  for (const row of rows) {
    const triage = {
      owner: row.owner,
      disposition: row.disposition,
      nextReviewAt: row.nextReviewAt,
    } satisfies SourceHealthTriage;

    triageBySourceId.set(row.sourceId, triage);
    triageBySourceId.set(row.sourceId.toLowerCase(), triage);
    triageBySourceId.set(row.stateCode.toLowerCase(), triage);
  }

  return triageBySourceId;
}

function classificationFor(result: LiveSourceHealthResult) {
  return sanitizeReportText(result.classification ?? result.errorCode ?? result.status, 80) || "unknown";
}

function sortedCounts(counts: Record<string, number>) {
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  ) as Record<string, number>;
}

function unhealthyClassificationCounts(results: LiveSourceHealthResult[]) {
  const counts: Record<string, number> = {};

  for (const result of results) {
    if (result.status !== "unhealthy") continue;
    const classification = classificationFor(result);
    counts[classification] = (counts[classification] ?? 0) + 1;
  }

  return sortedCounts(counts);
}

function operationalSeveritySortValue(value: string | null) {
  switch (value) {
    case "critical":
      return 0;
    case "warning":
      return 1;
    case "info":
      return 2;
    case "none":
      return 3;
    default:
      return 4;
  }
}

function statusSortValue(value: LiveSourceHealthResult["status"]) {
  switch (value) {
    case "unhealthy":
      return 0;
    case "skipped":
      return 1;
    case "healthy":
      return 2;
    default:
      return 3;
  }
}

export function sanitizeReportText(value: string | null | undefined, maxLength = 240) {
  if (value === null || value === undefined) return null;

  const sensitiveKeyPattern = [
    "api[-_ ]?key",
    "access[-_ ]?token",
    "refresh[-_ ]?token",
    "api[-_ ]?token",
    "token",
    "password",
    "secret",
    "session",
    "authorization",
  ].join("|");
  const sensitiveAssignment = new RegExp(
    `\\b(${sensitiveKeyPattern})\\s*[:=]\\s*["']?[^"'\\s,;|)]+`,
    "gi",
  );

  const sanitized = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(sensitiveAssignment, "$1=[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\bhttps?:\/\/[^\s)>,|]+/gi, "[URL_REDACTED]")
    .replace(/\s+/g, " ")
    .trim();

  if (sanitized.length <= maxLength) return sanitized;
  const truncated = `${sanitized.slice(0, maxLength - 1).trimEnd()}...`;
  if (sanitized.includes("[REDACTED]") && !truncated.includes("[REDACTED]")) {
    return `${truncated} [REDACTED]`;
  }

  return truncated;
}

export function sanitizeReportUrl(value: string | null | undefined, maxLength = 240) {
  if (value === null || value === undefined) return null;
  const rawValue = value.trim();
  if (!rawValue) return null;

  try {
    const url = new URL(rawValue);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";

    const sanitized = url.toString();
    if (sanitized.length <= maxLength) return sanitized;

    return `${sanitized.slice(0, maxLength - 1).trimEnd()}...`;
  } catch {
    return null;
  }
}

function sourceOperationalRow(
  result: LiveSourceHealthResult,
  checkedAt: string,
  triage: SourceHealthTriage | undefined,
  trend: ReturnType<typeof sourceHealthTrendBySource>,
): SourceHealthOperationalSource {
  const sourceTrend = trend.get(result.sourceId) ?? trend.get(result.sourceId.toLowerCase()) ?? trend.get(result.stateCode.toLowerCase());

  return {
    stateCode: sanitizeReportText(result.stateCode, 16) ?? "",
    sourceId: sanitizeReportText(result.sourceId, 120) ?? "",
    label: sanitizeReportText(result.label, 160) ?? "",
    url: sanitizeReportUrl(result.url, 300),
    status: result.status,
    classification: classificationFor(result),
    operationalSeverity: sanitizeReportText(result.operationalSeverity, 80),
    recommendedAction: sanitizeReportText(result.recommendedAction, 120),
    owner: triage?.owner ?? null,
    disposition: triage?.disposition ?? null,
    nextReviewAt: triage?.nextReviewAt ?? null,
    checkedAt: sanitizeReportText(result.checkedAt ?? checkedAt, 80),
    httpStatus: result.httpStatus,
    errorCode: sanitizeReportText(result.errorCode, 80),
    reason: sanitizeReportText(result.reason ?? result.errorMessage ?? result.error ?? result.statusText, 240),
    currentStatus: sourceTrend?.currentStatus ?? null,
    currentStreak: sourceTrend?.currentStreak ?? null,
    sampleSize: sourceTrend?.sampleSize ?? null,
    healthyPercent: sourceTrend?.healthyPercent ?? null,
    lastUnhealthyAt: sourceTrend?.lastUnhealthyAt ?? null,
  };
}

export function buildSourceHealthOperationalReport(
  input: BuildSourceHealthReportInput,
): SourceHealthOperationalReport {
  const latestSnapshot = input.snapshots[0] ?? null;
  const trend = sourceHealthTrendBySource(input.snapshots);
  const sources = latestSnapshot
    ? latestSnapshot.report.results
        .map((result) =>
          sourceOperationalRow(
            result,
            latestSnapshot.checkedAt,
            input.triageBySourceId.get(result.sourceId) ??
              input.triageBySourceId.get(result.sourceId.toLowerCase()) ??
              input.triageBySourceId.get(result.stateCode.toLowerCase()),
            trend,
          ),
        )
        .sort((left, right) => {
          const statusDelta = statusSortValue(left.status) - statusSortValue(right.status);
          if (statusDelta !== 0) return statusDelta;
          const severityDelta =
            operationalSeveritySortValue(left.operationalSeverity) -
            operationalSeveritySortValue(right.operationalSeverity);
          if (severityDelta !== 0) return severityDelta;
          return `${left.stateCode} ${left.sourceId}`.localeCompare(`${right.stateCode} ${right.sourceId}`);
        })
    : [];

  return {
    runtime: input.runtime,
    generatedAt: input.generatedAt,
    snapshot: latestSnapshot
      ? {
          id: latestSnapshot.id,
          ok: latestSnapshot.ok,
          checkedAt: latestSnapshot.checkedAt,
          createdAt: latestSnapshot.createdAt,
        }
      : null,
    summary: latestSnapshot?.report.summary ?? emptySummary,
    unhealthyClassificationCounts: unhealthyClassificationCounts(latestSnapshot?.report.results ?? []),
    sources,
  };
}

export async function loadSourceHealthOperationalReport(
  env: NodeJS.ProcessEnv = process.env,
  deps: LoadSourceHealthReportDeps = {},
): Promise<SourceHealthOperationalReport> {
  const generatedAt = deps.now?.() ?? new Date().toISOString();

  if (isMysqlDatabaseUrlConfigured(env)) {
    const pool = (deps.createMysqlPoolForUrl ?? createMysqlPool)(requireMysqlDatabaseUrl(env));

    try {
      const snapshots = await (deps.listMysqlSnapshots ?? listLiveSourceHealthSnapshotsFromMysql)(pool, 10);
      const triageRows = await (deps.readMysqlTriageRows ?? readMysqlSourceHealthTriageRows)(pool);

      return buildSourceHealthOperationalReport({
        runtime: "mysql",
        generatedAt,
        snapshots,
        triageBySourceId: triageMapFromRows(triageRows),
      });
    } finally {
      await pool.end();
    }
  }

  const db = (deps.createSqliteDatabase ?? createDatabase)();
  try {
    (deps.runSqliteMigrations ?? runMigrations)(db);
    const snapshots = (deps.listSqliteSnapshots ?? listLiveSourceHealthSnapshots)(db, 10);
    const triageRows = (deps.readSqliteTriageRows ?? readSqliteSourceHealthTriageRows)(db);

    return buildSourceHealthOperationalReport({
      runtime: "sqlite",
      generatedAt,
      snapshots,
      triageBySourceId: triageMapFromRows(triageRows),
    });
  } finally {
    (deps.closeSqliteDatabase ?? ((database) => database.$client.close()))(db);
  }
}

function displayValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function markdownCell(value: string | number | null | undefined) {
  return displayValue(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function trendLabel(source: SourceHealthOperationalSource) {
  if (!source.currentStatus || source.currentStreak === null) return "-";

  const sample = source.sampleSize === null ? "" : `, ${source.sampleSize} samples`;
  const healthy = source.healthyPercent === null ? "" : `, ${source.healthyPercent}% healthy`;
  return `${source.currentStatus} x${source.currentStreak}${sample}${healthy}`;
}

function formatMarkdownReport(report: SourceHealthOperationalReport) {
  const lines = [
    "# Source Health Report",
    "",
    `Generated at: ${report.generatedAt}`,
    `Runtime: ${report.runtime}`,
    report.snapshot
      ? `Snapshot checked at: ${report.snapshot.checkedAt} (created ${report.snapshot.createdAt})`
      : "Snapshot: no persisted source health snapshot found",
    "",
    "## Summary",
    "",
    "| metric | count |",
    "|---|---:|",
    `| total | ${report.summary.total} |`,
    `| healthy | ${report.summary.healthy} |`,
    `| unhealthy | ${report.summary.unhealthy} |`,
    `| skipped | ${report.summary.skipped} |`,
    "",
    "## Unhealthy Classification Counts",
    "",
    "| classification | count |",
    "|---|---:|",
  ];

  const countEntries = Object.entries(report.unhealthyClassificationCounts);
  if (countEntries.length === 0) {
    lines.push("| none | 0 |");
  } else {
    for (const [classification, count] of countEntries) {
      lines.push(`| ${markdownCell(classification)} | ${count} |`);
    }
  }

  lines.push(
    "",
    "## Sources",
    "",
    "| state | source | label | source URL | status | classification | owner | disposition | next review | trend | recommended action | reason |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  );

  if (report.sources.length === 0) {
    lines.push("| - | - | - | - | - | - | - | - | - | - | - | No persisted source health snapshot found. |");
  } else {
    for (const source of report.sources) {
      lines.push(
        [
          source.stateCode,
          source.sourceId,
          source.label,
          source.url,
          source.status,
          source.classification,
          source.owner,
          source.disposition,
          source.nextReviewAt,
          trendLabel(source),
          source.recommendedAction,
          source.reason,
        ]
          .map(markdownCell)
          .join(" | ")
          .replace(/^/, "| ")
          .replace(/$/, " |"),
      );
    }
  }

  return lines.join("\n");
}

function csvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);

  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function formatCsvReport(report: SourceHealthOperationalReport) {
  const rows: Array<Array<string | number | null | undefined>> = [
    [
      "section",
      "key",
      "value",
      "state_code",
      "source_id",
      "label",
      "source_url",
      "status",
      "classification",
      "owner",
      "disposition",
      "next_review_at",
      "current_status",
      "current_streak",
      "sample_size",
      "healthy_percent",
      "recommended_action",
      "operational_severity",
      "reason",
    ],
    ["summary", "total", report.summary.total],
    ["summary", "healthy", report.summary.healthy],
    ["summary", "unhealthy", report.summary.unhealthy],
    ["summary", "skipped", report.summary.skipped],
  ];

  const countEntries = Object.entries(report.unhealthyClassificationCounts);
  if (countEntries.length === 0) {
    rows.push(["classification", "none", 0]);
  } else {
    for (const [classification, count] of countEntries) {
      rows.push(["classification", classification, count]);
    }
  }

  for (const source of report.sources) {
    rows.push([
      "source",
      "",
      "",
      source.stateCode,
      source.sourceId,
      source.label,
      source.url,
      source.status,
      source.classification,
      source.owner,
      source.disposition,
      source.nextReviewAt,
      source.currentStatus,
      source.currentStreak,
      source.sampleSize,
      source.healthyPercent,
      source.recommendedAction,
      source.operationalSeverity,
      source.reason,
    ]);
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function formatSourceHealthOperationalReport(
  report: SourceHealthOperationalReport,
  format: SourceHealthReportFormat = "markdown",
) {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }
  if (format === "csv") {
    return formatCsvReport(report);
  }

  return formatMarkdownReport(report);
}

function writeReportOutput(outputPath: string, text: string) {
  const absoluteOutputPath = path.resolve(outputPath);
  mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
  writeFileSync(absoluteOutputPath, text.endsWith("\n") ? text : `${text}\n`, "utf8");
}

async function main() {
  const options = parseSourceHealthReportArgs(process.argv.slice(2));

  if (options.help) {
    console.log(formatSourceHealthReportHelp());
    return;
  }

  const report = await loadSourceHealthOperationalReport();
  const output = formatSourceHealthOperationalReport(report, options.format);

  if (options.output) {
    writeReportOutput(options.output, output);
    return;
  }

  console.log(output);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
