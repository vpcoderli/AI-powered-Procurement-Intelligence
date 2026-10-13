import { accessSync, constants, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  type LevelReport,
} from "../src/server/integrity/data-integrity";
import { compareWithSnapshot, type ComparisonFinding, type IntegrityComparison } from "../src/server/integrity/data-integrity-compare";
import {
  IntegrityUsageError,
  openResolvedTarget,
  resolveIntegrityTarget,
  type OpenedIntegrityTarget,
  type ResolvedTarget,
} from "../src/server/integrity/open-target";

export interface DataIntegrityCliOptions {
  json: boolean;
  snapshot: string | null;
  compare: string | null;
  allowRemoved: string[];
  help: boolean;
}

/** A bad command line, or a target or file that cannot be used: reported, then exit code 2. */
export class DataIntegrityUsageError extends IntegrityUsageError {}

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
    "any unexplained removal, visibility regression, bid closed for its deadline too early or rise in identity mismatches, so it",
    "is the proof that state, county and city data were neither lost, hidden nor mis-typed.",
    "",
    "Options:",
    "  --json                   Print machine-readable output; stdout is the JSON document only: { target, mode, report } for a report,",
    "                           { ..., snapshot: { file, bids, bytes } } when a snapshot was written, { target, mode: \"compare\", comparison,",
    "                           report, snapshot?, snapshotError? } for a compare (snapshot when the baseline written beside it was written,",
    "                           snapshotError, the reason, when it could not be). The comparison lists every id of every group; the text",
    "                           output prints the first 20 of a list.",
    "  --snapshot <file>        Write a snapshot: the report plus, for every bid, a sha256 of all its columns, its level, whether",
    "                           search shows it, whether it is open, and the columns that explain a change (issuer_type,",
    "                           jurisdiction_level, fips_code, lifecycle_status, is_active, display_status, issuer_name, title,",
    "                           deadline_date, source_bid_id), and two more sha256: u, of every other column except raw_payload,",
    "                           updated_at and last_seen_at, and p, of raw_payload without its lifecycle key. One line of JSON, a few",
    "                           hundred bytes per bid.",
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
    "  - a bid that was open is now closed with closed_reason deadline_passed, although its deadline had not passed when the data was read",
    "    (early_close; a deadline that cannot be read has not passed either);",
    "  - the identityMismatch of a level went up.",
    "It warns, and still exits 0, when a bid went from open to closed without a closed_reason of deadline_passed or delisted",
    "(an award is a reason of its own), when the dialect changed, when a schema change limits what can be compared, or when the",
    "snapshot was written before the u and p hashes existed (untracked_hashes_missing: a change outside the tracked columns on a bid",
    "that also changed a tracked column cannot then be seen). It also reports the bids added and the removed ones that --allow-removed",
    "explained (both by level, the first 20 ids of each, all of them in the JSON), the bids changed grouped by what changed (e.g.",
    "issuer_type state→city: 11, with every id of the group in the JSON), the bids whose only change is outside the tracked columns,",
    "the bids that changed outside the tracked columns (u or p changed) whether or not they also changed a tracked one, and every",
    "metric that moved. That last list is reported, not failed: read it, and check that it is the bids you meant to change.",
    "The comparison is always printed, even when the baseline written beside it (--compare with --snapshot) cannot be: that is then",
    "reported on stderr, and the exit code stays 1 if the compare failed.",
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
    "  withIssuer, deadlineParseable,       among open bids: a real issuer name (not blank, and not \"Unknown\" alone or followed by a",
    "  withSourceUrl                        space: the publication gate's rule, /^Unknown(?:\\s|$)/i, so a bid with a placeholder issuer is",
    "                                       counted out here and hidden by search) / a deadline the parser reads / a source URL",
    "  expiredOpen                          open bids whose deadline has passed",
    "  newestLastSeenAt, sourceHealth       newest last_seen_at; enabled sources, never succeeded, succeeded within 2 and 7 days, failing",
    "Globally: malformedNyIds, the number of legacy ny_contract_reporter:% Company:% ids that the NY re-key left behind (child rows or a",
    "key clash). The ids themselves are listed under the count: the first 20 in the text report, all of them in the JSON as",
    "report.malformedNyIdList.",
    "",
    "Target: DATABASE_URL / MYSQL_DATABASE_URL when it is a mysql:// URL, otherwise the SQLite file at DATABASE_PATH (default",
    "data/apsi.sqlite; a relative path is read from the frontend/ directory, whatever directory you run this from; the file must",
    "exist: nothing is created). The process environment is used as it is; .env.local is not read. The target is printed to stderr",
    "as soon as it is opened.",
    "",
    "This command never writes to the database. SQLite is opened read-only (which can leave an empty -wal and a -shm file beside",
    "a WAL-mode database; the database file itself is not touched). On MySQL every read runs in one",
    "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY transaction (the server itself refuses a write), and SQLite reads in one",
    "transaction too, so the whole scan describes one moment even while a crawler writes. The scan reads every bid, a page at a time:",
    "run it against a replica, or off-hours, on a large database.",
    "",
    "Exit codes: 0 done (the compare passed); 1 a regression was found (the report is on stdout) or the run failed (the message is on",
    "stderr); 2 usage: a bad command line, a snapshot to compare with that is missing or not a snapshot, a --snapshot file that is there",
    "already or whose directory is missing or not writable (all refused before the database is opened), or a SQLite database that is not",
    "there or is a directory. A passing --compare whose --snapshot cannot be written afterwards has printed its comparison in full; its",
    "exit code is 2 when the file appeared in the meantime, otherwise 1, and a compare that failed stays 1.",
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
    ...idLines(report.malformedNyIdList, "  "),
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

