import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  closeResolvedMysqlPool,
  isMysqlDatabaseUrlConfigured,
  requireMysqlDatabaseUrl,
  resolveMysqlPool,
} from "../src/server/db/mysql";
import {
  INTEGRITY_LEVELS,
  IntegritySnapshotError,
  NUMERIC_LEVEL_METRICS,
  buildIntegrityReport,
  buildIntegritySnapshot,
  parseIntegritySnapshot,
  serializeIntegritySnapshot,
  type IntegrityReport,
  type IntegritySnapshot,
  type IntegrityTarget,
  type LevelReport,
} from "../src/server/integrity/data-integrity";
import { compareWithSnapshot, type ComparisonFinding, type IntegrityComparison } from "../src/server/integrity/data-integrity-compare";

export interface DataIntegrityCliOptions {
  json: boolean;
  snapshot: string | null;
  compare: string | null;
  allowRemoved: string[];
  help: boolean;
}

/** A bad command line, or a target or file that cannot be used: reported, then exit code 2. */
export class DataIntegrityUsageError extends Error {}

export interface DataIntegrityIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export function formatDataIntegrityHelp() {
  return [
    "Data integrity: a per-level report of the bid data, and a row-level before/after compare",
    "",
    "Usage:",
    "  tsx scripts/data-integrity.ts                                  the report, one column per level",
    "  tsx scripts/data-integrity.ts --json                           the same, as JSON",
    "  tsx scripts/data-integrity.ts --snapshot <file>                the report, and a snapshot of every bid written to <file>",
    "  tsx scripts/data-integrity.ts --compare <file>                 the data now against that snapshot",
    "  tsx scripts/data-integrity.ts --compare <file> --allow-removed <regex> [--allow-removed <regex> ...]",
    "",
    "Before and after every migration, deploy or data fix: take a snapshot, make the change, compare. The compare exits 1 on",
    "any unexplained removal, visibility regression or rise in identity mismatches, so it is the proof that state, county",
    "and city data were neither lost, hidden nor mis-typed.",
    "",
    "Options:",
    "  --json                   Print machine-readable output; stdout is the JSON document only: { target, mode, report } for a report,",
    "                           { ..., snapshot: { file, bids, bytes } } when a snapshot was written, { target, mode: \"compare\", comparison,",
    "                           report, snapshot? } for a compare.",
    "  --snapshot <file>        Write a snapshot: the report plus, for every bid, a sha256 of all its columns, its level, whether",
    "                           search shows it, whether it is open, and the columns that explain a change (issuer_type,",
    "                           jurisdiction_level, fips_code, lifecycle_status, is_active, display_status, issuer_name, title,",
    "                           deadline_date, source_bid_id). One line of JSON, a few hundred bytes per bid.",
    "                           The script will not overwrite a file that is there: use a new name, or remove the old one yourself.",
    "  --compare <file>         Compare the data now with a snapshot. May be combined with --snapshot, which then writes the",
    "                           state just read as the next baseline.",
    "  --allow-removed <regex>  With --compare: a removed bid whose id matches is explained (a planned purge or re-key). The option",
    "                           is repeatable; there are none by default. The pattern is unanchored, so it matches anywhere in the",
    "                           id: write ^...$ to match a whole id.",
    "  --help                   Print this help.",
    "",
    "The compare FAILS (exit 1) when",
    "  - a bid was removed and no --allow-removed pattern matches its id;",
    "  - a bid that was open and shown by search is still open and is no longer shown (a visibility regression);",
    "  - the identityMismatch of a level went up.",
    "It warns, and still exits 0, when a bid went from open to closed without a closed_reason of deadline_passed or delisted",
    "(an award is a reason of its own), when the dialect changed, or when a schema change limits what can be compared. It also",
    "reports the bids added, the bids changed grouped by what changed (e.g. issuer_type state→city: 11), the bids whose only",
    "change is outside the tracked columns, and every metric that moved.",
    "",
    "Levels: a bid's issuer_type when that is state, county, city, township, special_district or federal, otherwise other.",
    "Metrics, per level:",
    "  total, open, closed, awarded         by lifecycle (is_active is read when lifecycle_status is blank)",
    "  openVisible, openHidden              open bids search shows / does not show: display_status is not suppressed, the",
    "                                       publication gate passes (the same isPublishableRow search uses) and is_active = 1.",
    "                                       hiddenReasons lists why, most frequent first",
    "  identityMismatch                     the bid's registered source disagrees on level, state (exact) or FIPS (both set)",
    "  unregistered, demoLike               id prefix is not a data_sources.id / the demo-purge rule matches (npm run demo:prepare, db:seed)",
    "  nonCanonicalId                       id is not <source id>:<source_bid_id>",
    "  activeFlagMismatch                   is_active disagrees with lifecycle_status = open",
    "  withBody, detailLockedAtSource,      among open bids: a body worth showing / the portal locks the description to its members",
    "  bodyMissing                          (raw_payload.detail_access) / no body and not locked: genuinely missing",
    "  withIssuer, deadlineParseable,       among open bids: a real issuer name / a deadline the parser reads / a source URL",
    "  withSourceUrl",
    "  expiredOpen                          open bids whose deadline has passed",
    "  newestLastSeenAt, sourceHealth       newest last_seen_at; enabled sources, never succeeded, succeeded within 2 and 7 days, failing",
    "Globally: malformedNyIds, the legacy ny_contract_reporter:% Company:% ids that the NY re-key left behind.",
    "",
    "Target: DATABASE_URL / MYSQL_DATABASE_URL when it is a mysql:// URL, otherwise the SQLite file at DATABASE_PATH (default",
    "data/apsi.sqlite, which must exist: nothing is created). The process environment is used as it is; .env.local is not read.",
    "The target is printed to stderr as soon as it is opened.",
    "",
    "This command never writes to the database. SQLite is opened read-only (which can leave an empty -wal and a -shm file beside",
    "a WAL-mode database; the database file itself is not touched). On MySQL every read runs in one",
    "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY transaction (the server itself refuses a write), and SQLite reads in one",
    "transaction too, so the whole scan describes one moment even while a crawler writes. The scan reads every bid, a page at a time:",
    "run it against a replica, or off-hours, on a large database.",
    "",
    "Exit codes: 0 done (the compare passed), 1 a regression was found (the report is on stdout) or the run failed (the message is",
    "on stderr), 2 usage (a bad command line, a snapshot file that is missing or not a snapshot, or a SQLite database that is not there).",
  ].join("\n");
}

