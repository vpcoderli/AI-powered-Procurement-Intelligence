import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "@/server/db/test-utils";

/**
 * `npm run risk:check` as CI runs it: a real process on a seeded database (the demo bids: a state bid in five states, none in
 * the other 45). The database is the process-wide one, `<cwd>/data/apsi.sqlite`, so the process runs in a directory of its own
 * that holds a seeded copy. What is pinned here is what a person reading the CI run gets: the exit status, the report's
 * headline and, for an INCOMPLETE report on GitHub Actions (`CI=true`), the `::warning` annotation that puts it in the check
 * summary instead of leaving it in the log.
 */

const frontendDir = fileURLToPath(new URL("..", import.meta.url));
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const ANNOTATION = "::warning title=Risk checklist INCOMPLETE::state-coverage, state-data-quality-gate";

let workingDirectory: string;

beforeAll(async () => {
  workingDirectory = mkdtempSync(path.join(tmpdir(), "apsi-risk-check-"));
  mkdirSync(path.join(workingDirectory, "data"));
  const seeded = await createTestDatabase({ seed: true });
  try {
    // Closing the last connection checkpoints the write-ahead log into the file, so the copy holds everything.
    seeded.db.$client.pragma("wal_checkpoint(TRUNCATE)");
    copyFileSync(seeded.databasePath, path.join(workingDirectory, "data", "apsi.sqlite"));
  } finally {
    await seeded.cleanup();
  }
}, 60_000);

afterAll(() => {
  rmSync(workingDirectory, { recursive: true, force: true });
});

function runRiskCheck(env: Record<string, string | undefined>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: "",
    MYSQL_DATABASE_URL: "",
    TSX_TSCONFIG_PATH: path.join(frontendDir, "tsconfig.json"),
  };
  // Nothing of the environment this test runs in may decide what the process does: a CI job sets CI, a shell may export the others.
  for (const key of ["CI", "RISK_CHECK_SEED_DATA", "NODE_ENV", "APP_ENV", "DEPLOY_ENV", "VERCEL_ENV", "RUNTIME_ENV"]) delete childEnv[key];
  for (const [key, value] of Object.entries(env)) if (value !== undefined) childEnv[key] = value;

  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", tsxLoader, path.join(frontendDir, "scripts", "risk-check.ts")], {
      cwd: workingDirectory,
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => (stdout += chunk));
    child.stderr?.on("data", (chunk: string) => (stderr += chunk));
    const deadline = setTimeout(() => child.kill("SIGKILL"), 50_000);
    child.on("close", (status) => {
      clearTimeout(deadline);
      resolve({ status, stdout, stderr });
    });
  });
}

describe("scripts/risk-check.ts on seed data", () => {
  it("exits 0 with the seed-data opt-out, headed INCOMPLETE, and on GitHub Actions puts the checks that did not run in the check summary", async () => {
    const run = await runRiskCheck({ NODE_ENV: "test", CI: "true", RISK_CHECK_SEED_DATA: "true" });

    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/^Risk checklist INCOMPLETE at \S+ \(NOT RUN: state-coverage, state-data-quality-gate\)$/m);
    expect(run.stdout).toContain("NOT RUN state-coverage: not evaluated on seed data: 5/50 required states have at least one active bid");
    expect(run.stdout.split("\n")).toContain(ANNOTATION);
    expect(run.stdout.split("\n").filter((line) => line.startsWith("::"))).toEqual([ANNOTATION]);
  }, 60_000);

  it("prints no annotation outside CI", async () => {
    const run = await runRiskCheck({ NODE_ENV: "test", RISK_CHECK_SEED_DATA: "true" });

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("Risk checklist INCOMPLETE");
    expect(run.stdout).not.toContain("::warning");
  }, 60_000);

  it("fails without the opt-out, as before, with no annotation: the step is red already", async () => {
    const run = await runRiskCheck({ NODE_ENV: "test", CI: "true" });

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("Risk checklist FAIL");
    expect(run.stdout).toContain("FAIL state-coverage: 5/50 required states have at least one active bid");
    expect(run.stdout + run.stderr).not.toContain("::warning");
  }, 60_000);

  it("fails in a production-like environment even with the opt-out, with no annotation", async () => {
    for (const environment of [{ NODE_ENV: "production" }, { NODE_ENV: "test", APP_ENV: "staging" }]) {
      const run = await runRiskCheck({ ...environment, CI: "true", RISK_CHECK_SEED_DATA: "true" });

      expect(run.status, JSON.stringify(environment)).toBe(1);
      expect(run.stdout, JSON.stringify(environment)).toContain("Risk checklist FAIL");
      expect(run.stdout + run.stderr).not.toContain("::warning");
    }
  }, 120_000);
});
