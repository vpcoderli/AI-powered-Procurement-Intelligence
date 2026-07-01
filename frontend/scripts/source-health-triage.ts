import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  updateAdminDataSource,
  updateAdminDataSourceFromMysql,
  type UpdateAdminDataSourceInput,
} from "../src/server/admin/data-sources-repository";
import { createDatabase, type AppDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { createMysqlPool, isMysqlDatabaseUrlConfigured, requireMysqlDatabaseUrl } from "../src/server/db/mysql";
import {
  loadSourceHealthOperationalReport,
  sanitizeReportText,
  type SourceHealthOperationalReport,
  type SourceHealthOperationalSource,
} from "./source-health-report";

export type SourceHealthTriageFormat = "markdown" | "json";

export interface SourceHealthTriageCliOptions {
  allUnhealthy: boolean;
  apply: boolean;
  format: SourceHealthTriageFormat;
  help: boolean;
  nextReviewDays: number;
  output: string | null;
  owner: string | null;
}

export interface SourceHealthTriagePlanEntry {
  sourceId: string;
  stateCode: string;
  label: string;
  classification: string;
  recommendedAction: string | null;
  operationalSeverity: string | null;
  previous: {
    owner: string | null;
    disposition: string | null;
    nextReviewAt: string | null;
  };
  next: {
    owner: string;
    disposition: string;
    nextReviewAt: string;
    notes: string;
    reviewedAt: string;
  };
}

export interface SourceHealthTriagePlan {
  generatedAt: string;
  snapshotId: string | null;
  snapshotCheckedAt: string | null;
  owner: string;
  onlyMissing: boolean;
  applyCount: number;
  skippedCount: number;
  entries: SourceHealthTriagePlanEntry[];
}

export interface BuildSourceHealthTriagePlanOptions {
  nextReviewDays?: number;
  now?: () => string;
  onlyMissing?: boolean;
  owner: string;
}

export interface ApplySourceHealthTriageOptions {
  apply: boolean;
  updater: (sourceId: string, input: UpdateAdminDataSourceInput) => Promise<unknown>;
}

type MysqlDataSourceTriagePool = Parameters<typeof updateAdminDataSourceFromMysql>[0] & {
  end: () => Promise<void>;
};

const defaultNextReviewDays = 7;

function parsePositiveInteger(value: string, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }

  return parsed;
}

function nextReviewAtFrom(generatedAt: string, days: number) {
  const base = Date.parse(generatedAt);
  if (Number.isNaN(base)) {
    throw new Error("generatedAt must be a valid timestamp");
  }

  return new Date(base + days * 86_400_000).toISOString();
}

function hasCompleteTriage(source: SourceHealthOperationalSource) {
  return Boolean(source.owner && source.disposition && source.nextReviewAt);
}

export function inferSourceHealthDisposition(source: Pick<
  SourceHealthOperationalSource,
  "classification" | "recommendedAction"
>) {
  switch (source.recommendedAction) {
    case "update_registry_url":
    case "add_base_url":
      return "registry_url_review";
    case "retry_or_increase_timeout":
      return "retry_with_longer_timeout";
    case "network_or_tls_review":
      return "network_or_tls_review";
  }

  switch (source.classification) {
    case "login_required":
      return "vendor_account_review";
    case "bot_check":
    case "forbidden":
      return "browser_access_review";
    case "empty_or_placeholder":
      return "parser_or_access_review";
    case "tls_or_network_error":
      return "network_or_tls_review";
    case "http_error":
      return "portal_status_review";
    case "timeout":
      return "retry_with_longer_timeout";
    default:
      return "browser_or_access_review";
  }
}

function buildNotes(source: SourceHealthOperationalSource, report: SourceHealthOperationalReport) {
  return [
    "Bulk source-health triage",
    `snapshot=${sanitizeReportText(report.snapshot?.id, 120) ?? "none"}`,
    `classification=${sanitizeReportText(source.classification, 80) ?? "unknown"}`,
    `action=${sanitizeReportText(source.recommendedAction, 120) ?? "unknown"}`,
    `severity=${sanitizeReportText(source.operationalSeverity, 80) ?? "unknown"}`,
  ].join("; ");
}