export function parseDataIntegrityArgs(argv: readonly string[]): DataIntegrityCliOptions {
  const options: DataIntegrityCliOptions = { json: false, snapshot: null, compare: null, allowRemoved: [], help: false };

  /** The value of `--flag value` or `--flag=value`; null when `arg` is some other flag. */
  const valueOf = (flag: string, arg: string, index: number, what: string): { value: string; consumed: number } | null => {
    if (arg === flag) {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new DataIntegrityUsageError(`${flag} requires ${what}.`);
      return { value: next, consumed: 1 };
    }
    if (arg.startsWith(`${flag}=`)) {
      const value = arg.slice(flag.length + 1);
      if (!value) throw new DataIntegrityUsageError(`${flag} requires ${what}.`);
      return { value, consumed: 0 };
    }
    return null;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      const snapshot = valueOf("--snapshot", arg, index, "a file path");
      const compare = snapshot ? null : valueOf("--compare", arg, index, "a file path");
      const allowRemoved = snapshot || compare ? null : valueOf("--allow-removed", arg, index, "a regular expression");
      const found = snapshot ?? compare ?? allowRemoved;
      if (!found) throw new DataIntegrityUsageError(`Unknown argument: ${arg}`);
      index += found.consumed;
      if (snapshot) {
        if (options.snapshot !== null) throw new DataIntegrityUsageError("--snapshot was given twice.");
        options.snapshot = snapshot.value;
      } else if (compare) {
        if (options.compare !== null) throw new DataIntegrityUsageError("--compare was given twice.");
        options.compare = compare.value;
      } else if (allowRemoved) {
        try {
          new RegExp(allowRemoved.value);
        } catch (error) {
          throw new DataIntegrityUsageError(`--allow-removed ${JSON.stringify(allowRemoved.value)} is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`);
        }
        options.allowRemoved.push(allowRemoved.value);
      }
    }
  }

  if (options.allowRemoved.length > 0 && options.compare === null) {
    throw new DataIntegrityUsageError("--allow-removed only applies with --compare: without a snapshot to compare with, nothing is removed.");
  }
  return options;
}

