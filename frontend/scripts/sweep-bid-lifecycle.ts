import { fileURLToPath } from "node:url";
import type BetterSqlite3 from "better-sqlite3";
import { sweepExpiredBids, type LifecycleSweepResult, type LifecycleSweepTarget } from "../src/server/bids/lifecycle-sweep";
import {
  IntegrityUsageError,
  openResolvedTarget,
  resolveIntegrityTarget,
  type OpenOptions,
  type OpenedIntegrityTarget,
  type ResolvedTarget,
} from "../src/server/integrity/open-target";

/**
 * One pass of the deadline sweep: closes every open bid whose deadline has passed. The crawler worker runs
 * the same sweep on every tick; this is the one-shot for a first catch-up, for a source nobody is crawling,
 * and (with --dry-run) for seeing what a sweep would close before it does.
 *
 * Usage: npx tsx scripts/sweep-bid-lifecycle.ts [--dry-run] [--json]
 *   --dry-run  count what would be closed and write nothing: a SQLite file is opened read-only, and on MySQL only SELECT
 *              statements are sent (no transaction is opened)
 *   --json     print the result as JSON instead of a summary
 *
 * The target is chosen by the opener of data:integrity and bids:purge-demo (src/server/integrity/open-target.ts): a mysql://
 * DATABASE_URL, else the SQLite file DATABASE_PATH, a relative path read from frontend/ and the default data/apsi.sqlite there.
 * The file must exist, and nothing is created: importing the app's db/client would open <cwd>/data/apsi.sqlite, so this
 * script never does. It never migrates either: a schema that lacks what the sweep reads is refused, untouched.
 *
 * Exit codes: 0 when the sweep ran, 1 when it failed (a mistyped option included), 2 when the target cannot be used: a SQLite
 * file that is not there or is a directory, or a schema that is not migrated.
 */

export interface SweepBidLifecycleOptions {
  dryRun: boolean;
  json: boolean;
}

export interface SweepBidLifecycleIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** How the target is opened; the real opener unless a test hands in another. */
export type SweepBidLifecycleOpen = (resolved: ResolvedTarget, options: OpenOptions) => Promise<OpenedIntegrityTarget>;

export function formatSweepUsage() {
  return [
    "Usage: sweep-bid-lifecycle.ts [--dry-run] [--json]",
    "",
    "One pass of the deadline sweep: closes every open bid whose deadline has passed. The crawler worker runs the same sweep on",
    "every tick; this is the one-shot for a first catch-up, for a source nobody is crawling, and, with --dry-run, for seeing what",
    "a sweep would close before it does.",
    "",
    "  --dry-run  Count what would be closed and write nothing: a SQLite file is opened read-only, and on MySQL only SELECT",
    "             statements are sent (no transaction is opened).",
    "  --json     Print the result as JSON instead of a summary.",
    "",
    "Target: DATABASE_URL / MYSQL_DATABASE_URL when it is a mysql:// URL, otherwise the SQLite file at DATABASE_PATH, chosen as",
    "data:integrity and bids:purge-demo choose theirs: a relative path is read from the frontend/ directory, whatever directory you",
    "run this from; the default is data/apsi.sqlite there; the file must exist, and nothing is created. The process environment is",
    "used as it is; .env.local is not read. The target is printed to stderr as soon as it is opened.",
    "",
    "The sweep never migrates. A SQLite file or a MySQL schema that lacks what the sweep reads is refused, untouched: run",
    "npm run db:migrate (SQLite) or npm run db:mysql:migrate (MySQL) first.",
    "",
    "Exit codes: 0 the sweep ran; 1 it failed (a mistyped option, a refused MySQL connection, any other error); 2 the target cannot",
    "be used (a SQLite file that is not there or is a directory, or a schema that is not migrated).",
  ].join("\n");
}

export function parseSweepArgs(argv: readonly string[]): SweepBidLifecycleOptions {
  const unknown = argv.filter((argument) => argument !== "--dry-run" && argument !== "--json");
  // A mistyped option must not turn a dry run into a real sweep. It fails like any other error of this script (exit 1); the
  // status 2 is for a target that cannot be used.
  if (unknown.length > 0) throw new Error(`Unknown option ${unknown.join(", ")}.\n\n${formatSweepUsage()}`);
  return { dryRun: argv.includes("--dry-run"), json: argv.includes("--json") };
}

