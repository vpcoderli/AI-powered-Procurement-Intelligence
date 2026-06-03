import { fileURLToPath } from "node:url";
import { STATE_CRAWLER_SOURCES } from "../src/lib/state-crawler-sources";
import { createDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { checkLiveSourceHealth, formatLiveSourceHealthReport } from "../src/server/source-validity/live-source-health";
import { recordLiveSourceHealthSnapshot } from "../src/server/source-validity/health-snapshots";

interface CliOptions {
  sourceFilters: string[];
  timeoutMs: number;
  reportOnly: boolean;
  json: boolean;
  persist: boolean;
}

export function parseSourceHealthCheckArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    sourceFilters: [],
    timeoutMs: 10_000,
    reportOnly: false,
    json: false,
    persist: false,
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

async function main() {
  const options = parseSourceHealthCheckArgs(process.argv.slice(2));
  const sources = selectedSources(options.sourceFilters);
  const report = await checkLiveSourceHealth(sources, { timeoutMs: options.timeoutMs });

  if (options.persist) {
    const db = createDatabase();
    runMigrations(db);
    recordLiveSourceHealthSnapshot(db, report);
    db.$client.close();
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
