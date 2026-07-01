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

export type SourceHealthAccessReviewFormat = "markdown" | "json" | "csv";

export type SourceHealthAccessReviewMode =
  | "browser_access"
  | "vendor_account"
  | "long_timeout_retry"
  | "network_tls"
  | "registry_url"
  | "portal_status"
  | "parser_or_access"
  | "manual_review";

export interface SourceHealthAccessReviewCliOptions {
  format: SourceHealthAccessReviewFormat;
  help: boolean;
  modes: SourceHealthAccessReviewMode[] | null;
  output: string | null;
  owner: string | null;
}

export interface SourceHealthAccessReviewEntry {
  stateCode: string;
  sourceId: string;
  label: string;
  url: string | null;
  classification: string;
  reviewMode: SourceHealthAccessReviewMode;
  operationalSeverity: string | null;
  recommendedAction: string | null;
  owner: string | null;
  disposition: string | null;
  nextReviewAt: string | null;
  checkedAt: string | null;
  httpStatus: number | null;
  reason: string | null;
  currentStatus: string | null;
  currentStreak: number | null;
  healthyPercent: number | null;
  requiredEvidence: string[];
  operatorChecklist: string[];
}

export interface SourceHealthAccessReviewSummary {
  totalSources: number;
  reviewSources: number;
  browserAccess: number;
  vendorAccount: number;
  longTimeoutRetry: number;
  networkTls: number;
  registryUrl: number;
  portalStatus: number;
  parserOrAccess: number;
  manualReview: number;
}

export interface SourceHealthAccessReviewPacket {
  generatedAt: string;
  runtime: SourceHealthOperationalReport["runtime"];
  snapshot: SourceHealthOperationalReport["snapshot"];
  owner: string | null;
  modes: SourceHealthAccessReviewMode[] | null;
  summary: SourceHealthAccessReviewSummary;
  entries: SourceHealthAccessReviewEntry[];
  commands: string[];
}

export interface BuildSourceHealthAccessReviewPacketOptions {
  modes?: SourceHealthAccessReviewMode[] | null;
  now?: () => string;
  owner?: string | null;
}

const allReviewModes: SourceHealthAccessReviewMode[] = [
  "browser_access",
  "vendor_account",
  "long_timeout_retry",
  "network_tls",
  "registry_url",
  "portal_status",
  "parser_or_access",
  "manual_review",
];

export function inferAccessReviewMode(source: Pick<
  SourceHealthOperationalSource,
  "classification" | "recommendedAction"
>): SourceHealthAccessReviewMode {
  switch (source.recommendedAction) {
    case "update_registry_url":
    case "add_base_url":
      return "registry_url";
    case "retry_or_increase_timeout":
      return "long_timeout_retry";
    case "network_or_tls_review":
      return "network_tls";
  }

  switch (source.classification) {
    case "forbidden":
    case "bot_check":
      return "browser_access";
    case "login_required":
      return "vendor_account";
    case "timeout":
      return "long_timeout_retry";
    case "tls_or_network_error":
      return "network_tls";
    case "http_error":
      return "portal_status";
    case "empty_or_placeholder":
      return "parser_or_access";
    default:
      return "manual_review";
  }
}

function requiredEvidenceFor(mode: SourceHealthAccessReviewMode) {
  switch (mode) {
    case "browser_access":
      return [
        "Browser open result from production-like network",
        "Screenshot or external ticket reference, not raw credentials",
        "Decision: approved browser path, fallback source, or manual review",
      ];
    case "vendor_account":
      return [
        "Vendor-account requirement confirmed or rejected",
        "Credential storage decision outside source registry",
        "Decision: APSI Registration Vault, manual review, or fallback source",
      ];
    case "long_timeout_retry":
      return [
        "Retry result with longer timeout from production-like network",
        "Latency or timeout observation",
        "Decision: crawler timeout adjustment, retry cadence, or source hold",
      ];
    case "network_tls":
      return [
        "Retry result from a second network or AWS runner",
        "TLS/DNS/network error classification",
        "Decision: infrastructure follow-up or source hold",
      ];
    case "registry_url":
      return [
        "Official current URL or approved fallback reference",
        "Registry metadata update ticket",
        "Decision: update registry URL, add base URL, or hold source",
      ];
    case "portal_status":
      return [
        "Portal status observed in browser or official status page",
        "HTTP status and timestamp",
        "Decision: retry later, manual review, or source hold",
      ];
    case "parser_or_access":
      return [
        "Browser body inspection result",
        "Parser/access hypothesis",
        "Decision: parser review, approved access path, or source hold",
      ];
    case "manual_review":
      return [
        "Human review note with sanitized evidence reference",
        "Owner and next review date",
        "Decision recorded in source operations tracker",
      ];
  }
}

