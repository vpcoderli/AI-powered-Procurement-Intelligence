import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

/**
 * On a fresh checkout `data/apsi.sqlite` does not exist, and every process that imports `db/client` (parallel Vitest
 * workers, `next build`'s page-data workers, workers a supervisor starts together) creates it and switches it to WAL at once.
 * SQLite answers the losers SQLITE_BUSY immediately, whatever `busy_timeout` says, and the whole import used to fail with
 * "database is locked". `createDatabase` now retries the switch (src/server/db/sqlite-wal.ts).
 *
 * This starts real processes (scripts/fixtures/sqlite-first-open.ts), has them all call createDatabase on the same new file
 * at the same instant, and expects every one to come back in WAL mode. It asserts success only: whether a given round
 * actually collides is up to the scheduler, but before the retry about half the rounds of ten processes lost somebody.
 */

const frontendDir = fileURLToPath(new URL("../../..", import.meta.url));
const fixture = path.join(frontendDir, "scripts", "fixtures", "sqlite-first-open.ts");
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

const PROCESSES = 10;
/** Rounds are cheap (the processes stay up between them), so there are enough of them to catch a collision every time. */
const ROUNDS = 15;
/** The whole cohort normally finishes in a few seconds; this only has to outlast a loaded machine. */
const COHORT_TIMEOUT_MS = 60_000;
/** db/client opens a runtime database when it is imported; a MySQL URL makes that a guard object, so no default file is opened. */
const MYSQL_URL_THAT_IS_NEVER_CONNECTED = "mysql://user:pass@127.0.0.1:1/none";

interface Member {
  child: ChildProcess;
  /** Complete stdout lines: `ready`, then one JSON line per round. */
  lines: string[];
  stderr: string;
  exit: { code: number | null; signal: NodeJS.Signals | null } | null;
}

class Cohort {
  readonly members: Member[] = [];
  private readonly watchers = new Set<() => void>();
  private readonly deadline = Date.now() + COHORT_TIMEOUT_MS;

  constructor(workDir: string, size: number, rounds: number) {
    for (let index = 0; index < size; index += 1) {
      const child = spawn(process.execPath, ["--import", tsxLoader, fixture, workDir, String(rounds)], {
        cwd: frontendDir,
        env: { ...process.env, NODE_ENV: "test", DATABASE_URL: MYSQL_URL_THAT_IS_NEVER_CONNECTED, MYSQL_DATABASE_URL: "" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const member: Member = { child, lines: [], stderr: "", exit: null };
      let partialLine = "";
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        const pieces = (partialLine + chunk).split("\n");
        partialLine = pieces.pop() ?? "";
        member.lines.push(...pieces);
        this.notify();
      });
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        member.stderr += chunk;
      });
      child.on("error", (error) => {
        // A process that could not be started never reports an exit, so count it as one rather than wait out the deadline.
        member.stderr += `${error.message}\n`;
        member.exit ??= { code: null, signal: null };
        this.notify();
      });
      child.on("close", (code, signal) => {
        member.exit = { code, signal };
        this.notify();
      });
      this.members.push(member);
    }
  }

  private notify() {
    for (const watcher of [...this.watchers]) watcher();
  }

  /** Resolves once `condition` holds, rejects (naming what was awaited) when the cohort has been running too long. */
  waitUntil(what: string, condition: () => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (!condition()) return;
        clearTimeout(timer);
        this.watchers.delete(check);
        resolve();
      };
      const timer = setTimeout(() => {
        this.watchers.delete(check);
        reject(new Error(`Timed out waiting for ${what}.\n${this.describe()}`));
      }, Math.max(0, this.deadline - Date.now()));
      this.watchers.add(check);
      check();
    });
  }

  private describe() {
    return this.members
      .map((member, index) => `process ${index}: ${member.lines.length} lines, exit ${JSON.stringify(member.exit)}, stderr ${JSON.stringify(member.stderr.trim())}`)
      .join("\n");
  }

  kill() {
    for (const { child } of this.members) child.kill("SIGKILL");
  }
}

describe("createDatabase on a brand-new file", () => {
  let workDir: string | undefined;
  let cohort: Cohort | undefined;

  afterEach(() => {
    cohort?.kill();
    cohort = undefined;
    if (workDir) rmSync(workDir, { recursive: true, force: true });
    workDir = undefined;
  });

  it(
    `puts every one of ${PROCESSES} processes that create the same new databases at the same instant in WAL mode`,
    async () => {
      const directory = (workDir = mkdtempSync(path.join(tmpdir(), "apsi-first-open-")));
      const running = (cohort = new Cohort(directory, PROCESSES, ROUNDS));
      const { members } = running;

      await running.waitUntil("every process to load its modules", () => members.every((member) => member.lines.length >= 1 || member.exit !== null));
      for (let round = 1; round <= ROUNDS; round += 1) {
        // The start gun: every process is waiting for this file, so they all open the round's new database together.
        writeFileSync(path.join(directory, `go-${round}`), "");
        await running.waitUntil(`every process to answer round ${round}`, () => members.every((member) => member.lines.length > round || member.exit !== null));
      }
      await running.waitUntil("every process to exit", () => members.every((member) => member.exit !== null));

      const problems: string[] = [];
      members.forEach((member, index) => {
        if (member.exit?.code !== 0 || member.exit.signal !== null) {
          problems.push(`process ${index} exited ${JSON.stringify(member.exit)}${member.stderr.trim() ? `: ${member.stderr.trim()}` : ""}`);
        }
        if (member.lines[0] !== "ready") problems.push(`process ${index} never reported ready (first line: ${JSON.stringify(member.lines[0])})`);
        for (let round = 1; round <= ROUNDS; round += 1) {
          const line = member.lines[round];
          if (line === undefined) {
            problems.push(`process ${index} sent no answer for round ${round}`);
            continue;
          }
          try {
            const answer = JSON.parse(line) as { journalMode?: string; error?: string; code?: string };
            if (answer.journalMode !== "wal") problems.push(`process ${index}, round ${round}: ${answer.code ?? ""} ${answer.error ?? `journal_mode is ${answer.journalMode}`}`.trim());
          } catch {
            problems.push(`process ${index}, round ${round}: unreadable answer ${JSON.stringify(line)}`);
          }
        }
      });

      // The switch is persistent: a connection that opens each file afterwards finds it in WAL mode, not just the ones that made it.
      for (let round = 1; round <= ROUNDS; round += 1) {
        try {
          const reader = new Database(path.join(directory, `round-${round}.sqlite`), { readonly: true, fileMustExist: true });
          try {
            const journalMode = reader.pragma("journal_mode", { simple: true });
            if (journalMode !== "wal") problems.push(`round ${round}: the file is in journal_mode ${String(journalMode)}`);
          } finally {
            reader.close();
          }
        } catch (error) {
          problems.push(`round ${round}: the file could not be read back: ${(error as Error).message}`);
        }
      }

      expect(problems).toEqual([]);
    },
    COHORT_TIMEOUT_MS + 30_000,
  );
});