export function summarizeSweep(result: LifecycleSweepResult) {
  const byIssuerType = Object.entries(result.closedByIssuerType).sort(([leftType, left], [rightType, right]) => right - left || leftType.localeCompare(rightType));
  return [
    result.dryRun ? "Bid lifecycle sweep (dry run: nothing was written)" : "Bid lifecycle sweep",
    `scanned: ${result.scanned}`,
    `closed: ${result.closed}${result.dryRun ? " (would be closed)" : ""}`,
    `unparseable: ${result.unparseable}`,
    ...(byIssuerType.length > 0 ? ["closed by issuer type:", ...byIssuerType.map(([issuerType, count]) => `  ${issuerType}: ${count}`)] : []),
  ].join("\n");
}

/** The columns of `bids` the sweep reads and writes. */
const SWEEP_COLUMNS = ["id", "deadline_date", "issuer_type", "raw_payload", "lifecycle_status", "is_active", "updated_at"] as const;
/** The MySQL errors for a table or column the schema lacks. */
const MYSQL_UNMIGRATED_CODES: ReadonlySet<string> = new Set(["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"]);

/** Refuses a SQLite file that lacks what the sweep needs, before anything is read from it or written to it. */
function assertSqliteMigrated(sqlite: BetterSqlite3.Database, description: string) {
  const present = new Set((sqlite.prepare("PRAGMA table_info(bids)").all() as Array<{ name: string }>).map((column) => column.name));
  const missing = SWEEP_COLUMNS.filter((column) => !present.has(column));
  if (missing.length === 0) return;
  throw new IntegrityUsageError(
    `${present.size === 0 ? `${description} has no bids table` : `The bids table of ${description} has no ${missing.join(", ")}`}. ` +
      "The sweep never migrates: run npm run db:migrate first. Nothing was changed.",
  );
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The whole command, returning its exit code (0 ran, 1 failed, 2 target unusable) instead of exiting, so it can be run and
 * tested in-process. On the MySQL runtime it ENDS the process-wide shared pool when it is done, on every path.
 */
export async function runSweepBidLifecycle(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  io: SweepBidLifecycleIo = { stdout: (text) => console.log(text), stderr: (text) => console.error(text) },
  clock: { now: () => Date } = { now: () => new Date() },
  open: SweepBidLifecycleOpen = openResolvedTarget,
): Promise<number> {
  let options: SweepBidLifecycleOptions;
  try {
    options = parseSweepArgs(argv);
  } catch (error) {
    io.stderr(messageOf(error));
    return 1;
  }

  let opened: OpenedIntegrityTarget | undefined;
  try {
    // A dry run only reads: its SQLite connection itself then refuses a write.
    opened = await open(resolveIntegrityTarget(env), { readonly: options.dryRun });
    // Before anything is read: a run that fails or is refused still says which database it hit. It goes to stderr, so that
    // --json leaves stdout as one JSON document.
    io.stderr(`Target: ${opened.description}`);
    const target: LifecycleSweepTarget = "mysql" in opened.target ? { mysql: opened.target.mysql } : { database: opened.target.database };
    if ("database" in target) assertSqliteMigrated(target.database.$client, opened.description);
    const result = await sweepExpiredBids(target, { now: clock.now(), dryRun: options.dryRun });
    io.stdout(options.json ? JSON.stringify(result, null, 2) : summarizeSweep(result));
    return 0;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (opened && "mysql" in opened.target && typeof code === "string" && MYSQL_UNMIGRATED_CODES.has(code)) {
      io.stderr(`${messageOf(error)}\nThe MySQL schema is not migrated, and the sweep never migrates: run npm run db:mysql:migrate first.`);
      return 2;
    }
    io.stderr(messageOf(error));
    return error instanceof IntegrityUsageError ? 2 : 1;
  } finally {
    await opened?.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSweepBidLifecycle(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(messageOf(error));
      process.exitCode = 1;
    },
  );
}