function checklistFor(mode: SourceHealthAccessReviewMode) {
  switch (mode) {
    case "browser_access":
      return [
        "Open the portal in a normal browser from the production-like network.",
        "Confirm whether the source is public, blocked by bot protection, or needs approved browser automation.",
        "Store only screenshot/ticket references, never cookies or credentials.",
      ];
    case "vendor_account":
      return [
        "Confirm whether the portal requires a registered vendor account.",
        "Keep usernames, passwords, tokens, and cookies out of source metadata and reports.",
        "Escalate to Product + Source Ops for APSI Registration Vault or manual-review policy.",
      ];
    case "long_timeout_retry":
      return [
        "Retry the affected source with a longer timeout from the production-like network.",
        "Record whether the status changes from timeout to healthy or another access class.",
        "Escalate repeated slow sources for crawler timeout/cadence tuning.",
      ];
    case "network_tls":
      return [
        "Retry from a second network or AWS runner.",
        "Record DNS/TLS/network details without raw certificates or secrets.",
        "Escalate only if the failure repeats across networks.",
      ];
    case "registry_url":
      return [
        "Verify the official source URL or approved fallback URL.",
        "Update registry metadata only after evidence is captured.",
        "Re-run the affected source with body inspection after the registry change.",
      ];
    case "portal_status":
      return [
        "Check whether the portal is temporarily down or returning a persistent status.",
        "Record timestamp, status, and sanitized portal status reference.",
        "Decide retry cadence or source hold.",
      ];
    case "parser_or_access":
      return [
        "Open the source in a browser and confirm whether useful procurement content is visible.",
        "Decide whether this is parser coverage, access review, or fallback-source work.",
        "Avoid copying raw page bodies into evidence.",
      ];
    case "manual_review":
      return [
        "Assign a concrete owner.",
        "Record sanitized evidence reference and next review date.",
        "Decide source disposition before launch signoff.",
      ];
  }
}