export function buildSourceHealthTriagePlan(
  report: SourceHealthOperationalReport,
  options: BuildSourceHealthTriagePlanOptions,
): SourceHealthTriagePlan {
  const owner = options.owner.trim();
  if (!owner) {
    throw new Error("owner is required");
  }

  const generatedAt = options.now?.() ?? new Date().toISOString();
  const nextReviewAt = nextReviewAtFrom(generatedAt, options.nextReviewDays ?? defaultNextReviewDays);
  const onlyMissing = options.onlyMissing ?? true;
  const unhealthySources = report.sources.filter((source) => source.status === "unhealthy");
  const entries = unhealthySources
    .filter((source) => !onlyMissing || !hasCompleteTriage(source))
    .map((source) => ({
      sourceId: sanitizeReportText(source.sourceId, 120) ?? "",
      stateCode: sanitizeReportText(source.stateCode, 16) ?? "",
      label: sanitizeReportText(source.label, 160) ?? "",
      classification: sanitizeReportText(source.classification, 80) ?? "unknown",
      recommendedAction: sanitizeReportText(source.recommendedAction, 120),
      operationalSeverity: sanitizeReportText(source.operationalSeverity, 80),
      previous: {
        owner: sanitizeReportText(source.owner, 160),
        disposition: sanitizeReportText(source.disposition, 120),
        nextReviewAt: sanitizeReportText(source.nextReviewAt, 80),
      },
      next: {
        owner,
        disposition: inferSourceHealthDisposition(source),
        nextReviewAt,
        notes: buildNotes(source, report),
        reviewedAt: generatedAt,
      },
    }));

  return {
    generatedAt,
    snapshotId: report.snapshot?.id ?? null,
    snapshotCheckedAt: report.snapshot?.checkedAt ?? null,
    owner,
    onlyMissing,
    applyCount: entries.length,
    skippedCount: report.sources.length - entries.length,
    entries,
  };
}

export async function applySourceHealthTriagePlan(
  plan: SourceHealthTriagePlan,
  options: ApplySourceHealthTriageOptions,
) {
  if (!options.apply) {
    return { applied: 0, dryRun: true };
  }

  for (const entry of plan.entries) {
    await options.updater(entry.sourceId, {
      liveHealthOwner: entry.next.owner,
      liveHealthDisposition: entry.next.disposition,
      liveHealthNextReviewAt: entry.next.nextReviewAt,
      liveHealthNotes: entry.next.notes,
      liveHealthReviewedAt: entry.next.reviewedAt,
    });
  }

  return { applied: plan.entries.length, dryRun: false };
}

