/**
 * One of the processes of src/server/db/client.concurrent-open.test.ts: it opens brand-new SQLite files through
 * createDatabase at the same instant as its siblings, the way parallel Vitest workers and `next build`'s page-data workers
 * do on a fresh checkout.
 *
 *   node --import tsx scripts/fixtures/sqlite-first-open.ts <work dir> <rounds>
 *
 * One process serves every round, so loading the modules is paid once. It prints `ready` when it is loaded; then, for round
 * r = 1..rounds, it waits for the file <work dir>/go-<r> (the parent creates it once every sibling has answered the previous
 * round, which is what makes them all start together), opens the new file <work dir>/round-<r>.sqlite and prints one JSON
 * line: {"round":r,"journalMode":"wal"}, or {"round":r,"error":"<message>","code":"<SQLite code>"} when createDatabase threw.
 * The exit status is 1 if any round failed.
 *
 * Run it with DATABASE_URL set to a mysql:// URL. db/client creates its runtime `db` when it is imported, and without a MySQL
 * URL that opens <cwd>/data/apsi.sqlite, a file this fixture has no business touching.
 */
import { existsSync, writeSync } from "node:fs";
import path from "node:path";
import { createDatabase } from "../../src/server/db/client";

const [workDir, roundsArgument] = process.argv.slice(2);
const rounds = Number(roundsArgument);

if (!workDir || !Number.isInteger(rounds) || rounds < 1) {
  console.error("usage: sqlite-first-open.ts <work dir> <rounds>");
  process.exit(2);
}

const sleepCell = new Int32Array(new SharedArrayBuffer(4));

/** Waits for the start gun by polling every millisecond: a longer sleep would spread the siblings apart. */
function waitForFile(file: string): void {
  while (!existsSync(file)) Atomics.wait(sleepCell, 0, 0, 1);
}

/** One line to the parent, written straight to the descriptor so it is out before this process blocks again in waitForFile. */
function send(line: string): void {
  writeSync(1, `${line}\n`);
}

send("ready");

let failedRounds = 0;
for (let round = 1; round <= rounds; round += 1) {
  waitForFile(path.join(workDir, `go-${round}`));
  try {
    const database = createDatabase(path.join(workDir, `round-${round}.sqlite`));
    const journalMode = database.$client.pragma("journal_mode", { simple: true });
    database.$client.close();
    send(JSON.stringify({ round, journalMode }));
  } catch (error) {
    failedRounds += 1;
    const { code, message } = error as { code?: string; message?: string };
    send(JSON.stringify({ round, error: message ?? String(error), code }));
  }
}

process.exitCode = failedRounds > 0 ? 1 : 0;
