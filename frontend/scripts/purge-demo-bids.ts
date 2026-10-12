import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  closeResolvedMysqlPool,
  isMysqlDatabaseUrlConfigured,
  requireMysqlDatabaseUrl,
  resolveMysqlPool,
} from "../src/server/db/mysql";
import { purgeDemoBids, type DemoPurgeResult, type DemoPurgeTarget } from "../src/server/integrity/demo-purge";

export interface PurgeDemoBidsCliOptions {
  apply: boolean;
  backupFile: string | null;
  json: boolean;
  help: boolean;
}

/** A bad command line, or a target that cannot be used (no such SQLite file): reported, then exit code 2. */
export class PurgeDemoBidsUsageError extends Error {}

export interface PurgeDemoBidsIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const BACKUP_HINT = "Take a backup first (npm run db:backup, or mysqldump inside the MySQL container).";

export function formatPurgeDemoBidsHelp() {
  return [
    "Demo and seed bid purge",
    "",
    "Usage:",
    "  tsx scripts/purge-demo-bids.ts                                     dry run: print what would be deleted",
    "  tsx scripts/purge-demo-bids.ts --json                              the same, as JSON",
    "  tsx scripts/purge-demo-bids.ts --apply --backup-file <backup>      delete, in one transaction",
    "",
    "Options:",
    "  --apply               Delete the demo and seed bids and every row that depends on them. Without it nothing is written.",
    "  --backup-file <path>  Required with --apply: an existing, non-empty backup file. " + BACKUP_HINT,
    "  --json                Print machine-readable output.",
    "  --help                Print this help.",
    "",
    "Exit codes: 0 done, 1 error (the purge is rolled back), 2 usage (a bad command line, a backup file that is missing,",
    "empty or the database itself, or a SQLite database that is not there).",
    "",
    "Which bids: id prefix (text before the first ':') is not a data_sources.id, and either the id ends with",
    "_demo_readiness and source_bid_id starts with demo: (npm run demo:prepare), or the id is all digits and",
    "source_bid_id is mock:<id> (db:seed).",
    "",
    "Deleted with them, children first: every table whose REFERENCES chain in src/server/db/migrate.ts reaches bids",
    "(attachments, saved bids, intents and their workspace items, comments, activity, packages, exports, artifacts,",
    "quote requests, deadline reminders, award outcomes, ...). knowledge_items are kept; their link to a deleted bid or",
    "intent is set to NULL. The transaction is rolled back if any reference would be left dangling.",
    "",
    "Left untouched, as history: notification_outbox.matched_bid_ids, search_alert_digest_runs.matched_bid_ids_json,",
    "event_log.target_id / metadata_json, ai_call_logs.metadata_json, crawler_logs.metadata. Files behind storage_path",
    "columns (artifact vault, response-package exports, archived attachments) are not removed.",
    "",
    "Target: DATABASE_URL / MYSQL_DATABASE_URL when it is a mysql:// URL, otherwise the SQLite file at DATABASE_PATH",
    "(default data/apsi.sqlite, which must exist: nothing is created). The process environment is used as it is;",
    ".env.local is not read. The target is printed to stderr as soon as it is opened.",
    "",
    "A maintenance window is required on MySQL: stop the web app AND every worker first. MySQL has no foreign keys, so the",
    "web app can insert a child row for a demo bid (a save, an intent, a workspace edit) while the purge runs, and that row",
    "would be an orphan after the commit. SQLite is protected by BEGIN IMMEDIATE (the purge takes the write lock up front",
    "and holds it for its whole transaction) plus the foreign keys the app enforces, so nothing can slip in.",
    "",
    "npm run demo:prepare, npm run db:seed and npm run db:mysql:import-sqlite re-create demo bids (the first against",
    "MySQL, the second in the local SQLite file, the third by copying that file into MySQL): never run any of them",
    "against winbids or production.",
  ].join("\n");
}

