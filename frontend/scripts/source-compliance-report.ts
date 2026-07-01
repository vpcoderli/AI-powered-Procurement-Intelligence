import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase, type AppDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { createMysqlPool, isMysqlDatabaseUrlConfigured, requireMysqlDatabaseUrl } from "../src/server/db/mysql";
import { mysqlSelectMany } from "../src/server/db/mysql-runtime";
import { dataSources } from "../src/server/db/schema";
import {
  listSourceComplianceSnapshots,
  listSourceComplianceSnapshotsFromMysql,
  type MysqlSourceComplianceSnapshotReader,
  type SourceComplianceSnapshot,
} from "../src/server/source-validity/compliance-snapshots";
import type { SourceComplianceReport, SourceComplianceResult } from "../src/server/source-validity/robots-compliance-scan";

// Data-source compliance ledger report export (P1-2).
//
// Reads the latest persisted robots.txt pre-check snapshot plus the
// per-source compliance ledger fields on data_sources (ToS reviewed,
// reviewer, legal opinion reference, review due date). It does not call
// public portals or make any legal determination — see
// docs/operations/data-source-compliance-ledger.md.

export type SourceComplianceReportFormat = "markdown" | "json" | "csv";
export type SourceComplianceReportRuntime = "sqlite" | "mysql";

export interface SourceComplianceReportCliOptions {
  format: SourceComplianceReportFormat;
  output: string | null;
  help: boolean;
}

export interface SourceComplianceLedgerRow {
  sourceId: string;
  stateCode: string;
  robotsTxtStatus: string | null;
  robotsTxtCheckedAt: string | null;
  robotsTxtHash: string | null;
  robotsTxtDisallowsCrawledPaths: boolean | null;
  robotsTxtFlagReason: string | null;
  tosReviewed: boolean | null;
  tosReviewedAt: string | null;
  tosUrl: string | null;
  complianceReviewer: string | null;
  legalOpinionReference: string | null;
  complianceReviewDueAt: string | null;
  complianceNotes: string | null;
}

export interface SourceComplianceLedgerEntry extends SourceComplianceLedgerRow {
  label: string;
  baseUrl: string | null;
  legallyApproved: boolean;
}

export interface SourceComplianceOperationalReport {
  runtime: SourceComplianceReportRuntime;
  generatedAt: string;
  snapshot: {
    id: string;
    ok: boolean;
    checkedAt: string;
    createdAt: string;
  } | null;
  summary: SourceComplianceReport["summary"];
  entries: SourceComplianceLedgerEntry[];
}

type SqliteSnapshotDatabase = ReturnType<typeof createDatabase>;
type MysqlReportPool = MysqlSourceComplianceSnapshotReader & {
  end: () => Promise<void>;
};

interface LoadSourceComplianceReportDeps {
  createSqliteDatabase?: () => SqliteSnapshotDatabase;
  runSqliteMigrations?: (db: SqliteSnapshotDatabase) => void;
  closeSqliteDatabase?: (db: SqliteSnapshotDatabase) => void;
  listSqliteSnapshots?: typeof listSourceComplianceSnapshots;
  readSqliteLedgerRows?: (db: SqliteSnapshotDatabase) => SourceComplianceLedgerRow[];
  createMysqlPoolForUrl?: (databaseUrl: string) => MysqlReportPool;
  listMysqlSnapshots?: typeof listSourceComplianceSnapshotsFromMysql;
  readMysqlLedgerRows?: (mysql: MysqlSourceComplianceSnapshotReader) => Promise<SourceComplianceLedgerRow[]>;
  now?: () => string;
}

const emptySummary: SourceComplianceReport["summary"] = {
  total: 0,
  clear: 0,
  flagged: 0,
  unreachable: 0,
};

export function formatSourceComplianceReportHelp() {
  return [
    "Source Compliance Ledger Report Export",
    "",
    "Usage:",
    "  npm run source:compliance:report -- --format=markdown",
    "  npm run source:compliance:report -- --format=json --output reports/source-compliance.json",
    "  npm run source:compliance:report -- --format=csv --output reports/source-compliance.csv",
    "",
    "Options:",
    "  --format <value>  markdown, json, or csv. Default: markdown.",
    "  --output <path>   Write the report to a file instead of stdout.",
    "  --help            Print this help.",
    "",
    "Reads the latest persisted source_compliance_snapshots row plus per-source ledger fields",
    "(ToS reviewed, reviewer, legal opinion reference, review due date) from the current DB runtime.",
    "This is a signal/triage report, not a legal determination. See",
    "docs/operations/data-source-compliance-ledger.md.",
  ].join("\n");
}

