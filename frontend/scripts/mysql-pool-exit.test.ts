import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * A mysql2 pool keeps its process alive for as long as it is open: for its connections and, because the
 * shared pool sets maxIdle below connectionLimit (src/server/db/mysql.ts), for an idle-connection timer that
 * runs even when no connection was ever made. A script or worker that fails without closing the shared pool
 * therefore hangs instead of exiting, and a supervisor never restarts a worker that hangs.
 *
 * Every script below reaches its MySQL step and fails there, against a MySQL that refuses connections
 * (nothing listens on 127.0.0.1:1), and must still exit on its own with a failure status. Add a script that
 * opens the shared pool to the list.
 */

const frontendDir = fileURLToPath(new URL("..", import.meta.url));
const UNREACHABLE_MYSQL_URL = "mysql://user:pass@127.0.0.1:1/none";
// A script that exits does so in well under a second; the margin only has to outlast a loaded machine.
const EXIT_TIMEOUT_MS = 15_000;

interface ScriptRun {
  status: number | null;
  hung: boolean;
  output: string;
}

/**
 * Runs a script through `node --import tsx` (one process, no wrapper to leave behind) in its own process
 * group; a script that has not exited by the deadline is reported as hung and its whole group is killed, so a
 * failing test never leaves a stuck process running.
 */
function runAgainstUnreachableMysql(args: string[], env: Record<string, string> = {}): Promise<ScriptRun> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", ...args], {
      cwd: frontendDir,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "test",
        APP_ENV: "",
        DEPLOY_ENV: "",
        VERCEL_ENV: "",
        RUNTIME_ENV: "",
        DATABASE_URL: UNREACHABLE_MYSQL_URL,
        MYSQL_DATABASE_URL: "",
        MYSQL_CONNECTION_LIMIT: "",
        MYSQL_MAX_IDLE: "",
        MYSQL_IDLE_TIMEOUT_MS: "",
        ...env,
      },
    });

    let output = "";
    child.stdout?.on("data", (chunk) => (output += chunk));
    child.stderr?.on("data", (chunk) => (output += chunk));

    let hung = false;
    const deadline = setTimeout(() => {
      hung = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, EXIT_TIMEOUT_MS);

    child.on("close", (status) => {
      clearTimeout(deadline);
      resolve({ status, hung, output });
    });
  });
}

describe("scripts that open the shared MySQL pool exit when MySQL refuses them", () => {
  let directory: string;
  let candidatesFile: string;

  beforeAll(() => {
    directory = mkdtempSync(path.join(tmpdir(), "apsi-pool-exit-"));
    candidatesFile = path.join(directory, "candidates.json");
    writeFileSync(
      candidatesFile,
      JSON.stringify([
        {
          id: "bidnet_co_pool_exit",
          label: "Pool Exit County (BidNet)",
          issuerType: "county",
          stateCode: "CO",
          baseUrl: "https://www.bidnetdirect.com/pool-exit-county/solicitations/open-bids",
          jurisdictionLevel: "county",
          jurisdictionName: "Pool Exit County",
          fipsCode: "08999",
          providerFamily: "bidnet",
          cadence: "daily",
          fetchConfig: { base_url: "https://www.bidnetdirect.com/pool-exit-county/solicitations/open-bids" },
        },
      ]),
    );
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  const cases: Array<{ name: string; args: () => string[]; env?: Record<string, string> }> = [
    // The startup migrations of the three workers run before their loop's try/finally.
    { name: "event-worker", args: () => ["scripts/event-worker.ts"], env: { EVENT_WORKER_RUN_ONCE: "1" } },
    {
      name: "notification-worker",
      args: () => ["scripts/notification-worker.ts"],
      env: { NOTIFICATION_WORKER_RUN_ONCE: "1" },
    },
    { name: "attachment-repair-worker", args: () => ["scripts/attachment-repair-worker.ts", "--once"] },
    // One-shot writers: the close used to follow the write instead of sitting in a finally.
    { name: "migrate-source-registry", args: () => ["scripts/migrate-source-registry.ts"] },
    { name: "register-sources", args: () => ["scripts/register-sources.ts", "--file", candidatesFile] },
    // Closes its own pool in a finally already; keeps this harness honest (it must see a script that does exit).
    { name: "migrate-mysql", args: () => ["scripts/migrate-mysql.ts"] },
  ];

  it.each(cases)(
    "$name",
    async ({ args, env }) => {
      const run = await runAgainstUnreachableMysql(args(), env);

      // The failure has to come from the MySQL step, or the script never held the pool and proves nothing.
      expect(run.output).toContain("ECONNREFUSED");
      expect(run.hung).toBe(false);
      expect(run.status).toBe(1);
    },
    EXIT_TIMEOUT_MS + 15_000,
  );
});

describe("crawler-worker", () => {
  // Its startup opens the default SQLite file in the working directory, so it cannot be run the way the scripts
  // above are. Pin the structure that keeps its pool from outliving a failed start instead: the shared pool is
  // resolved inside the try whose finally closes it. (A bad notification provider config throws between the two
  // otherwise, and the crashed worker then never exits.)
  it("resolves the shared pool inside the try/finally that closes it", () => {
    const source = readFileSync(path.join(frontendDir, "scripts", "crawler-worker.ts"), "utf8");
    const main = source.slice(source.indexOf("async function main()"));
    const outerTry = main.search(/^ {2}try \{$/m);
    const closesPool = main.indexOf("closeResolvedMysqlPool()");

    expect(outerTry).toBeGreaterThan(-1);
    expect(closesPool).toBeGreaterThan(outerTry);
    expect(main.slice(outerTry, closesPool)).toContain("resolveMysqlPool()");
  });
});