export function parsePurgeDemoBidsArgs(argv: readonly string[]): PurgeDemoBidsCliOptions {
  const options: PurgeDemoBidsCliOptions = { apply: false, backupFile: null, json: false, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--backup-file") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new PurgeDemoBidsUsageError("--backup-file requires a path.");
      options.backupFile = value;
      index += 1;
    } else if (arg.startsWith("--backup-file=")) {
      const value = arg.slice("--backup-file=".length);
      if (!value) throw new PurgeDemoBidsUsageError("--backup-file requires a path.");
      options.backupFile = value;
    } else {
      throw new PurgeDemoBidsUsageError(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

/** The same file under another name: the same path once resolved, or a symbolic or hard link to it. */
function isSameFile(left: string, right: string): boolean {
  if (path.resolve(left) === path.resolve(right)) return true;
  try {
    const a = statSync(left);
    const b = statSync(right);
    return a.ino !== 0 && a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}

/**
 * Why `--apply` may not run yet, or null when the backup file it names exists and holds something. `databasePath` is
 * the SQLite file the purge is about to change (null on MySQL): the database is never its own backup.
 */
export function backupFileProblem(backupFile: string | null, databasePath: string | null = null): string | null {
  if (!backupFile) return `--apply requires --backup-file <path>. ${BACKUP_HINT}`;
  if (databasePath && isSameFile(backupFile, databasePath)) {
    return `--backup-file ${backupFile} is the SQLite database itself, not a backup of it. ${BACKUP_HINT}`;
  }
  let stats;
  try {
    stats = statSync(path.resolve(backupFile));
  } catch {
    return `--backup-file ${backupFile} does not exist. ${BACKUP_HINT}`;
  }
  if (!stats.isFile()) return `--backup-file ${backupFile} is not a file. ${BACKUP_HINT}`;
  if (stats.size === 0) return `--backup-file ${backupFile} is empty. ${BACKUP_HINT}`;
  return null;
}

function countByKind(result: DemoPurgeResult) {
  const byKind = { demo_readiness: 0, mock_seed: 0 };
  for (const bid of result.bids) byKind[bid.kind] += 1;
  return byKind;
}

export function formatPurgeDemoBidsReport(result: DemoPurgeResult, target: string, mode: "dry-run" | "apply"): string {
  const byKind = countByKind(result);
  const outcome = result.applied ? "APPLIED" : mode === "apply" ? "--apply found nothing to purge" : "dry run, nothing was written";
  const lines = [`Demo and seed bid purge: ${outcome}`, `Target: ${target}`];

  if (result.bids.length === 0) {
    lines.push("No demo or seed bids found; nothing to purge.");
    return lines.join("\n");
  }

  lines.push(
    `Demo bids: ${result.bids.length} (demo_readiness ${byKind.demo_readiness}, mock_seed ${byKind.mock_seed})`,
    result.applied ? "Rows deleted with them:" : "Rows that depend on them, and would be deleted:",
  );
  // Every table of the purge, zero rows included: a table that is not listed here is not covered.
  const counts = Object.entries(result.applied ? result.deleted : result.dependents).filter(([table]) => table !== "bids");
  const width = Math.max(0, ...counts.map(([table]) => table.length));
  for (const [table, count] of counts) lines.push(`  ${table.padEnd(width)}  ${count}`);
  // The other writes of the apply: links nulled on rows that stay. With the rows above, every write of the apply.
  const links = Object.entries(result.applied ? result.detached : result.detachments);
  const linkWidth = Math.max(0, ...links.map(([link]) => link.length));
  lines.push("Links set to NULL on rows that are kept:");
  for (const [link, count] of links) lines.push(`  ${link.padEnd(linkWidth)}  ${count}`);
  lines.push(`Knowledge items that lose a link to a demo bid or intent (kept): ${result.knowledgeItemsToDetach}`);

  if (result.applied) {
    lines.push(`Deleted ${result.deleted.bids} bids and ${counts.reduce((sum, [, count]) => sum + count, 0)} dependent rows in one transaction.`);
  } else {
    lines.push(
      "",
      `To delete them: ${BACKUP_HINT} Then run`,
      "  tsx scripts/purge-demo-bids.ts --apply --backup-file <the backup file>",
    );
  }
  if (result.applied) {
    lines.push("Do not run npm run demo:prepare, npm run db:seed or npm run db:mysql:import-sqlite against this database: they re-create demo bids.");
  }
  lines.push(
    "Left untouched, as history: notification_outbox.matched_bid_ids, search_alert_digest_runs.matched_bid_ids_json, " +
      "event_log.target_id / metadata_json, ai_call_logs.metadata_json, crawler_logs.metadata; files behind storage_path columns stay too.",
  );
  return lines.join("\n");
}

type ResolvedTarget = { kind: "mysql"; databaseUrl: string } | { kind: "sqlite"; databasePath: string };

/** Which database the environment points at, without touching it. */
function resolveTarget(env: NodeJS.ProcessEnv): ResolvedTarget {
  if (isMysqlDatabaseUrlConfigured(env)) return { kind: "mysql", databaseUrl: requireMysqlDatabaseUrl(env) };
  return { kind: "sqlite", databasePath: path.resolve(process.cwd(), env.DATABASE_PATH?.trim() || path.join("data", "apsi.sqlite")) };
}

interface OpenedTarget {
  target: DemoPurgeTarget;
  description: string;
  close: () => Promise<void>;
}

async function openTarget(resolved: ResolvedTarget): Promise<OpenedTarget> {
  if (resolved.kind === "mysql") {
    // mysql-smoke.ts pulls in most of the server; only the MySQL runtime needs its URL redaction.
    const { redactMysqlDatabaseUrl } = await import("../src/server/db/mysql-smoke");
    return {
      target: { mysql: resolveMysqlPool(resolved.databaseUrl) },
      description: `mysql ${redactMysqlDatabaseUrl(resolved.databaseUrl)}`,
      // An open mysql2 pool keeps the process alive, so it is released on every path (see src/server/db/mysql.ts).
      close: () => closeResolvedMysqlPool(),
    };
  }

  // Opening a SQLite path creates an empty database at a mistyped one, and so does importing the app's db/client (its
  // `db` is created at import time, in <cwd>/data). This script does neither: it checks that the file is there, then
  // opens it with fileMustExist, and the purge reads and writes through that connection alone.
  if (!existsSync(resolved.databasePath)) {
    throw new PurgeDemoBidsUsageError(
      `SQLite database not found: ${resolved.databasePath}. Nothing was created. ` +
        "Set DATABASE_PATH to the database file (the default is data/apsi.sqlite in the directory you run this from).",
    );
  }
  const sqlite = new Database(resolved.databasePath, { fileMustExist: true });
  try {
    // The settings the app gives its own connections (db/client.ts), except journal_mode: the purge does not change it.
    sqlite.pragma("busy_timeout = 5000");
    sqlite.pragma("foreign_keys = ON");
  } catch (error) {
    sqlite.close();
    throw error;
  }
  return {
    target: { database: { $client: sqlite } },
    description: `sqlite ${resolved.databasePath}`,
    close: async () => {
      sqlite.close();
    },
  };
}

/**
 * The whole command, returning its exit code (0 done, 1 error, 2 usage) instead of exiting, so it can be run
 * and tested in-process. On the MySQL runtime it ENDS the process-wide shared pool when it is done, on every path.
 */
export async function runPurgeDemoBids(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  io: PurgeDemoBidsIo = { stdout: (text) => console.log(text), stderr: (text) => console.error(text) },
): Promise<number> {
  let options: PurgeDemoBidsCliOptions;
  try {
    options = parsePurgeDemoBidsArgs(argv);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${formatPurgeDemoBidsHelp()}`);
    return 2;
  }
  if (options.help) {
    io.stdout(formatPurgeDemoBidsHelp());
    return 0;
  }

  const resolved = resolveTarget(env);
  if (options.apply) {
    const problem = backupFileProblem(options.backupFile, resolved.kind === "sqlite" ? resolved.databasePath : null);
    if (problem) {
      io.stderr(problem);
      return 2;
    }
  }

  let opened: OpenedTarget | undefined;
  try {
    opened = await openTarget(resolved);
    // Before anything is planned or written: a run that fails or rolls back still says which database it hit. It goes
    // to stderr, so that --json leaves stdout as one JSON document.
    io.stderr(`Target: ${opened.description}`);
    const result = await purgeDemoBids(opened.target, { apply: options.apply });
    const mode = options.apply ? "apply" : "dry-run";
    io.stdout(
      options.json
        ? JSON.stringify({ target: opened.description, mode, ...result, byKind: countByKind(result) }, null, 2)
        : formatPurgeDemoBidsReport(result, opened.description, mode),
    );
    return 0;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return error instanceof PurgeDemoBidsUsageError ? 2 : 1;
  } finally {
    await opened?.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPurgeDemoBids(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