export function parseSourceComplianceReportArgs(argv: string[]): SourceComplianceReportCliOptions {
  const options: SourceComplianceReportCliOptions = {
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

function parseReportFormat(value: string): SourceComplianceReportFormat {
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

function missingOptionalLedgerField(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  return (
    message.includes("no such table: data_sources") ||
    message.includes("no such column: robots_txt") ||
    message.includes("no such column: tos_") ||
    message.includes("no such column: compliance_") ||
    message.includes("no such column: legal_opinion") ||
    message.includes("unknown column") ||
    message.includes("doesn't exist")
  );
}

function toNullableString(value: unknown, maxLength = 400) {
  if (value === null || value === undefined) return null;
  const stringValue = String(value).trim();
  if (!stringValue) return null;
  return stringValue.length > maxLength ? `${stringValue.slice(0, maxLength - 1)}...` : stringValue;
}

function toNullableBoolean(value: unknown) {
  if (value === null || value === undefined) return null;
  return Number(value) === 1;
}

export function readSqliteSourceComplianceLedgerRows(db: AppDatabase): SourceComplianceLedgerRow[] {
  try {
    return db
      .select({
        sourceId: dataSources.id,
        stateCode: dataSources.stateCode,
        robotsTxtStatus: dataSources.robotsTxtStatus,
        robotsTxtCheckedAt: dataSources.robotsTxtCheckedAt,
        robotsTxtHash: dataSources.robotsTxtHash,
        robotsTxtDisallowsCrawledPaths: dataSources.robotsTxtDisallowsCrawledPaths,
        robotsTxtFlagReason: dataSources.robotsTxtFlagReason,
        tosReviewed: dataSources.tosReviewed,
        tosReviewedAt: dataSources.tosReviewedAt,
        tosUrl: dataSources.tosUrl,
        complianceReviewer: dataSources.complianceReviewer,
        legalOpinionReference: dataSources.legalOpinionReference,
        complianceReviewDueAt: dataSources.complianceReviewDueAt,
        complianceNotes: dataSources.complianceNotes,
      })
      .from(dataSources)
      .all()
      .map((row) => ({
        sourceId: row.sourceId,
        stateCode: row.stateCode,
        robotsTxtStatus: toNullableString(row.robotsTxtStatus, 40),
        robotsTxtCheckedAt: toNullableString(row.robotsTxtCheckedAt, 40),
        robotsTxtHash: toNullableString(row.robotsTxtHash, 80),
        robotsTxtDisallowsCrawledPaths: toNullableBoolean(row.robotsTxtDisallowsCrawledPaths),
        robotsTxtFlagReason: toNullableString(row.robotsTxtFlagReason, 240),
        tosReviewed: toNullableBoolean(row.tosReviewed),
        tosReviewedAt: toNullableString(row.tosReviewedAt, 40),
        tosUrl: toNullableString(row.tosUrl, 300),
        complianceReviewer: toNullableString(row.complianceReviewer, 160),
        legalOpinionReference: toNullableString(row.legalOpinionReference, 300),
        complianceReviewDueAt: toNullableString(row.complianceReviewDueAt, 40),
        complianceNotes: toNullableString(row.complianceNotes, 300),
      }));
  } catch (error) {
    if (missingOptionalLedgerField(error)) return [];
    throw error;
  }
}

export async function readMysqlSourceComplianceLedgerRows(
  mysql: MysqlSourceComplianceSnapshotReader,
): Promise<SourceComplianceLedgerRow[]> {
  try {
    const rows = await mysqlSelectMany<Record<string, unknown> & { sourceId: string; stateCode: string }>(
      mysql,
      `
        SELECT
          id AS sourceId,
          state_code AS stateCode,
          robots_txt_status AS robotsTxtStatus,
          robots_txt_checked_at AS robotsTxtCheckedAt,
          robots_txt_hash AS robotsTxtHash,
          robots_txt_disallows_crawled_paths AS robotsTxtDisallowsCrawledPaths,
          robots_txt_flag_reason AS robotsTxtFlagReason,
          tos_reviewed AS tosReviewed,
          tos_reviewed_at AS tosReviewedAt,
          tos_url AS tosUrl,
          compliance_reviewer AS complianceReviewer,
          legal_opinion_reference AS legalOpinionReference,
          compliance_review_due_at AS complianceReviewDueAt,
          compliance_notes AS complianceNotes
        FROM data_sources
      `,
    );

    return rows.map((row) => ({
      sourceId: row.sourceId,
      stateCode: row.stateCode,
      robotsTxtStatus: toNullableString(row.robotsTxtStatus, 40),
      robotsTxtCheckedAt: toNullableString(row.robotsTxtCheckedAt, 40),
      robotsTxtHash: toNullableString(row.robotsTxtHash, 80),
      robotsTxtDisallowsCrawledPaths: toNullableBoolean(row.robotsTxtDisallowsCrawledPaths),
      robotsTxtFlagReason: toNullableString(row.robotsTxtFlagReason, 240),
      tosReviewed: toNullableBoolean(row.tosReviewed),
      tosReviewedAt: toNullableString(row.tosReviewedAt, 40),
      tosUrl: toNullableString(row.tosUrl, 300),
      complianceReviewer: toNullableString(row.complianceReviewer, 160),
      legalOpinionReference: toNullableString(row.legalOpinionReference, 300),
      complianceReviewDueAt: toNullableString(row.complianceReviewDueAt, 40),
      complianceNotes: toNullableString(row.complianceNotes, 300),
    }));
  } catch (error) {
    if (missingOptionalLedgerField(error)) return [];
    throw error;
  }
}

function ledgerMapFromRows(rows: SourceComplianceLedgerRow[]) {
  const bySourceId = new Map<string, SourceComplianceLedgerRow>();

  for (const row of rows) {
    bySourceId.set(row.sourceId, row);
    bySourceId.set(row.sourceId.toLowerCase(), row);
    bySourceId.set(row.stateCode.toLowerCase(), row);
  }

  return bySourceId;
}

function legallyApprovedFor(row: SourceComplianceLedgerRow | null, scanResult: SourceComplianceResult | null) {
  const tosReviewed = row?.tosReviewed === true;
  const notFlaggedByRobots = scanResult ? !scanResult.flagged : row?.robotsTxtDisallowsCrawledPaths !== true;
  return tosReviewed && notFlaggedByRobots;
}

function entryFor(
  scanResult: SourceComplianceResult | null,
  ledgerRow: SourceComplianceLedgerRow | null,
  stateCode: string,
  sourceId: string,
): SourceComplianceLedgerEntry {
  const row: SourceComplianceLedgerRow = ledgerRow ?? {
    sourceId,
    stateCode,
    robotsTxtStatus: scanResult?.status ?? null,
    robotsTxtCheckedAt: scanResult?.checkedAt ?? null,
    robotsTxtHash: scanResult?.robotsTxtHash ?? null,
    robotsTxtDisallowsCrawledPaths: scanResult?.disallowsCrawledPaths ?? null,
    robotsTxtFlagReason: scanResult?.flagReason ?? null,
    tosReviewed: null,
    tosReviewedAt: null,
    tosUrl: null,
    complianceReviewer: null,
    legalOpinionReference: null,
    complianceReviewDueAt: null,
    complianceNotes: null,
  };

  return {
    ...row,
    label: scanResult?.label ?? sourceId,
    baseUrl: scanResult?.baseUrl ?? null,
    legallyApproved: legallyApprovedFor(row, scanResult),
  };
}

export function buildSourceComplianceOperationalReport(input: {
  runtime: SourceComplianceReportRuntime;
  generatedAt: string;
  snapshots: SourceComplianceSnapshot[];
  ledgerRows: SourceComplianceLedgerRow[];
}): SourceComplianceOperationalReport {
  const latestSnapshot = input.snapshots[0] ?? null;
  const ledgerBySourceId = ledgerMapFromRows(input.ledgerRows);
  const seen = new Set<string>();
  const entries: SourceComplianceLedgerEntry[] = [];

  if (latestSnapshot) {
    for (const result of latestSnapshot.report.results) {
      const ledgerRow =
        ledgerBySourceId.get(result.sourceId) ?? ledgerBySourceId.get(result.stateCode.toLowerCase()) ?? null;
      entries.push(entryFor(result, ledgerRow, result.stateCode, result.sourceId));
      seen.add(result.sourceId);
    }
  }

  for (const row of input.ledgerRows) {
    if (seen.has(row.sourceId)) continue;
    entries.push(entryFor(null, row, row.stateCode, row.sourceId));
    seen.add(row.sourceId);
  }

  entries.sort((left, right) => `${left.stateCode} ${left.sourceId}`.localeCompare(`${right.stateCode} ${right.sourceId}`));

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
    entries,
  };
}

export async function loadSourceComplianceOperationalReport(
  env: NodeJS.ProcessEnv = process.env,
  deps: LoadSourceComplianceReportDeps = {},
): Promise<SourceComplianceOperationalReport> {
  const generatedAt = deps.now?.() ?? new Date().toISOString();

  if (isMysqlDatabaseUrlConfigured(env)) {
    const pool = (deps.createMysqlPoolForUrl ?? createMysqlPool)(requireMysqlDatabaseUrl(env));

    try {
      const snapshots = await (deps.listMysqlSnapshots ?? listSourceComplianceSnapshotsFromMysql)(pool, 10);
      const ledgerRows = await (deps.readMysqlLedgerRows ?? readMysqlSourceComplianceLedgerRows)(pool);

      return buildSourceComplianceOperationalReport({
        runtime: "mysql",
        generatedAt,
        snapshots,
        ledgerRows,
      });
    } finally {
      await pool.end();
    }
  }

  const db = (deps.createSqliteDatabase ?? createDatabase)();
  try {
    (deps.runSqliteMigrations ?? runMigrations)(db);
    const snapshots = (deps.listSqliteSnapshots ?? listSourceComplianceSnapshots)(db, 10);
    const ledgerRows = (deps.readSqliteLedgerRows ?? readSqliteSourceComplianceLedgerRows)(db);

    return buildSourceComplianceOperationalReport({
      runtime: "sqlite",
      generatedAt,
      snapshots,
      ledgerRows,
    });
  } finally {
    (deps.closeSqliteDatabase ?? ((database) => database.$client.close()))(db);
  }
}

function displayValue(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

function markdownCell(value: string | number | boolean | null | undefined) {
  return displayValue(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatMarkdownReport(report: SourceComplianceOperationalReport) {
  const lines = [
    "# Source Compliance Ledger Report",
    "",
    `Generated at: ${report.generatedAt}`,
    `Runtime: ${report.runtime}`,
    report.snapshot
      ? `Latest robots.txt scan checked at: ${report.snapshot.checkedAt} (created ${report.snapshot.createdAt})`
      : "Snapshot: no persisted source compliance snapshot found. Run `npm run source:compliance:scan -- --all --persist`.",
    "",
    "This report is an automated triage signal only, not a legal determination.",
    "`legallyApproved` below only reflects whether a human has recorded ToS review AND robots.txt did not flag the source.",
    "It does NOT mean legal has issued a formal opinion — see docs/operations/data-source-compliance-ledger.md.",
    "",
    "## Summary",
    "",
    "| metric | count |",
    "|---|---:|",
    `| total (last scan) | ${report.summary.total} |`,
    `| clear (last scan) | ${report.summary.clear} |`,
    `| flagged (last scan) | ${report.summary.flagged} |`,
    `| unreachable (last scan) | ${report.summary.unreachable} |`,
    `| ToS-reviewed + not flagged | ${report.entries.filter((entry) => entry.legallyApproved).length} / ${report.entries.length} |`,
    "",
    "## Sources",
    "",
    "| state | source | robots status | robots flag reason | ToS reviewed | ToS reviewer | legal opinion ref | review due | ledger-approved |",
    "|---|---|---|---|---|---|---|---|---|",
  ];

  if (report.entries.length === 0) {
    lines.push("| - | - | - | - | - | - | - | - | No ledger rows found. |");
  } else {
    for (const entry of report.entries) {
      lines.push(
        [
          entry.stateCode,
          entry.sourceId,
          entry.robotsTxtStatus,
          entry.robotsTxtFlagReason,
          entry.tosReviewed,
          entry.complianceReviewer,
          entry.legalOpinionReference,
          entry.complianceReviewDueAt,
          entry.legallyApproved,
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

function csvCell(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) return "";
  const stringValue = typeof value === "boolean" ? (value ? "yes" : "no") : String(value);

  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function formatCsvReport(report: SourceComplianceOperationalReport) {
  const rows: Array<Array<string | number | boolean | null | undefined>> = [
    [
      "section",
      "key",
      "value",
      "state_code",
      "source_id",
      "robots_txt_status",
      "robots_txt_flag_reason",
      "tos_reviewed",
      "tos_reviewed_at",
      "tos_url",
      "compliance_reviewer",
      "legal_opinion_reference",
      "compliance_review_due_at",
      "compliance_notes",
      "ledger_approved",
    ],
    ["summary", "total", report.summary.total],
    ["summary", "clear", report.summary.clear],
    ["summary", "flagged", report.summary.flagged],
    ["summary", "unreachable", report.summary.unreachable],
  ];

  for (const entry of report.entries) {
    rows.push([
      "source",
      "",
      "",
      entry.stateCode,
      entry.sourceId,
      entry.robotsTxtStatus,
      entry.robotsTxtFlagReason,
      entry.tosReviewed,
      entry.tosReviewedAt,
      entry.tosUrl,
      entry.complianceReviewer,
      entry.legalOpinionReference,
      entry.complianceReviewDueAt,
      entry.complianceNotes,
      entry.legallyApproved,
    ]);
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function formatSourceComplianceOperationalReport(
  report: SourceComplianceOperationalReport,
  format: SourceComplianceReportFormat = "markdown",
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
  const options = parseSourceComplianceReportArgs(process.argv.slice(2));

  if (options.help) {
    console.log(formatSourceComplianceReportHelp());
    return;
  }

  const report = await loadSourceComplianceOperationalReport();
  const output = formatSourceComplianceOperationalReport(report, options.format);

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