export function parseSourceHealthTriageArgs(argv: string[]): SourceHealthTriageCliOptions {
  const options: SourceHealthTriageCliOptions = {
    allUnhealthy: false,
    apply: false,
    format: "markdown",
    help: false,
    nextReviewDays: defaultNextReviewDays,
    output: null,
    owner: null,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--all-unhealthy") {
      options.allUnhealthy = true;
      continue;
    }
    if (arg.startsWith("--owner=")) {
      const owner = arg.slice("--owner=".length).trim();
      if (!owner) throw new Error("--owner requires a value");
      options.owner = owner;
      continue;
    }
    if (arg.startsWith("--next-review-days=")) {
      options.nextReviewDays = parsePositiveInteger(
        arg.slice("--next-review-days=".length),
        "--next-review-days",
      );
      continue;
    }
    if (arg.startsWith("--format=")) {
      const format = arg.slice("--format=".length);
      if (format !== "markdown" && format !== "json") {
        throw new Error("--format must be markdown or json");
      }
      options.format = format;
      continue;
    }
    if (arg.startsWith("--output=")) {
      const output = arg.slice("--output=".length).trim();
      if (!output) throw new Error("--output requires a file path");
      options.output = output;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function markdownCell(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatMarkdown(plan: SourceHealthTriagePlan, applied: { applied: number; dryRun: boolean } | null) {
  const lines = [
    `# Source Health Triage ${applied?.dryRun === false ? "APPLIED" : "DRY RUN"}`,
    "",
    `Generated: ${plan.generatedAt}`,
    `Snapshot: ${plan.snapshotId ?? "missing"}`,
    `Snapshot checked at: ${plan.snapshotCheckedAt ?? "missing"}`,
    `Owner: ${plan.owner}`,
    `Only missing triage: ${plan.onlyMissing}`,
    `Planned updates: ${plan.applyCount}`,
    `Skipped rows: ${plan.skippedCount}`,
    ...(applied ? [`Applied updates: ${applied.applied}`] : []),
    "",
    "| state | source | classification | action | previous owner | previous disposition | previous next review | next owner | next disposition | next review |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];

  if (plan.entries.length === 0) {
    lines.push("| - | - | - | - | - | - | - | - | - | No source-health triage updates planned. |");
  } else {
    for (const entry of plan.entries) {
      lines.push(`| ${[
        entry.stateCode,
        entry.sourceId,
        entry.classification,
        entry.recommendedAction,
        entry.previous.owner,
        entry.previous.disposition,
        entry.previous.nextReviewAt,
        entry.next.owner,
        entry.next.disposition,
        entry.next.nextReviewAt,
      ].map(markdownCell).join(" | ")} |`);
    }
  }

  return lines.join("\n");
}

export function formatSourceHealthTriagePlan(
  plan: SourceHealthTriagePlan,
  format: SourceHealthTriageFormat = "markdown",
  applied: { applied: number; dryRun: boolean } | null = null,
) {
  if (format === "json") {
    return JSON.stringify({ plan, result: applied }, null, 2);
  }

  return formatMarkdown(plan, applied);
}

function writeOutput(outputPath: string, output: string) {
  const absoluteOutputPath = path.resolve(outputPath);
  mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
  writeFileSync(absoluteOutputPath, output.endsWith("\n") ? output : `${output}\n`, "utf8");
}

function formatHelp() {
  return [
    "Source Health Triage Bulk Assignment",
    "",
    "Usage:",
    "  npm run source:health:triage -- --owner=source-ops@example.com",
    "  npm run source:health:triage -- --owner=source-ops@example.com --apply",
    "  npm run source:health:triage -- --owner=source-ops@example.com --format=json --output=reports/source-health-triage.json",
    "",
    "Options:",
    "  --owner=<value>          Required owner for unhealthy source triage. Defaults to SOURCE_HEALTH_OWNER when set.",
    "  --apply                  Write triage fields to the current DB runtime. Default is dry-run.",
    "  --all-unhealthy          Update all unhealthy sources, not only sources missing triage fields.",
    "  --next-review-days=<n>   Days from now for next review. Default: 7.",
    "  --format=markdown|json   Output format. Default: markdown.",
    "  --output=<path>          Write output to a file.",
    "  --help                   Print this help.",
  ].join("\n");
}

async function applyToCurrentRuntime(plan: SourceHealthTriagePlan, apply: boolean) {
  if (isMysqlDatabaseUrlConfigured()) {
    const pool = createMysqlPool(requireMysqlDatabaseUrl()) as MysqlDataSourceTriagePool;
    try {
      return await applySourceHealthTriagePlan(plan, {
        apply,
        updater: (sourceId, input) => updateAdminDataSourceFromMysql(pool, sourceId, input, {
          actorUserId: "source-health-triage-script",
        }),
      });
    } finally {
      await pool.end();
    }
  }

  const db: AppDatabase = createDatabase();
  try {
    runMigrations(db);
    return await applySourceHealthTriagePlan(plan, {
      apply,
      updater: async (sourceId, input) => updateAdminDataSource(db, sourceId, input, {
        actorUserId: "source-health-triage-script",
      }),
    });
  } finally {
    db.$client.close();
  }
}

async function main() {
  const options = parseSourceHealthTriageArgs(process.argv.slice(2));
  if (options.help) {
    console.log(formatHelp());
    return;
  }

  const owner = options.owner ?? process.env.SOURCE_HEALTH_OWNER?.trim() ?? "";
  if (!owner) {
    throw new Error("--owner is required, or set SOURCE_HEALTH_OWNER");
  }

  const report = await loadSourceHealthOperationalReport();
  const plan = buildSourceHealthTriagePlan(report, {
    nextReviewDays: options.nextReviewDays,
    onlyMissing: !options.allUnhealthy,
    owner,
  });
  const result = await applyToCurrentRuntime(plan, options.apply);
  const output = formatSourceHealthTriagePlan(plan, options.format, result);

  if (options.output) {
    writeOutput(options.output, output);
    console.log(`Source health triage plan written to ${options.output}`);
  } else {
    console.log(output);
  }

  if (!options.apply && plan.applyCount > 0) {
    console.log("Dry-run only. Re-run with --apply to persist these triage updates.");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
