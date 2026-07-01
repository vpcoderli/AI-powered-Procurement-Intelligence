import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadSourceHealthOperationalReport,
  sanitizeReportText,
  sanitizeReportUrl,
  type SourceHealthOperationalReport,
  type SourceHealthOperationalSource,
} from "./source-health-report";

export type SourceHealthEvidenceFormat = "markdown" | "json";

export interface SourceHealthEvidenceCliOptions {
  allowBlocked: boolean;
  expectedStateCount: number;
  format: SourceHealthEvidenceFormat;
  help: boolean;
  output: string | null;
  staleAfterHours: number;
}

export interface SourceHealthEvidenceReadiness {
  observedStateCount: number;
  expectedStateCount: number;
  staleSnapshot: boolean;
  snapshotAgeHours: number | null;
  unhealthySources: number;
  criticalUnhealthy: number;
  warningUnhealthy: number;
  unassignedUnhealthy: number;
  missingDisposition: number;
  missingNextReview: number;
  overdueNextReview: number;
}

export interface SourceHealthEvidenceSource {
  stateCode: string;
  sourceId: string;
  label: string;
  url: string | null;
  status: SourceHealthOperationalSource["status"];
  classification: string;
  operationalSeverity: string | null;
  recommendedAction: string | null;
  owner: string | null;
  disposition: string | null;
  nextReviewAt: string | null;
  currentStatus: string | null;
  currentStreak: number | null;
  healthyPercent: number | null;
  reason: string | null;
}

export interface SourceHealthEvidenceBundle {
  ok: boolean;
  generatedAt: string;
  runtime: SourceHealthOperationalReport["runtime"];
  snapshot: SourceHealthOperationalReport["snapshot"];
  summary: SourceHealthOperationalReport["summary"];
  unhealthyClassificationCounts: SourceHealthOperationalReport["unhealthyClassificationCounts"];
  readiness: SourceHealthEvidenceReadiness;
  blockers: string[];
  commands: string[];
  highPrioritySources: SourceHealthEvidenceSource[];
}

export interface BuildSourceHealthEvidenceOptions {
  expectedStateCount?: number;
  now?: () => string;
  staleAfterHours?: number;
}

const defaultExpectedStateCount = 50;
const defaultStaleAfterHours = 72;