/**
 * The ids of a list, level by level in report order: `state (2)` and then its ids. At most LISTED_IDS ids are written in all
 * (a level's heading always shows how many it has); the rest are counted.
 */
function idsByLevelLines(byLevel: Readonly<Record<string, readonly string[]>>, indent: string): string[] {
  const lines: string[] = [];
  let total = 0;
  let listed = 0;
  for (const level of INTEGRITY_LEVELS) total += byLevel[level]?.length ?? 0;
  for (const level of INTEGRITY_LEVELS) {
    const ids = byLevel[level] ?? [];
    if (ids.length === 0) continue;
    lines.push(`${indent}${level} (${ids.length})`);
    for (const id of ids) {
      if (listed >= LISTED_IDS) break;
      lines.push(`${indent}  ${id}`);
      listed += 1;
    }
  }
  if (total > listed) lines.push(`${indent}... and ${total - listed} more (--json lists them all)`);
  return lines;
}

function findingLines(findings: readonly ComparisonFinding[]): string[] {
  return findings.flatMap((finding) => [
    `  - ${finding.code}: ${finding.message}`,
    ...(finding.idsByLevel ? idsByLevelLines(finding.idsByLevel, "      ") : idLines(finding.ids, "      ")),
  ]);
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
  const outsideAny = comparison.changedOutsideTracked;
  lines.push(
    "",
    `Bids: added ${comparison.added.count}, removed ${removed.count}${removed.allowed.length > 0 ? ` (${removed.allowed.length} allowed)` : ""}, ` +
      `changed ${comparison.changed.count}, changed only outside the tracked columns ${outside.count ?? "unknown"}, ` +
      `changed outside the tracked columns ${outsideAny.count ?? "unknown"}`,
  );
  // The removed bids no pattern allowed are under Failures. The ones a pattern allowed are listed here, as the others are, so
  // that a pattern that is too broad can be seen.
  if (comparison.added.count > 0) lines.push("", `Added bids (${comparison.added.count}):`, ...idsByLevelLines(comparison.added.idsByLevel, "  "));
  if (removed.allowed.length > 0) {
    lines.push("", `Removed bids allowed by --allow-removed (${removed.allowed.length}):`, ...idsByLevelLines(removed.allowedByLevel, "  "));
  }
  if (comparison.changed.groups.length > 0) {
    lines.push("", "Changed bids, by what changed:");
    for (const group of comparison.changed.groups) {
      lines.push(`  ${group.label}: ${group.count}  (e.g. ${group.sampleIds.slice(0, 3).join(", ")})`);
    }
  }
  if (outside.count !== null && outside.count > 0) lines.push("", `Changed only outside the tracked columns: ${outside.count}`, ...idLines(outside.ids, "    "));
  if (outsideAny.count !== null && outsideAny.count > 0) {
    // Each id with what changed on it: u (the columns outside the tracked ones) and/or p (the payload without its lifecycle key).
    const shown = Object.fromEntries(INTEGRITY_LEVELS.map((level) => [level, outsideAny.changesByLevel[level].map((change) => `${change.id}  ${change.changed.join(" ")}`)]));
    lines.push(
      "",
      `Changed outside the tracked columns (${outsideAny.count}), whether or not a tracked column changed too; reported, not failed (u: the other columns except raw_payload, ` +
        "updated_at and last_seen_at; p: raw_payload without its lifecycle key):",
      ...idsByLevelLines(shown, "  "),
    );
  }

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
/* Files                                                                                                          */
/* -------------------------------------------------------------------------------------------------------------- */

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
  try {
    accessSync(directory, constants.W_OK);
  } catch {
    return `The directory for --snapshot is not writable: ${directory}.`;
  }
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

type SnapshotAttempt = { written: WrittenSnapshot } | { error: unknown };

/** A write that reports its failure instead of throwing, for a run that has a comparison in hand that must not be lost. */
function tryWriteSnapshot(file: string, snapshot: IntegritySnapshot): SnapshotAttempt {
  try {
    return { written: writeSnapshot(file, snapshot) };
  } catch (error) {
    return { error };
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The JSON fields that say what became of the file: where it went, or why it did not. */
function snapshotFields(attempt: SnapshotAttempt | null): { snapshot?: WrittenSnapshot; snapshotError?: string } {
  if (attempt === null) return {};
  return "written" in attempt ? { snapshot: attempt.written } : { snapshotError: messageOf(attempt.error) };
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

  const resolved = resolveIntegrityTarget(env);
  let opened: OpenedIntegrityTarget | undefined;
  try {
    // A report only reads: the SQLite connection itself refuses a write.
    opened = await openResolvedTarget(resolved, { readonly: true });
    // Before anything is read: a run that fails still says which database it hit. It goes to stderr, so that --json
    // leaves stdout as one JSON document.
    io.stderr(`Target: ${opened.description}`);
    const now = clock.now();
    const allowRemoved = options.allowRemoved.map((pattern) => new RegExp(pattern));

    if (baseline) {
      const { comparison, after } = await compareWithSnapshot(opened.target, baseline, { now, allowRemoved });
      let attempt: SnapshotAttempt | null = null;
      if (options.json) {
        // One JSON document, so what became of the baseline is part of it; a failed write never costs the comparison.
        attempt = options.snapshot !== null ? tryWriteSnapshot(options.snapshot, after) : null;
        io.stdout(JSON.stringify({ target: opened.description, mode: "compare", comparison, report: after.report, ...snapshotFields(attempt) }, null, 2));
      } else {
        // The comparison first: whatever becomes of the file after it, it has been seen.
        io.stdout(formatIntegrityComparison(comparison, opened.description));
        attempt = options.snapshot !== null ? tryWriteSnapshot(options.snapshot, after) : null;
        if (attempt && "written" in attempt) io.stdout(snapshotLine(attempt.written));
      }
      const compared = comparison.ok ? 0 : 1;
      if (attempt && "error" in attempt) {
        io.stderr(`Snapshot not written: ${messageOf(attempt.error)}`);
        // A comparison that failed stays exit 1. A passing one is failed by the write: 2 when the file is the problem (it is
        // there), 1 for anything else.
        return compared !== 0 ? compared : attempt.error instanceof IntegrityUsageError ? 2 : 1;
      }
      return compared;
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
    return error instanceof IntegrityUsageError ? 2 : 1;
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
