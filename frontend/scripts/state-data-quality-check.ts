import { fileURLToPath } from "node:url";
import { db } from "../src/server/db/client";
import { closeResolvedMysqlPool, isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "../src/server/db/mysql";
import {
  cleanupDuplicateCanonicalStateSources,
  createStateDataQualityReport,
  createStateDataQualityReportFromMysql,
  formatStateDataQualityReport,
} from "../src/server/source-validity/state-data-quality";

export interface StateDataQualityCheckCliOptions {
  json: boolean;
  reportOnly: boolean;
  fixCanonicalSources: boolean;
  help: boolean;
}

export function formatStateDataQualityCheckHelp() {
  return [
    "State Data Quality Check",
    "",
    "Usage:",
    "  tsx scripts/state-data-quality-check.ts",
    "  tsx scripts/state-data-quality-check.ts --json --report-only",
    "",
    "Options:",
    "  --json         Print the raw state data quality report JSON.",
    "  --report-only  Print blockers and warnings without exiting non-zero.",
    "  --fix-canonical-sources",
    "                Disable duplicate enabled state source aliases and keep canonical crawler sources enabled.",
    "  --help         Print this help.",
    "",
    "This command reads local database tables and prints a deterministic 50 state quality summary.",
  ].join("\n");
}

export function parseStateDataQualityCheckArgs(argv: string[]): StateDataQualityCheckCliOptions {
  const options: StateDataQualityCheckCliOptions = {
    json: false,
    reportOnly: false,
    fixCanonicalSources: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--report-only") {
      options.reportOnly = true;
    } else if (arg === "--fix-canonical-sources") {
      options.fixCanonicalSources = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

/**
 * The report this script prints. On the MySQL runtime it ENDS the process-wide shared pool when it is done, on every
 * path (see the finally below): after it returns, that pool is gone and the next resolveMysqlPool() opens a new one.
 *
 * Call it only from this script's one-shot `main()`, which has nothing left to do with the pool afterwards. Do not
 * call it from code that keeps using the pool (a server route, a worker loop, a test that shares the pool). And do
 * not move the close out of here: the report is the script's only use of the pool, and an open pool's connections
 * and idle-connection timer keep the process from exiting.
 */
export async function createStateDataQualityCheckReport(now = new Date(), env = process.env) {
  if (isMysqlDatabaseUrlConfigured(env)) {
    try {
      return await createStateDataQualityReportFromMysql(resolveMysqlPool(), now);
    } finally {
      // The report is the only thing this script uses the shared pool for, and an open mysql2 pool keeps the
      // process alive (its connections, and its idle-connection timer). Release it on every path, a failed
      // query included, before main() returns or calls process.exit().
      await closeResolvedMysqlPool();
    }
  }

  return createStateDataQualityReport(db, now);
}

async function main() {
  const options = parseStateDataQualityCheckArgs(process.argv.slice(2));
  if (options.help) {
    console.log(formatStateDataQualityCheckHelp());
    return;
  }

  if (options.fixCanonicalSources) {
    if (isMysqlDatabaseUrlConfigured()) {
      throw new Error("--fix-canonical-sources is only supported for the SQLite runtime.");
    }

    const cleanup = cleanupDuplicateCanonicalStateSources(db);
    console.error(
      `Canonical state source cleanup: disabled=${cleanup.disabledSourceIds.length}, `
        + `enabledCanonical=${cleanup.enabledCanonicalSourceIds.length}, unresolved=${cleanup.unresolvedStateCodes.length}`,
    );
  }

  const report = await createStateDataQualityCheckReport();
  console.log(options.json ? JSON.stringify(report, null, 2) : formatStateDataQualityReport(report));

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