/* -------------------------------------------------------------------------------------------------------------- */
/* Text output                                                                                                    */
/* -------------------------------------------------------------------------------------------------------------- */

const REPORT_SECTIONS: ReadonlyArray<{ title: string; labels: readonly string[] }> = [
  { title: "Bids", labels: ["total", "open", "closed", "awarded"] },
  { title: "Search visibility, of the open bids (shown by search / not shown)", labels: ["openVisible", "openHidden"] },
  { title: "Identity and source checks, of all bids", labels: ["identityMismatch", "unregistered", "demoLike", "nonCanonicalId", "activeFlagMismatch"] },
  { title: "Completeness, of the open bids", labels: ["withBody", "detailLockedAtSource", "bodyMissing", "withIssuer", "deadlineParseable", "withSourceUrl"] },
  { title: "Lifecycle", labels: ["expiredOpen"] },
  { title: "Enabled sources", labels: ["sources", "neverSucceeded", "succeededWithin2d", "succeededWithin7d", "failing"] },
];

function cellOf(report: LevelReport, label: string): number {
  return label in report.sourceHealth ? report.sourceHealth[label as keyof LevelReport["sourceHealth"]] : (report[label as (typeof NUMERIC_LEVEL_METRICS)[number]] as number);
}

function reasonsLine(reasons: Record<string, number>): string {
  const entries = Object.entries(reasons);
  return entries.length === 0 ? "none" : entries.map(([code, count]) => `${code} ${count}`).join(", ");
}

export function formatIntegrityReport(report: IntegrityReport, target: string): string {
  const columns = [
    ...INTEGRITY_LEVELS.map((level) => ({ header: level, level: report.levels[level] })),
    { header: "total", level: report.totals },
  ];
  const labelWidth = Math.max(...REPORT_SECTIONS.flatMap((section) => section.labels.map((label) => label.length)));
  const widths = columns.map((column) =>
    Math.max(column.header.length, ...REPORT_SECTIONS.flatMap((section) => section.labels.map((label) => String(cellOf(column.level, label)).length))));
  const lines = [
    "Data integrity report",
    `Target: ${target}`,
    `Generated at: ${report.generatedAt} (${report.dialect})`,
    "",
    `${" ".repeat(2 + labelWidth)}${columns.map((column, index) => `  ${column.header.padStart(widths[index])}`).join("")}`,
  ];
  for (const section of REPORT_SECTIONS) {
    lines.push(section.title);
    for (const label of section.labels) {
      lines.push(`  ${label.padEnd(labelWidth)}${columns.map((column, index) => `  ${String(cellOf(column.level, label)).padStart(widths[index])}`).join("")}`);
    }
  }

  lines.push("", "Newest last_seen_at of any bid of the level");
  for (const level of INTEGRITY_LEVELS) {
    const newest = report.levels[level].newestLastSeenAt;
    if (newest !== null) lines.push(`  ${level.padEnd(16)}${newest}`);
  }
  lines.push("", "Why open bids are not shown (a bid can have several reasons)");
  for (const level of INTEGRITY_LEVELS) {
    if (report.levels[level].openHidden > 0) lines.push(`  ${level}: ${reasonsLine(report.levels[level].hiddenReasons)}`);
  }
  lines.push(`  total: ${reasonsLine(report.totals.hiddenReasons)}`);
  lines.push(
    "",
    `Legacy NY ids (ny_contract_reporter:% Company:%) still in the data: ${report.malformedNyIds}`,
    "",
    "open = lifecycle open; openVisible = open and shown by search (display_status not suppressed, publication gate passes, is_active = 1).",
    "Take a snapshot before a change: npm run data:integrity -- --snapshot <file>; after it: npm run data:integrity -- --compare <file>",
  );
  return lines.join("\n");
}

