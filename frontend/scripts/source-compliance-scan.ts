import { fileURLToPath } from "node:url";
import { STATE_CRAWLER_SOURCE_DEFINITIONS } from "../src/lib/state-crawler-sources";
import { createDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { createMysqlPool, isMysqlDatabaseUrlConfigured, requireMysqlDatabaseUrl } from "../src/server/db/mysql";
import {
  recordSourceComplianceSnapshot,
  recordSourceComplianceSnapshotFromMysql,
} from "../src/server/source-validity/compliance-snapshots";
import {
  applyRobotsComplianceToDataSources,
  applyRobotsComplianceToDataSourcesFromMysql,
  listDataSourceComplianceInputs,
  listDataSourceComplianceInputsFromMysql,
} from "../src/server/source-validity/data-source-compliance";
import {
  formatSourceComplianceReport,
  scanSourceCompliance,
} from "../src/server/source-validity/robots-compliance-scan";
import { createCrawlerBackedRobotsFetch } from "../src/server/admin/crawler-robots-fetch";
import type {
  SourceComplianceInput,
  SourceComplianceReport,
} from "../src/server/source-validity/robots-compliance-scan";

// Data-source compliance pre-check CLI (P1-2).
//
// This script fetches and hashes robots.txt for each enabled source's base URL
// and flags sources whose robots.txt appears to disallow crawling entirely, or
// disallow paths that overlap with the paths APSI crawls.
//
// The default registry is the runtime one (`data_sources`), so `--all` covers
// county and city sources too — the population the local-source approval
// workflow needs robots evidence for. `--state-definitions` keeps the original
// behaviour of scanning the 50 hardcoded state source definitions, which needs
// no database.
//
// IMPORTANT: this is a signal/triage tool, not a legal determination. It
// does not read or evaluate Terms of Service text, and a "clear" result is
// not authorization to crawl. See docs/operations/data-source-compliance-ledger.md
// for the required human legal review process.

export type ComplianceRegistry = "data-sources" | "state-definitions";

interface CliOptions {
  sourceFilters: string[];
  registry: ComplianceRegistry;
  timeoutMs: number;
  nodeFetch: boolean;
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
    "  npm run source:compliance:scan -- --state-definitions --all --report-only",
    "",
    "Options:",
    "  --all                 Check every enabled data source, county and city included (default).",
    "  --source <value>      Check one state code or source id. Can be repeated.",
    "  --state-definitions   Scan the 50 hardcoded state source definitions instead of data_sources.",
    "  --node-fetch          Fetch robots.txt with Node fetch instead of the Python crawler client (default: crawler).",
    "  --timeout-ms <value>  Per-request timeout from 1000 to 60000 ms. Default: 10000.",
    "  --persist             Write the snapshot and each source's robots_txt_* columns in the current DB runtime.",
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
    registry: "data-sources",
    timeoutMs: 10_000,
    nodeFetch: false,
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
    } else if (arg === "--node-fetch") {
      options.nodeFetch = true;
    } else if (arg === "--all") {
      options.sourceFilters = [];
    } else if (arg === "--state-definitions") {
      options.registry = "state-definitions";
    } else if (arg === "--data-sources") {
      options.registry = "data-sources";
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

/** `--source` filters match either a state code or a source id, on both registries. */
export function selectComplianceSources(
  sources: readonly SourceComplianceInput[],
  filters: string[],
): SourceComplianceInput[] {
  if (filters.length === 0) return [...sources];

  const normalized = new Set(filters.map((filter) => filter.toLowerCase()));
  const selected = sources.filter(
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
  /** Per-source `robots_txt_*` write-back; skipped for the state-definitions registry. */
  applySqliteRobots?: typeof applyRobotsComplianceToDataSources;
  applyMysqlRobots?: typeof applyRobotsComplianceToDataSourcesFromMysql;
}

export async function persistSourceComplianceSnapshot(
  report: SourceComplianceReport,
  env: NodeJS.ProcessEnv = process.env,
  deps: PersistSnapshotDeps = {},
  options: { writeBackRobots?: boolean } = {},
) {
  const writeBackRobots = options.writeBackRobots !== false;

  if (isMysqlDatabaseUrlConfigured(env)) {
    const pool = (deps.createMysqlPoolForUrl ?? createMysqlPool)(requireMysqlDatabaseUrl(env));

    try {
      await (deps.recordMysqlSnapshot ?? recordSourceComplianceSnapshotFromMysql)(pool, report);
      if (writeBackRobots) {
        await (deps.applyMysqlRobots ?? applyRobotsComplianceToDataSourcesFromMysql)(pool, report);
      }
    } finally {
      await pool.end();
    }

    return "mysql";
  }

  const db = (deps.createSqliteDatabase ?? createDatabase)();
  try {
    (deps.runSqliteMigrations ?? runMigrations)(db);
    (deps.recordSqliteSnapshot ?? recordSourceComplianceSnapshot)(db, report);
    if (writeBackRobots) {
      (deps.applySqliteRobots ?? applyRobotsComplianceToDataSources)(db, report);
    }
  } finally {
    db.$client.close();
  }

  return "sqlite";
}

interface LoadComplianceSourcesDeps {
  createSqliteDatabase?: () => SqliteSnapshotDatabase;
  runSqliteMigrations?: (db: SqliteSnapshotDatabase) => void;
  listSqliteSources?: typeof listDataSourceComplianceInputs;
  createMysqlPoolForUrl?: (databaseUrl: string) => MysqlSnapshotPool;
  listMysqlSources?: typeof listDataSourceComplianceInputsFromMysql;
}

/** Resolves the scan population for a registry, applying `--source` filters. */
export async function loadComplianceSources(
  registry: ComplianceRegistry,
  filters: string[],
  env: NodeJS.ProcessEnv = process.env,
  deps: LoadComplianceSourcesDeps = {},
): Promise<SourceComplianceInput[]> {
  if (registry === "state-definitions") {
    return selectComplianceSources(STATE_CRAWLER_SOURCE_DEFINITIONS, filters);
  }

  if (isMysqlDatabaseUrlConfigured(env)) {
    const pool = (deps.createMysqlPoolForUrl ?? createMysqlPool)(requireMysqlDatabaseUrl(env));
    try {
      const sources = await (deps.listMysqlSources ?? listDataSourceComplianceInputsFromMysql)(pool);
      return selectComplianceSources(sources, filters);
    } finally {
      await pool.end();
    }
  }

  const db = (deps.createSqliteDatabase ?? createDatabase)();
  try {
    (deps.runSqliteMigrations ?? runMigrations)(db);
    return selectComplianceSources((deps.listSqliteSources ?? listDataSourceComplianceInputs)(db), filters);
  } finally {
    db.$client.close();
  }
}

async function main() {
  const options = parseSourceComplianceScanArgs(process.argv.slice(2));
  if (options.help) {
    console.log(formatSourceComplianceScanHelp());
    return;
  }

  const sources = await loadComplianceSources(options.registry, options.sourceFilters);
  // Default: fetch robots.txt through the Python crawler (same client, same UA the portals see;
  // Node fetch is blocked by WAF-fronted portals such as BidNet). `--node-fetch` opts out.
  const report = await scanSourceCompliance(sources, {
    timeoutMs: options.timeoutMs,
    ...(options.nodeFetch ? {} : { fetchImpl: createCrawlerBackedRobotsFetch({ timeoutMs: Math.max(options.timeoutMs, 15_000) }) }),
  });

  if (options.persist) {
    await persistSourceComplianceSnapshot(report, process.env, {}, {
      writeBackRobots: options.registry === "data-sources",
    });
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
