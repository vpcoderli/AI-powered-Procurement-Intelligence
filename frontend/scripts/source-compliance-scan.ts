import { fileURLToPath } from "node:url";
import { STATE_CRAWLER_SOURCES } from "../src/lib/state-crawler-sources";
import { createDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { createMysqlPool, isMysqlDatabaseUrlConfigured, requireMysqlDatabaseUrl } from "../src/server/db/mysql";
import {
  recordSourceComplianceSnapshot,
  recordSourceComplianceSnapshotFromMysql,
} from "../src/server/source-validity/compliance-snapshots";
import {
  formatSourceComplianceReport,
  scanSourceCompliance,
} from "../src/server/source-validity/robots-compliance-scan";
import type { SourceComplianceReport } from "../src/server/source-validity/robots-compliance-scan";

// Data-source compliance pre-check CLI (P1-2).
//
// This script fetches and hashes robots.txt for each active state source's
// base URL and flags sources whose robots.txt appears to disallow crawling
// entirely, or disallow paths that overlap with the paths APSI crawls.
//
// IMPORTANT: this is a signal/triage tool, not a legal determination. It
// does not read or evaluate Terms of Service text, and a "clear" result is
// not authorization to crawl. See docs/operations/data-source-compliance-ledger.md
// for the required human legal review process.

interface CliOptions {
  sourceFilters: string[];
  timeoutMs: number;
  reportOnly: boolean;
  json: boolean;
  persist: boolean;
  help: boolean;
}

export function formatSourceComplianceScanHelp() {
  return [
    "Source Compliance Scan (robots.txt pre-check)",
    "",
    "Usage:",
    "  npm run source:compliance:scan -- --all --timeout-ms 10000 --report-only",
    "  npm run source:compliance:scan -- --source CA --report-only",
    "  npm run source:compliance:scan -- --all --persist",
    "",
    "Options:",
    "  --all                 Check the full state source registry (default).",
    "  --source <value>      Check one state code or source id. Can be repeated.",
    "  --timeout-ms <value>  Per-request timeout from 1000 to 60000 ms. Default: 10000.",
    "  --persist             Write the latest snapshot for Admin Data Sources in the current DB runtime.",
    "  --write-snapshot      Alias for --persist.",
    "  --report-only         Print flagged results without exiting non-zero.",
    "  --json                Print raw JSON report.",
    "  --help                Print this help.",
    "",
    "This tool is a triage signal only, not a legal determination. Both flagged and",
    "clear sources require human legal (ToS + robots.txt) review before first production",
    "crawl. See docs/operations/data-source-compliance-ledger.md.",
  ].join("\n");
}

export function parseSourceComplianceScanArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    sourceFilters: [],
    timeoutMs: 10_000,
    reportOnly: false,
    json: false,
    persist: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg.startsWith("--source=")) {
      options.sourceFilters.push(arg.slice("--source=".length).trim());
    } else if (arg === "--source") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--source requires a state code or source id.");
      }
      options.sourceFilters.push(value.trim());
      index += 1;
    } else if (arg === "--all") {
      options.sourceFilters = [];
    } else if (arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = Number(arg.slice("--timeout-ms=".length));
    } else if (arg === "--timeout-ms") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--timeout-ms requires a numeric value.");
      }
      options.timeoutMs = Number(value);
      index += 1;
    } else if (arg === "--report-only") {
      options.reportOnly = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--persist") {
      options.persist = true;
    } else if (arg === "--write-snapshot") {
      options.persist = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 60_000) {
    throw new Error("--timeout-ms must be between 1000 and 60000.");
  }

  return options;
}

function selectedSources(filters: string[]) {
  if (filters.length === 0) return STATE_CRAWLER_SOURCES;

  const normalized = new Set(filters.map((filter) => filter.toLowerCase()));
  const selected = STATE_CRAWLER_SOURCES.filter(
    (source) => normalized.has(source.stateCode.toLowerCase()) || normalized.has(source.id.toLowerCase()),
  );

  const found = new Set(selected.flatMap((source) => [source.stateCode.toLowerCase(), source.id.toLowerCase()]));
  const missing = filters.filter((filter) => !found.has(filter.toLowerCase()));
  if (missing.length > 0) {
    throw new Error(`Unknown source filter(s): ${missing.join(", ")}`);
  }

  return selected;
}

type SqliteSnapshotDatabase = ReturnType<typeof createDatabase>;
type MysqlSnapshotPool = Parameters<typeof recordSourceComplianceSnapshotFromMysql>[0] & {
  end: () => Promise<void>;
};

interface PersistSnapshotDeps {
  createSqliteDatabase?: () => SqliteSnapshotDatabase;
  runSqliteMigrations?: (db: SqliteSnapshotDatabase) => void;
  recordSqliteSnapshot?: typeof recordSourceComplianceSnapshot;
  createMysqlPoolForUrl?: (databaseUrl: string) => MysqlSnapshotPool;
  recordMysqlSnapshot?: typeof recordSourceComplianceSnapshotFromMysql;
}

export async function persistSourceComplianceSnapshot(
  report: SourceComplianceReport,
  env: NodeJS.ProcessEnv = process.env,
  deps: PersistSnapshotDeps = {},
) {
  if (isMysqlDatabaseUrlConfigured(env)) {
    const pool = (deps.createMysqlPoolForUrl ?? createMysqlPool)(requireMysqlDatabaseUrl(env));

    try {
      await (deps.recordMysqlSnapshot ?? recordSourceComplianceSnapshotFromMysql)(pool, report);
    } finally {
      await pool.end();
    }

    return "mysql";
  }

  const db = (deps.createSqliteDatabase ?? createDatabase)();
  try {
    (deps.runSqliteMigrations ?? runMigrations)(db);
    (deps.recordSqliteSnapshot ?? recordSourceComplianceSnapshot)(db, report);
  } finally {
    db.$client.close();
  }

  return "sqlite";
}

async function main() {
  const options = parseSourceComplianceScanArgs(process.argv.slice(2));
  if (options.help) {
    console.log(formatSourceComplianceScanHelp());
    return;
  }

  const sources = selectedSources(options.sourceFilters);
  const report = await scanSourceCompliance(sources, { timeoutMs: options.timeoutMs });

  if (options.persist) {
    await persistSourceComplianceSnapshot(report);
  }

  console.log(options.json ? JSON.stringify(report, null, 2) : formatSourceComplianceReport(report));

  if (!report.ok && !options.reportOnly) {
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