const LISTED_IDS = 20;

function idLines(ids: readonly string[] | undefined, indent: string): string[] {
  if (!ids || ids.length === 0) return [];
  const shown = ids.slice(0, LISTED_IDS).map((id) => `${indent}${id}`);
  return ids.length > LISTED_IDS ? [...shown, `${indent}... and ${ids.length - LISTED_IDS} more (--json lists them all)`] : shown;
}

function findingLines(findings: readonly ComparisonFinding[]): string[] {
  return findings.flatMap((finding) => [`  - ${finding.code}: ${finding.message}`, ...idLines(finding.ids, "      ")]);
}

function nonZeroByLevel(byLevel: Record<string, number>): string {
  const parts = INTEGRITY_LEVELS.filter((level) => byLevel[level] > 0).map((level) => `${level} ${byLevel[level]}`);
  return parts.join(", ");
}

export function formatIntegrityComparison(comparison: IntegrityComparison, target: string): string {
  const status = comparison.ok ? (comparison.warnings.length > 0 ? "OK (with warnings)" : "OK") : "REGRESSION";
  const lines = [
    `Data integrity compare: ${status}`,
    `Target: ${target}`,
    `Snapshot: taken ${comparison.before.takenAt} on ${comparison.before.dialect}, ${comparison.before.bids} bids`,
    `Now:      read ${comparison.after.takenAt} on ${comparison.after.dialect}, ${comparison.after.bids} bids`,
    "",
  ];
  if (comparison.failures.length > 0) lines.push("Failures (exit 1):", ...findingLines(comparison.failures));
  else lines.push("No unexplained removal, visibility regression or rise in identity mismatches.");
  if (comparison.warnings.length > 0) lines.push("", "Warnings:", ...findingLines(comparison.warnings));

  const removed = comparison.removed;
  const outside = comparison.changed.onlyOutsideTracked;
  lines.push(
    "",
    `Bids: added ${comparison.added.count}, removed ${removed.count}${removed.allowed.length > 0 ? ` (${removed.allowed.length} allowed)` : ""}, ` +
      `changed ${comparison.changed.count}, changed only outside the tracked columns ${outside.count ?? "unknown"}`,
  );
  if (comparison.added.count > 0) lines.push(`  added by level: ${nonZeroByLevel(comparison.added.byLevel)}`, ...idLines(comparison.added.ids, "    "));
  if (removed.count > 0) {
    lines.push(`  removed by level: ${nonZeroByLevel(removed.byLevel)}`);
    if (removed.allowed.length > 0) lines.push(`  allowed by --allow-removed: ${removed.allowed.length}`);
  }
  if (comparison.changed.groups.length > 0) {
    lines.push("", "Changed bids, by what changed:");
    for (const group of comparison.changed.groups) {
      lines.push(`  ${group.label}: ${group.count}  (e.g. ${group.sampleIds.slice(0, 3).join(", ")})`);
    }
  }
  if (outside.count !== null && outside.count > 0) lines.push("", `Changed only outside the tracked columns: ${outside.count}`, ...idLines(outside.ids, "    "));

  if (comparison.metricDeltas.length > 0) {
    const rows = comparison.metricDeltas.map((delta) => [delta.level, delta.metric, String(delta.before), String(delta.after), `${delta.delta > 0 ? "+" : ""}${delta.delta}`]);
    const widths = [0, 1, 2, 3, 4].map((column) => Math.max(...rows.map((row) => row[column].length), ["level", "metric", "before", "after", "delta"][column].length));
    const format = (row: string[]) => `  ${row[0].padEnd(widths[0])}  ${row[1].padEnd(widths[1])}  ${row[2].padStart(widths[2])}  ${row[3].padStart(widths[3])}  ${row[4].padStart(widths[4])}`;
    lines.push("", "Metrics that moved:", format(["level", "metric", "before", "after", "delta"]), ...rows.map(format));
  } else {
    lines.push("", "No metric moved.");
  }
  return lines.join("\n");
}

