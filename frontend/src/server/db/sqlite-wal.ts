/**
 * Switching a SQLite file to WAL, safely when several processes open the same brand-new file at the same moment.
 *
 * Why `busy_timeout` is not enough: changing `journal_mode` to WAL needs an exclusive lock. When two connections each hold
 * a read lock and both want to write, waiting would deadlock, so SQLite does not call the busy handler for the loser at all:
 * it answers SQLITE_BUSY ("database is locked") immediately, whatever `busy_timeout` says. That is what a fresh checkout
 * does to `<cwd>/data/apsi.sqlite`: parallel Vitest workers, `next build` page-data workers, or workers a supervisor starts
 * together all import `db/client`, which creates the file and switches it, so the losers failed the whole import.
 *
 * The switch is persistent (it is written to the file header), so the loser only has to try again a moment later: the winner
 * has switched the file by then and the pragma is a plain read.
 *
 * This module has no imports on purpose (no `db/client`, no schema), so a test can load it without opening the default
 * database that importing `db/client` opens.
 */

/** What the switch needs of a better-sqlite3 connection, and what a test double has to provide. */
export interface WalConnection {
  pragma(source: string, options?: { simple?: boolean }): unknown;
  /** better-sqlite3's flag for an in-memory or temporary database, which has no WAL and reports another mode. */
  readonly memory?: boolean;
}

export interface EnableWalOptions {
  /** How long to keep retrying once the first attempt hit lock contention. Default {@link WAL_RETRY_BUDGET_MS}. */
  budgetMs?: number;
  /** Blocks the thread for this many milliseconds. Default: {@link sleepSync}. A test passes one that advances `now` instead. */
  sleep?: (milliseconds: number) => void;
  /** The clock the budget is measured on, in milliseconds. Default `Date.now`. */
  now?: () => number;
  /** A number in [0, 1) that spreads the retries of processes that collided. Default `Math.random`. */
  random?: () => number;
}

/**
 * How long enableWalMode keeps retrying. Contention on a fresh file clears within milliseconds (the winner only has to write
 * the file header), so this is generous; a database that is really stuck still stops startup after about this long, plus
 * whatever one last attempt waits inside SQLite's own busy timeout.
 */
export const WAL_RETRY_BUDGET_MS = 8_000;

const FIRST_RETRY_DELAY_MS = 5;
const MAX_RETRY_DELAY_MS = 200;

/**
 * Whether `error` is SQLite telling the caller to try again later: SQLITE_BUSY or SQLITE_LOCKED, with or without an extended
 * suffix (SQLITE_BUSY_RECOVERY, SQLITE_BUSY_SNAPSHOT, ...), or just their messages when a wrapper dropped the code.
 */
export function isSqliteLockContention(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === "string" && /^SQLITE_(?:BUSY|LOCKED)(?:_|$)/.test(code)) return true;
  return typeof message === "string" && /\bdatabase (?:table )?is locked\b/i.test(message);
}

let sleepCell: Int32Array | undefined;

/** Blocks the calling thread for `milliseconds`. `createDatabase` is synchronous, so there is nothing to await. */
export function sleepSync(milliseconds: number): void {
  // Nothing ever writes to or notifies the cell, so the wait always runs for the full timeout.
  sleepCell ??= new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(sleepCell, 0, 0, Math.max(0, milliseconds));
}

/**
 * Puts `connection` in WAL mode, retrying for up to `budgetMs` while another process holds the lock the switch needs.
 *
 * Returns once the database reports `wal` (an in-memory or temporary database cannot, and is accepted as it is). A SQLite
 * error that is not lock contention is thrown at once. When the budget runs out the last error is thrown; if SQLite never
 * raised one but kept answering another mode, an Error naming that mode is thrown instead.
 */
export function enableWalMode(connection: WalConnection, options: EnableWalOptions = {}): void {
  const budgetMs = options.budgetMs ?? WAL_RETRY_BUDGET_MS;
  const sleep = options.sleep ?? sleepSync;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;

  const deadline = now() + budgetMs;
  let delayMs = FIRST_RETRY_DELAY_MS;
  let lastError: unknown;

  for (;;) {
    try {
      const mode = String(connection.pragma("journal_mode = WAL", { simple: true })).toLowerCase();
      if (mode === "wal" || connection.memory) return;
      lastError = new Error(`SQLite did not switch the database to WAL mode: PRAGMA journal_mode = WAL answered "${mode}".`);
    } catch (error) {
      if (!isSqliteLockContention(error)) throw error;
      lastError = error;
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) throw lastError;
    // Half to the full delay: processes that collided once must not wake up in step and collide again.
    sleep(Math.min(remainingMs, Math.round(delayMs * (0.5 + random() / 2))));
    delayMs = Math.min(delayMs * 2, MAX_RETRY_DELAY_MS);
  }
}
