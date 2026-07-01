import { fileURLToPath } from "node:url";
import { STATE_CRAWLER_SOURCES } from "../src/lib/state-crawler-sources";
import { createDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { createMysqlPool, isMysqlDatabaseUrlConfigured, requireMysqlDatabaseUrl } from "../src/server/db/mysql";
import { checkLiveSourceHealth, formatLiveSourceHealthReport } from "../src/server/source-validity/live-source-health";
import {
  recordLiveSourceHealthSnapshot,
  recordLiveSourceHealthSnapshotFromMysql,
} from "../src/server/source-validity/health-snapshots";
import type { LiveSourceHealthReport } from "../src/server/source-validity/live-source-health";

interface CliOptions {
  sourceFilters: string[];
  timeoutMs: number;
  reportOnly: boolean;
  json: boolean;
  persist: boolean;
  inspectBody: boolean;
  help: boolean;
}

export function formatSourceHealthCheckHelp() {
  return [
    "Source Health Check",
    "",
    "Usage:",
    "  npm run source:health:check -- --all --timeout-ms 5000 --report-only",
    "  npm run source:health:check -- --source CA --inspect-body --report-only",
    "  npm run source:health:ops",
    "  npm run source:health:scheduled",
    "",
    "Options:",
    "  --all                 Check the full state source registry.",
    "  --source <value>      Check one state code or source id. Can be repeated.",
    "  --timeout-ms <value>  Per-request timeout from 1000 to 60000 ms. Default: 10000.",
    "  --inspect-body        Inspect successful GET bodies for empty, bot_check, and login_required pages.",
    "  --persist             Write the latest snapshot for Admin Data Sources in the current DB runtime.",
    "  --write-snapshot      Operations alias for --persist.",
    "  --report-only         Print unhealthy results without exiting non-zero.",
    "  --json                Print raw JSON report.",
    "  --help                Print this help.",
    "",
    "Operations aliases:",
    "  source:health:ops and source:health:scheduled run a production-like report-only snapshot with",
    "  --all --timeout-ms 10000 --inspect-body --write-snapshot --report-only.",
    "",
    "Classification handoff:",
    "  403/forbidden, bot_check, login_required, empty_or_placeholder, and access_challenge mean",
    "  browser_or_access_review. timeout means retry_or_increase_timeout. TLS/DNS/fetch failures mean",
    "  network_or_tls_review. HTTP 404/410 means update_registry_url.",
  ].join("\n");
}

export function parseSourceHealthCheckArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    sourceFilters: [],
    timeoutMs: 10_000,
    reportOnly: false,
    json: false,
    persist: false,
    inspectBody: false,
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
    } else if (arg === "--inspect-body") {
      options.inspectBody = true;
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
type MysqlSnapshotPool = Parameters<typeof recordLiveSourceHealthSnapshotFromMysql>[0] & {
  end: () => Promise<void>;
};

interface PersistSnapshotDeps {
  createSqliteDatabase?: () => SqliteSnapshotDatabase;
  runSqliteMigrations?: (db: SqliteSnapshotDatabase) => void;
  recordSqliteSnapshot?: typeof recordLiveSourceHealthSnapshot;
  createMysqlPoolForUrl?: (databaseUrl: string) => MysqlSnapshotPool;
  recordMysqlSnapshot?: typeof recordLiveSourceHealthSnapshotFromMysql;
}

export async function persistLiveSourceHealthSnapshot(
  report: LiveSourceHealthReport,
  env: NodeJS.ProcessEnv = process.env,
  deps: PersistSnapshotDeps = {},
) {
  if (isMysqlDatabaseUrlConfigured(env)) {
    const pool = (deps.createMysqlPoolForUrl ?? createMysqlPool)(requireMysqlDatabaseUrl(env));

    try {
      await (deps.recordMysqlSnapshot ?? recordLiveSourceHealthSnapshotFromMysql)(pool, report);
    } finally {
      await pool.end();
    }

    return "mysql";
  }

  const db = (deps.createSqliteDatabase ?? createDatabase)();
  try {
    (deps.runSqliteMigrations ?? runMigrations)(db);
    (deps.recordSqliteSnapshot ?? recordLiveSourceHealthSnapshot)(db, report);
  } finally {
    db.$client.close();
  }

  return "sqlite";
}

async function main() {
  const options = parseSourceHealthCheckArgs(process.argv.slice(2));
  if (options.help) {
    console.log(formatSourceHealthCheckHelp());
    return;
  }

  const sources = selectedSources(options.sourceFilters);
  const report = await checkLiveSourceHealth(sources, {
    timeoutMs: options.timeoutMs,
    inspectBody: options.inspectBody,
  });

  if (options.persist) {
    await persistLiveSourceHealthSnapshot(report);
  }

  console.log(options.json ? JSON.stringify(report, null, 2) : formatLiveSourceHealthReport(report));

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