/* -------------------------------------------------------------------------------------------------------------- */
/* Target and files                                                                                               */
/* -------------------------------------------------------------------------------------------------------------- */

export type ResolvedTarget = { kind: "mysql"; databaseUrl: string } | { kind: "sqlite"; databasePath: string };

/** Which database the environment points at, without touching it. */
export function resolveTarget(env: NodeJS.ProcessEnv): ResolvedTarget {
  if (isMysqlDatabaseUrlConfigured(env)) return { kind: "mysql", databaseUrl: requireMysqlDatabaseUrl(env) };
  return { kind: "sqlite", databasePath: path.resolve(process.cwd(), env.DATABASE_PATH?.trim() || path.join("data", "apsi.sqlite")) };
}

export interface OpenedTarget {
  target: IntegrityTarget;
  description: string;
  close: () => Promise<void>;
}

export async function openTarget(resolved: ResolvedTarget): Promise<OpenedTarget> {
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
  // opens it read-only (and so it can neither write nor create), and the integrity tools read through that connection alone.
  if (!existsSync(resolved.databasePath)) {
    throw new DataIntegrityUsageError(
      `SQLite database not found: ${resolved.databasePath}. Nothing was created. ` +
        "Set DATABASE_PATH to the database file (the default is data/apsi.sqlite in the directory you run this from).",
    );
  }
  if (statSync(resolved.databasePath).isDirectory()) {
    throw new DataIntegrityUsageError(`DATABASE_PATH is a directory, not a SQLite file: ${resolved.databasePath}.`);
  }
  const sqlite = new Database(resolved.databasePath, { readonly: true, fileMustExist: true });
  try {
    // The wait the app gives its own connections. foreign_keys is not set: it only matters to writes.
    sqlite.pragma("busy_timeout = 5000");
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

function readBaseline(file: string): IntegritySnapshot {
  let text: string;
  try {
    text = readFileSync(path.resolve(file), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new DataIntegrityUsageError(
      code === "ENOENT" ? `Snapshot file not found: ${path.resolve(file)}. Take one first with --snapshot <file>.` : `Cannot read the snapshot file ${file}: ${(error as Error).message}`,
    );
  }
  try {
    return parseIntegritySnapshot(text);
  } catch (error) {
    if (error instanceof IntegritySnapshotError) throw new DataIntegrityUsageError(`${file}: ${error.message}`);
    throw error;
  }
}

/**
 * The message of a failed run. SQLite refuses a read-only open of a WAL-mode database whose -shm file does not exist and
 * cannot be created, and says only that it cannot write.
 */
function failureMessage(error: unknown, resolved: ResolvedTarget): string {
  const message = error instanceof Error ? error.message : String(error);
  if (resolved.kind === "sqlite" && /attempt to write a readonly database|unable to open database file/i.test(message)) {
    return `${message}\nThe SQLite file is opened read-only, and a WAL-mode database needs to create its -shm file beside it, which fails in a ` +
      "directory you cannot write to or on a read-only mount. Copy the database (and its -wal file, if there is one) to a " +
      "directory you can write to, and point DATABASE_PATH at the copy.";
  }
  return message;
}

/** Why a snapshot cannot be written to `file`, found before anything is read so that a long scan is not wasted. */
function snapshotFileProblem(file: string): string | null {
  const resolved = path.resolve(file);
  if (existsSync(resolved)) {
    return `${resolved} is there already and the script will not overwrite it: a snapshot is the baseline of a change, and losing it loses the proof. ` +
      "Use a new file name, or remove the old file yourself.";
  }
  const directory = path.dirname(resolved);
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return `The directory for --snapshot does not exist: ${directory}.`;
  return null;
}

interface WrittenSnapshot {
  file: string;
  bids: number;
  bytes: number;
}

function writeSnapshot(file: string, snapshot: IntegritySnapshot): WrittenSnapshot {
  const resolved = path.resolve(file);
  const text = serializeIntegritySnapshot(snapshot);
  try {
    // "wx": create it or fail; a file that appeared since the check is not overwritten either.
    writeFileSync(resolved, text, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new DataIntegrityUsageError(snapshotFileProblem(file) ?? `${resolved} is there already.`);
    throw error;
  }
  return { file: resolved, bids: Object.keys(snapshot.rows).length, bytes: Buffer.byteLength(text) };
}

function snapshotLine(written: WrittenSnapshot): string {
  return `Snapshot written: ${written.file} (${written.bids} bids, ${(written.bytes / 1024).toFixed(0)} KB)`;
}

/**
 * The whole command, returning its exit code (0 done, 1 regression or failure, 2 usage) instead of exiting, so it can be
 * run and tested in-process. On the MySQL runtime it ENDS the process-wide shared pool when it is done, on every path.
 */
export async function runDataIntegrity(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  io: DataIntegrityIo = { stdout: (text) => console.log(text), stderr: (text) => console.error(text) },
  clock: { now: () => Date } = { now: () => new Date() },
): Promise<number> {
  let options: DataIntegrityCliOptions;
  try {
    options = parseDataIntegrityArgs(argv);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${formatDataIntegrityHelp()}`);
    return 2;
  }
  if (options.help) {
    io.stdout(formatDataIntegrityHelp());
    return 0;
  }

  // Everything that can be wrong with the files is found before the database is opened.
  let baseline: IntegritySnapshot | null = null;
  try {
    if (options.compare !== null) baseline = readBaseline(options.compare);
    if (options.snapshot !== null) {
      const problem = snapshotFileProblem(options.snapshot);
      if (problem) throw new DataIntegrityUsageError(problem);
    }
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 2;
  }

  const resolved = resolveTarget(env);
  let opened: OpenedTarget | undefined;
  try {
    opened = await openTarget(resolved);
    // Before anything is read: a run that fails still says which database it hit. It goes to stderr, so that --json
    // leaves stdout as one JSON document.
    io.stderr(`Target: ${opened.description}`);
    const now = clock.now();
    const allowRemoved = options.allowRemoved.map((pattern) => new RegExp(pattern));

    if (baseline) {
      const { comparison, after } = await compareWithSnapshot(opened.target, baseline, { now, allowRemoved });
      const written = options.snapshot !== null ? writeSnapshot(options.snapshot, after) : null;
      io.stdout(
        options.json
          ? JSON.stringify({ target: opened.description, mode: "compare", comparison, report: after.report, ...(written ? { snapshot: written } : {}) }, null, 2)
          : [formatIntegrityComparison(comparison, opened.description), ...(written ? ["", snapshotLine(written)] : [])].join("\n"),
      );
      return comparison.ok ? 0 : 1;
    }

    if (options.snapshot !== null) {
      const snapshot = await buildIntegritySnapshot(opened.target, { now });
      const written = writeSnapshot(options.snapshot, snapshot);
      io.stdout(
        options.json
          ? JSON.stringify({ target: opened.description, mode: "snapshot", report: snapshot.report, snapshot: written }, null, 2)
          : [formatIntegrityReport(snapshot.report, opened.description), "", snapshotLine(written)].join("\n"),
      );
      return 0;
    }

    const report = await buildIntegrityReport(opened.target, { now });
    io.stdout(
      options.json
        ? JSON.stringify({ target: opened.description, mode: "report", report }, null, 2)
        : formatIntegrityReport(report, opened.description),
    );
    return 0;
  } catch (error) {
    io.stderr(failureMessage(error, resolved));
    return error instanceof DataIntegrityUsageError ? 2 : 1;
  } finally {
    await opened?.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runDataIntegrity(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