function markdownCell(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function csvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function sanitizeSource(source: SourceHealthOperationalSource): SourceHealthAccessReviewEntry {
  const reviewMode = inferAccessReviewMode(source);

  return {
    stateCode: sanitizeReportText(source.stateCode, 16) ?? "",
    sourceId: sanitizeReportText(source.sourceId, 120) ?? "",
    label: sanitizeReportText(source.label, 160) ?? "",
    url: sanitizeReportUrl(source.url, 300),
    classification: sanitizeReportText(source.classification, 80) ?? "unknown",
    reviewMode,
    operationalSeverity: sanitizeReportText(source.operationalSeverity, 80),
    recommendedAction: sanitizeReportText(source.recommendedAction, 120),
    owner: sanitizeReportText(source.owner, 160),
    disposition: sanitizeReportText(source.disposition, 120),
    nextReviewAt: sanitizeReportText(source.nextReviewAt, 80),
    checkedAt: sanitizeReportText(source.checkedAt, 80),
    httpStatus: source.httpStatus,
    reason: sanitizeReportText(source.reason, 180),
    currentStatus: sanitizeReportText(source.currentStatus, 80),
    currentStreak: source.currentStreak,
    healthyPercent: source.healthyPercent,
    requiredEvidence: requiredEvidenceFor(reviewMode),
    operatorChecklist: checklistFor(reviewMode),
  };
}

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

function buildSummary(totalSources: number, entries: SourceHealthAccessReviewEntry[]): SourceHealthAccessReviewSummary {
  return {
    totalSources,
    reviewSources: entries.length,
    browserAccess: entries.filter((entry) => entry.reviewMode === "browser_access").length,
    vendorAccount: entries.filter((entry) => entry.reviewMode === "vendor_account").length,
    longTimeoutRetry: entries.filter((entry) => entry.reviewMode === "long_timeout_retry").length,
    networkTls: entries.filter((entry) => entry.reviewMode === "network_tls").length,
    registryUrl: entries.filter((entry) => entry.reviewMode === "registry_url").length,
    portalStatus: entries.filter((entry) => entry.reviewMode === "portal_status").length,
    parserOrAccess: entries.filter((entry) => entry.reviewMode === "parser_or_access").length,
    manualReview: entries.filter((entry) => entry.reviewMode === "manual_review").length,
  };
}

export function buildSourceHealthAccessReviewPacket(
  report: SourceHealthOperationalReport,
  options: BuildSourceHealthAccessReviewPacketOptions = {},
): SourceHealthAccessReviewPacket {
  const modes = options.modes ?? null;
  const allowedModes = new Set(modes ?? allReviewModes);
  const entries = report.sources
    .filter((source) => source.status === "unhealthy")
    .map(sanitizeSource)
    .filter((entry) => allowedModes.has(entry.reviewMode))
    .sort((left, right) => {
      const severityDelta = severitySortValue(left.operationalSeverity) - severitySortValue(right.operationalSeverity);
      if (severityDelta !== 0) return severityDelta;
      const modeDelta = left.reviewMode.localeCompare(right.reviewMode);
      if (modeDelta !== 0) return modeDelta;
      return `${left.stateCode} ${left.sourceId}`.localeCompare(`${right.stateCode} ${right.sourceId}`);
    });

  return {
    generatedAt: options.now?.() ?? new Date().toISOString(),
    runtime: report.runtime,
    snapshot: report.snapshot,
    owner: sanitizeReportText(options.owner ?? null, 160),
    modes,
    summary: buildSummary(report.sources.length, entries),
    entries,
    commands: [
      "npm run source:health:ops",
      "npm run source:health:access-review -- --format=markdown --output=../ops-evidence/source-health/source-health-access-review.md",
      "npm run source:health:evidence -- --allow-blocked --format=json --output=../ops-evidence/source-health/source-health-evidence.json",
    ],
  };
}

function formatMarkdown(packet: SourceHealthAccessReviewPacket) {
  const lines = [
    "# Source Health Access Review",
    "",
    `Generated: ${packet.generatedAt}`,
    `Runtime: ${packet.runtime}`,
    packet.snapshot
      ? `Snapshot: ${packet.snapshot.id} checked at ${packet.snapshot.checkedAt}`
      : "Snapshot: missing",
    `Owner: ${packet.owner ?? "-"}`,
    "",
    "## Summary",
    "",
    "| metric | value |",
    "|---|---:|",
    `| total sources | ${packet.summary.totalSources} |`,
    `| review sources | ${packet.summary.reviewSources} |`,
    `| browser access | ${packet.summary.browserAccess} |`,
    `| vendor account | ${packet.summary.vendorAccount} |`,
    `| long timeout retry | ${packet.summary.longTimeoutRetry} |`,
    `| network/TLS | ${packet.summary.networkTls} |`,
    `| registry URL | ${packet.summary.registryUrl} |`,
    `| portal status | ${packet.summary.portalStatus} |`,
    `| parser/access | ${packet.summary.parserOrAccess} |`,
    `| manual review | ${packet.summary.manualReview} |`,
    "",
    "## Review Queue",
    "",
    "| state | source | source URL | mode | classification | severity | owner | disposition | next review | evidence required | reason |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];

  if (packet.entries.length === 0) {
    lines.push("| - | - | - | - | - | - | - | - | - | - | No access-review sources matched the filters. |");
  } else {
    for (const entry of packet.entries) {
      lines.push(`| ${[
        entry.stateCode,
        entry.sourceId,
        entry.url,
        entry.reviewMode,
        entry.classification,
        entry.operationalSeverity,
        entry.owner,
        entry.disposition,
        entry.nextReviewAt,
        entry.requiredEvidence.join("; "),
        entry.reason,
      ].map(markdownCell).join(" | ")} |`);
    }
  }

  lines.push("", "## Operator Checklist", "");
  for (const entry of packet.entries) {
    lines.push(`### ${entry.stateCode} ${entry.sourceId}`, "");
    for (const item of entry.operatorChecklist) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  lines.push("## Commands", "");
  for (const command of packet.commands) {
    lines.push(`- \`${command}\``);
  }

  return lines.join("\n");
}

function formatCsv(packet: SourceHealthAccessReviewPacket) {
  const rows: Array<Array<string | number | null | undefined>> = [
    [
      "state_code",
      "source_id",
      "label",
      "source_url",
      "review_mode",
      "classification",
      "severity",
      "recommended_action",
      "owner",
      "disposition",
      "next_review_at",
      "checked_at",
      "http_status",
      "reason",
      "required_evidence",
    ],
  ];

  for (const entry of packet.entries) {
    rows.push([
      entry.stateCode,
      entry.sourceId,
      entry.label,
      entry.url,
      entry.reviewMode,
      entry.classification,
      entry.operationalSeverity,
      entry.recommendedAction,
      entry.owner,
      entry.disposition,
      entry.nextReviewAt,
      entry.checkedAt,
      entry.httpStatus,
      entry.reason,
      entry.requiredEvidence.join("; "),
    ]);
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function formatSourceHealthAccessReviewPacket(
  packet: SourceHealthAccessReviewPacket,
  format: SourceHealthAccessReviewFormat = "markdown",
) {
  if (format === "json") {
    return JSON.stringify(packet, null, 2);
  }
  if (format === "csv") {
    return formatCsv(packet);
  }

  return formatMarkdown(packet);
}

function parseFormat(value: string): SourceHealthAccessReviewFormat {
  if (value !== "markdown" && value !== "json" && value !== "csv") {
    throw new Error("--format must be markdown, json, or csv");
  }

  return value;
}

function parseMode(value: string): SourceHealthAccessReviewMode {
  if (!allReviewModes.includes(value as SourceHealthAccessReviewMode)) {
    throw new Error(`Unknown review mode: ${value}`);
  }

  return value as SourceHealthAccessReviewMode;
}

function parseModes(value: string) {
  const modes = value
    .split(",")
    .map((mode) => mode.trim())
    .filter(Boolean)
    .map(parseMode);

  if (modes.length === 0) {
    throw new Error("--mode requires at least one review mode");
  }

  return Array.from(new Set(modes));
}

export function parseSourceHealthAccessReviewArgs(argv: string[]): SourceHealthAccessReviewCliOptions {
  const options: SourceHealthAccessReviewCliOptions = {
    format: "markdown",
    help: false,
    modes: null,
    output: null,
    owner: null,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg.startsWith("--format=")) {
      options.format = parseFormat(arg.slice("--format=".length));
      continue;
    }
    if (arg.startsWith("--output=")) {
      const output = arg.slice("--output=".length).trim();
      if (!output) throw new Error("--output requires a file path");
      options.output = output;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      options.modes = parseModes(arg.slice("--mode=".length));
      continue;
    }
    if (arg.startsWith("--owner=")) {
      const owner = arg.slice("--owner=".length).trim();
      if (!owner) throw new Error("--owner requires a value");
      options.owner = owner;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function formatHelp() {
  return [
    "Source Health Access Review Packet",
    "",
    "Usage:",
    "  npm run source:health:access-review",
    "  npm run source:health:access-review -- --format=csv --output=../ops-evidence/source-health/source-health-access-review.csv",
    "  npm run source:health:access-review -- --mode=browser_access,vendor_account",
    "",
    "Options:",
    "  --format=markdown|json|csv   Output format. Default: markdown.",
    "  --output=<path>               Write output to a file.",
    "  --mode=<csv>                  Filter review modes.",
    "  --owner=<value>               Optional packet owner label. Defaults to SOURCE_HEALTH_OWNER.",
    "  --help                        Print this help.",
    "",
    "This command reads the latest persisted source-health snapshot from the current DB runtime.",
    "It does not run live probes, open browsers, or store portal credentials.",
  ].join("\n");
}

function writeOutput(outputPath: string, output: string) {
  const absoluteOutputPath = path.resolve(outputPath);
  mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
  writeFileSync(absoluteOutputPath, output.endsWith("\n") ? output : `${output}\n`, "utf8");
}

async function main() {
  const options = parseSourceHealthAccessReviewArgs(process.argv.slice(2));
  if (options.help) {
    console.log(formatHelp());
    return;
  }

  const report = await loadSourceHealthOperationalReport();
  const packet = buildSourceHealthAccessReviewPacket(report, {
    modes: options.modes,
    owner: options.owner ?? process.env.SOURCE_HEALTH_OWNER?.trim() ?? null,
  });
  const output = formatSourceHealthAccessReviewPacket(packet, options.format);

  if (options.output) {
    writeOutput(options.output, output);
    console.log(`Source health access review packet written to ${options.output}`);
  } else {
    console.log(output);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
