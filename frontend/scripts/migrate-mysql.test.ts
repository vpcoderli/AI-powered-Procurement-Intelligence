import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `npm run db:mysql:migrate` runs the data migrations (re-types, re-keys and deletes legacy rows) on whichever database its
 * environment names, so like the other integrity tools it says which one before it touches anything. A MySQL that refuses it
 * (nothing listens on 127.0.0.1:1) is enough to see that: the line has to be there before the failure, with the password masked.
 * That the process still exits when MySQL refuses it is mysql-pool-exit.test.ts.
 */

const frontendDir = fileURLToPath(new URL("..", import.meta.url));
const EXIT_TIMEOUT_MS = 15_000;
const PASSWORD = "hunter2x";

interface ScriptRun {
  status: number | null;
  hung: boolean;
  stdout: string;
  stderr: string;
}

/** The script in a process of its own, its two streams read apart (no order between them is defined, so none is assumed). */
function runMigrateMysql(env: Record<string, string>): Promise<ScriptRun> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/migrate-mysql.ts"], {
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
        DATABASE_URL: "",
        MYSQL_DATABASE_URL: "",
        MYSQL_CONNECTION_LIMIT: "",
        MYSQL_MAX_IDLE: "",
        MYSQL_IDLE_TIMEOUT_MS: "",
        ...env,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => (stdout += chunk));
    child.stderr?.on("data", (chunk: string) => (stderr += chunk));
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
      resolve({ status, hung, stdout, stderr });
    });
  });
}

describe("scripts/migrate-mysql.ts", () => {
  it("names its target on stderr before it migrates, in the format of the other integrity tools, with the password masked", async () => {
    const run = await runMigrateMysql({ DATABASE_URL: `mysql://migrator:${PASSWORD}@127.0.0.1:1/apsi_target` });

    const lines = run.stderr.split("\n");
    expect(lines[0]).toBe("Target: mysql mysql://migrator:***@127.0.0.1:1/apsi_target");
    // The failure comes after it: the line is there even though the run never got as far as a migration.
    expect(run.stderr).toContain("ECONNREFUSED");
    expect(run.stderr.indexOf("Target:")).toBeLessThan(run.stderr.indexOf("ECONNREFUSED"));
    expect(run.stdout).toBe("");
    expect(run.stdout + run.stderr).not.toContain(PASSWORD);
    expect(run.hung).toBe(false);
    expect(run.status).toBe(1);
  }, EXIT_TIMEOUT_MS + 15_000);

  it("reads MYSQL_DATABASE_URL like the pool does, and names that one", async () => {
    const run = await runMigrateMysql({ MYSQL_DATABASE_URL: `mysql2://other:${PASSWORD}@127.0.0.1:1/second` });

    expect(run.stderr.split("\n")[0]).toBe("Target: mysql mysql://other:***@127.0.0.1:1/second");
    expect(run.stdout + run.stderr).not.toContain(PASSWORD);
    expect(run.status).toBe(1);
  }, EXIT_TIMEOUT_MS + 15_000);

  it("still exits 1 with its old message, and names no target, when no MySQL URL is configured", async () => {
    const run = await runMigrateMysql({});

    expect(run.stderr.trim()).toBe("DATABASE_URL or MYSQL_DATABASE_URL is required for MySQL operations.");
    expect(run.stderr).not.toContain("Target:");
    expect(run.stdout).toBe("");
    expect(run.hung).toBe(false);
    expect(run.status).toBe(1);
  }, EXIT_TIMEOUT_MS + 15_000);

  it("still exits 1 with its old message for a URL that is not a MySQL one", async () => {
    const run = await runMigrateMysql({ DATABASE_URL: "postgres://user:pass@127.0.0.1:1/x" });

    expect(run.stderr.trim()).toBe("MySQL database URL must start with mysql:// or mysql2://.");
    expect(run.stdout).toBe("");
    expect(run.status).toBe(1);
  }, EXIT_TIMEOUT_MS + 15_000);
});
