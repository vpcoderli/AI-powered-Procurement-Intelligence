import { createDatabase, type AppDatabase } from "../src/server/db/client";
import { closeResolvedMysqlPool, isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "../src/server/db/mysql";
import { runMigrations } from "../src/server/db/migrate";
import type { MysqlDataSourcesStore } from "../src/server/admin/data-sources-repository";
import {
  normalizeRequestPrechecksInput,
  requestPrechecks,
  requestPrechecksFromMysql,
  selectPrecheckTargets,
  selectPrecheckTargetsFromMysql,
  type RequestPrechecksResult,
} from "../src/server/admin/precheck-queue";

export interface SourcePrecheckArgs {
  providerFamily: string | null;
  pending: boolean;
  sourceIds: string[];
  dryRun: boolean;
  help: boolean;
}

export function formatSourcePrecheckHelp(): string {
  return [
    "Usage: npm run source:precheck -- [--provider <family> --pending] [--source <id> ...] [--dry-run]",
    "",
    "Marks data_sources.precheck_requested_at (spec 2026-09-24 §7.2). Nothing is fetched here: the",
    "crawler worker runs the queued prechecks within the platform budget and clears the flag.",
    "",
    "  --provider <family>   platform (provider_family), e.g. bidnet; requires --pending",
    "  --pending             every local source of that platform awaiting a precheck and not yet queued:",
    "                        enabled, unapproved, not held by a person, and its stored precheck is",
    "                        missing, of another address, older than a later failure or governance",
    "                        change, or older than 14 days (the console's \"awaiting precheck\")",
    "  --source <id>         queue one source id (repeatable)",
    "  --dry-run             print what would be queued, write nothing",
    "",
    "Example: npm run source:precheck -- --provider bidnet --pending",
  ].join("\n");
}

export function parseSourcePrecheckArgs(argv: string[]): SourcePrecheckArgs {
  const args: SourcePrecheckArgs = { providerFamily: null, pending: false, sourceIds: [], dryRun: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    const [flag, inline] = raw.includes("=") ? [raw.slice(0, raw.indexOf("=")), raw.slice(raw.indexOf("=") + 1)] : [raw, undefined];
    const value = () => {
      if (inline !== undefined) return inline;
      index += 1;
      if (index >= argv.length) throw new Error(`${flag} needs a value`);
      return argv[index];
    };
    if (flag === "--provider") args.providerFamily = value().trim().toLowerCase();
    else if (flag === "--source") args.sourceIds.push(value().trim());
    else if (flag === "--pending") args.pending = true;
    else if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else throw new Error(`unknown argument: ${raw}`);
  }
  if (!args.help && args.providerFamily && !args.pending) throw new Error("--provider requires --pending (only the pending set is queued platform-wide)");
  if (!args.help && !args.providerFamily && args.sourceIds.length === 0) throw new Error("pass --source <id> or --provider <family> --pending");
  return args;
}

export interface SourcePrecheckCommandDeps {
  database?: AppDatabase;
  mysql?: MysqlDataSourcesStore;
  now?: Date;
  log?: (line: string) => void;
}

export async function runSourcePrecheckCommand(args: SourcePrecheckArgs, deps: SourcePrecheckCommandDeps): Promise<RequestPrechecksResult> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const now = deps.now ?? new Date();
  const input = normalizeRequestPrechecksInput({ sourceIds: args.sourceIds, providerFamily: args.providerFamily, pending: args.pending });
  const dialect = deps.mysql ? "MySQL" : "SQLite";

  if (args.dryRun) {
    const ids = deps.mysql ? await selectPrecheckTargetsFromMysql(deps.mysql, input, now) : selectPrecheckTargets(deps.database as AppDatabase, input, now);
    log(`Dry run (${dialect}): ${ids.length} sources would be queued`);
    for (const id of ids) log(`  ${id}`);
    return { requestedCount: ids.length, sourceIds: ids };
  }

  const result = deps.mysql ? await requestPrechecksFromMysql(deps.mysql, input, now) : requestPrechecks(deps.database as AppDatabase, input, now);
  const preview = result.sourceIds.slice(0, 20).join(", ") + (result.sourceIds.length > 20 ? ", …" : "");
  log(`Queued ${result.requestedCount} sources for precheck (${dialect})${preview ? `: ${preview}` : ""}`);
  return result;
}

async function main() {
  let args: SourcePrecheckArgs;
  try {
    args = parseSourcePrecheckArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    console.error(formatSourcePrecheckHelp());
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    console.log(formatSourcePrecheckHelp());
    return;
  }

  if (isMysqlDatabaseUrlConfigured()) {
    try {
      await runSourcePrecheckCommand(args, { mysql: resolveMysqlPool() });
    } finally {
      await closeResolvedMysqlPool();
    }
    return;
  }

  const db = createDatabase();
  runMigrations(db);
  try {
    await runSourcePrecheckCommand(args, { database: db });
  } finally {
    db.$client.close();
  }
}

if (process.argv[1]?.endsWith("source-precheck.ts")) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