function severitySortValue(severity: string | null) {
  switch (severity) {
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

function parsePositiveInteger(value: string, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }

  return parsed;
}

function snapshotAgeHours(snapshotCheckedAt: string | undefined, generatedAt: string) {
  if (!snapshotCheckedAt) return null;
  const checkedAtMs = Date.parse(snapshotCheckedAt);
  const generatedAtMs = Date.parse(generatedAt);
  if (Number.isNaN(checkedAtMs) || Number.isNaN(generatedAtMs)) return null;

  return Math.max(0, Math.round(((generatedAtMs - checkedAtMs) / 3_600_000) * 10) / 10);
}

function isOverdue(isoTimestamp: string | null, generatedAt: string) {
  if (!isoTimestamp) return false;
  const reviewAtMs = Date.parse(isoTimestamp);
  const generatedAtMs = Date.parse(generatedAt);
  if (Number.isNaN(reviewAtMs) || Number.isNaN(generatedAtMs)) return false;

  return reviewAtMs < generatedAtMs;
}

function sourceCount(report: SourceHealthOperationalReport) {
  const states = new Set(report.sources.map((source) => source.stateCode).filter(Boolean));
  return states.size;
}

function sanitizeSource(source: SourceHealthOperationalSource): SourceHealthEvidenceSource {
  return {
    stateCode: sanitizeReportText(source.stateCode, 16) ?? "",
    sourceId: sanitizeReportText(source.sourceId, 120) ?? "",
    label: sanitizeReportText(source.label, 160) ?? "",
    url: sanitizeReportUrl(source.url, 300),
    status: source.status,
    classification: sanitizeReportText(source.classification, 80) ?? "unknown",
    operationalSeverity: sanitizeReportText(source.operationalSeverity, 80),
    recommendedAction: sanitizeReportText(source.recommendedAction, 120),
    owner: sanitizeReportText(source.owner, 160),
    disposition: sanitizeReportText(source.disposition, 120),
    nextReviewAt: sanitizeReportText(source.nextReviewAt, 80),
    currentStatus: sanitizeReportText(source.currentStatus, 80),
    currentStreak: source.currentStreak,
    healthyPercent: source.healthyPercent,
    reason: sanitizeReportText(source.reason, 180),
  };
}

function buildBlockers(
  report: SourceHealthOperationalReport,
  readiness: SourceHealthEvidenceReadiness,
  staleAfterHours: number,
) {
  const blockers: string[] = [];

  if (!report.snapshot) {
    blockers.push("No persisted source health snapshot found. Run npm run source:health:ops first.");
  }

  if (readiness.observedStateCount < readiness.expectedStateCount) {
    blockers.push(
      `Source health snapshot covers ${readiness.observedStateCount}/${readiness.expectedStateCount} expected state sources.`,
    );
  }

  if (readiness.staleSnapshot) {
    blockers.push(`Source health snapshot is stale: latest check is older than ${staleAfterHours} hours.`);
  }

  if (readiness.criticalUnhealthy > 0) {
    blockers.push(`${readiness.criticalUnhealthy} critical unhealthy source(s) require registry/source-ops review.`);
  }

  if (readiness.unassignedUnhealthy > 0) {
    blockers.push(`${readiness.unassignedUnhealthy} unhealthy source(s) are missing an owner.`);
  }

  if (readiness.missingDisposition > 0) {
    blockers.push(`${readiness.missingDisposition} unhealthy source(s) are missing a disposition.`);
  }

  if (readiness.missingNextReview > 0) {
    blockers.push(`${readiness.missingNextReview} unhealthy source(s) are missing a next-review date.`);
  }

  if (readiness.overdueNextReview > 0) {
    blockers.push(`${readiness.overdueNextReview} unhealthy source(s) have overdue next-review dates.`);
  }

  return blockers;
}

export function buildSourceHealthEvidenceBundle(
  report: SourceHealthOperationalReport,
  options: BuildSourceHealthEvidenceOptions = {},
): SourceHealthEvidenceBundle {
  const generatedAt = options.now?.() ?? new Date().toISOString();
  const expectedStateCount = options.expectedStateCount ?? defaultExpectedStateCount;
  const staleAfterHours = options.staleAfterHours ?? defaultStaleAfterHours;
  const unhealthySources = report.sources.filter((source) => source.status === "unhealthy");
  const snapshotAge = snapshotAgeHours(report.snapshot?.checkedAt, generatedAt);
  const readiness = {
    observedStateCount: sourceCount(report),
    expectedStateCount,
    staleSnapshot: snapshotAge === null ? !report.snapshot : snapshotAge > staleAfterHours,
    snapshotAgeHours: snapshotAge,
    unhealthySources: unhealthySources.length,
    criticalUnhealthy: unhealthySources.filter((source) => source.operationalSeverity === "critical").length,
    warningUnhealthy: unhealthySources.filter((source) => source.operationalSeverity === "warning").length,
    unassignedUnhealthy: unhealthySources.filter((source) => !source.owner).length,
    missingDisposition: unhealthySources.filter((source) => !source.disposition).length,
    missingNextReview: unhealthySources.filter((source) => !source.nextReviewAt).length,
    overdueNextReview: unhealthySources.filter((source) => isOverdue(source.nextReviewAt, generatedAt)).length,
  } satisfies SourceHealthEvidenceReadiness;
  const blockers = buildBlockers(report, readiness, staleAfterHours);

  return {
    ok: blockers.length === 0,
    generatedAt,
    runtime: report.runtime,
    snapshot: report.snapshot,
    summary: report.summary,
    unhealthyClassificationCounts: report.unhealthyClassificationCounts,
    readiness,
    blockers,
    commands: [
      "npm run source:health:ops",
      "npm run source:health:report -- --format=markdown",
      "npm run source:health:evidence -- --format=json --output=../ops-evidence/source-health-evidence.json",
    ],
    highPrioritySources: unhealthySources
      .slice()
      .sort((left, right) => {
        const severityDelta = severitySortValue(left.operationalSeverity) - severitySortValue(right.operationalSeverity);
        if (severityDelta !== 0) return severityDelta;
        return `${left.stateCode} ${left.sourceId}`.localeCompare(`${right.stateCode} ${right.sourceId}`);
      })
      .slice(0, 25)
      .map(sanitizeSource),
  };
}

function markdownCell(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatMarkdown(bundle: SourceHealthEvidenceBundle) {
  const lines = [
    `# Source Health Evidence ${bundle.ok ? "READY" : "BLOCKED"}`,
    "",
    `Generated: ${bundle.generatedAt}`,
    `Runtime: ${bundle.runtime}`,
    bundle.snapshot
      ? `Snapshot: ${bundle.snapshot.id} checked at ${bundle.snapshot.checkedAt}`
      : "Snapshot: missing",
    "",
    "## Readiness",
    "",
    "| metric | value |",
    "|---|---:|",
    `| observed state sources | ${bundle.readiness.observedStateCount} |`,
    `| expected state sources | ${bundle.readiness.expectedStateCount} |`,
    `| snapshot age hours | ${bundle.readiness.snapshotAgeHours ?? "-"} |`,
    `| stale snapshot | ${bundle.readiness.staleSnapshot} |`,
    `| unhealthy sources | ${bundle.readiness.unhealthySources} |`,
    `| critical unhealthy | ${bundle.readiness.criticalUnhealthy} |`,
    `| warning unhealthy | ${bundle.readiness.warningUnhealthy} |`,
    `| unassigned unhealthy | ${bundle.readiness.unassignedUnhealthy} |`,
    `| missing disposition | ${bundle.readiness.missingDisposition} |`,
    `| missing next review | ${bundle.readiness.missingNextReview} |`,
    `| overdue next review | ${bundle.readiness.overdueNextReview} |`,
    "",
  ];

  if (bundle.blockers.length > 0) {
    lines.push("## Blockers", "");
    for (const blocker of bundle.blockers) {
      lines.push(`- ${blocker}`);
    }
    lines.push("");
  }

  lines.push(
    "## Classification Counts",
    "",
    "| classification | count |",
    "|---|---:|",
  );

  const countEntries = Object.entries(bundle.unhealthyClassificationCounts);
  if (countEntries.length === 0) {
    lines.push("| none | 0 |");
  } else {
    for (const [classification, count] of countEntries) {
      lines.push(`| ${markdownCell(classification)} | ${count} |`);
    }
  }

  lines.push(
    "",
    "## High Priority Sources",
    "",
    "| state | source | source URL | status | classification | severity | action | owner | disposition | next review | trend | reason |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  );

  if (bundle.highPrioritySources.length === 0) {
    lines.push("| - | - | - | - | - | - | - | - | - | - | - | No unhealthy sources in latest snapshot. |");
  } else {
    for (const source of bundle.highPrioritySources) {
      const trend = source.currentStatus && source.currentStreak !== null
        ? `${source.currentStatus} x${source.currentStreak}${source.healthyPercent === null ? "" : `, ${source.healthyPercent}% healthy`}`
        : "-";
      lines.push(`| ${[
        source.stateCode,
        source.sourceId,
        source.url,
        source.status,
        source.classification,
        source.operationalSeverity,
        source.recommendedAction,
        source.owner,
        source.disposition,
        source.nextReviewAt,
        trend,
        source.reason,
      ].map(markdownCell).join(" | ")} |`);
    }
  }

  lines.push("", "## Commands", "");
  for (const command of bundle.commands) {
    lines.push(`- \`${command}\``);
  }

  return lines.join("\n");
}

export function formatSourceHealthEvidenceBundle(
  bundle: SourceHealthEvidenceBundle,
  format: SourceHealthEvidenceFormat = "markdown",
) {
  if (format === "json") {
    return JSON.stringify(bundle, null, 2);
  }

  return formatMarkdown(bundle);
}

export function parseSourceHealthEvidenceArgs(argv: string[]): SourceHealthEvidenceCliOptions {
  const options: SourceHealthEvidenceCliOptions = {
    allowBlocked: false,
    expectedStateCount: defaultExpectedStateCount,
    format: "markdown",
    help: false,
    output: null,
    staleAfterHours: defaultStaleAfterHours,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--allow-blocked") {
      options.allowBlocked = true;
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
    if (arg.startsWith("--expected-state-count=")) {
      options.expectedStateCount = parsePositiveInteger(
        arg.slice("--expected-state-count=".length),
        "--expected-state-count",
      );
      continue;
    }
    if (arg.startsWith("--stale-after-hours=")) {
      options.staleAfterHours = parsePositiveInteger(
        arg.slice("--stale-after-hours=".length),
        "--stale-after-hours",
      );
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function formatHelp() {
  return [
    "Source Health Evidence Bundle",
    "",
    "Usage:",
    "  npm run source:health:evidence",
    "  npm run source:health:evidence -- --format=json --output=../ops-evidence/source-health-evidence.json",
    "  npm run source:health:evidence -- --allow-blocked",
    "",
    "Options:",
    "  --format=markdown|json       Output format. Default: markdown.",
    "  --output=<path>               Write output to a file.",
    "  --expected-state-count=<n>    Expected state source count. Default: 50.",
    "  --stale-after-hours=<n>       Mark evidence stale after n hours. Default: 72.",
    "  --allow-blocked               Print/report blockers but exit 0.",
    "  --help                        Print this help.",
    "",
    "This command reads the latest persisted source-health snapshot from the current DB runtime.",
    "Run npm run source:health:ops first to refresh live evidence from the operator network.",
  ].join("\n");
}

function writeOutput(outputPath: string, output: string) {
  const absoluteOutputPath = path.resolve(outputPath);
  mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
  writeFileSync(absoluteOutputPath, output.endsWith("\n") ? output : `${output}\n`, "utf8");
}

async function main() {
  const options = parseSourceHealthEvidenceArgs(process.argv.slice(2));

  if (options.help) {
    console.log(formatHelp());
    return;
  }

  const report = await loadSourceHealthOperationalReport();
  const bundle = buildSourceHealthEvidenceBundle(report, {
    expectedStateCount: options.expectedStateCount,
    staleAfterHours: options.staleAfterHours,
  });
  const output = formatSourceHealthEvidenceBundle(bundle, options.format);

  if (options.output) {
    writeOutput(options.output, output);
    console.log(`Source health evidence written to ${options.output}`);
  } else {
    console.log(output);
  }

  if (!bundle.ok && !options.allowBlocked) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
