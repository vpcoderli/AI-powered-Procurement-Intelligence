import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const frontendDir = fileURLToPath(new URL("..", import.meta.url));
const tsxBin = path.join(frontendDir, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

/**
 * The worker imports the repair service lazily inside `runLoop`, so the `--check` and wiring
 * tests below never load it (and `--check` keeps working in an image with no database). The loop
 * test drives `runLoop` against this mock instead of the real `runAttachmentRepairOnce`.
 */
vi.mock("../src/server/attachments/repair-service", () => ({
  runAttachmentRepairOnce: vi.fn(async () => ({
    runId: "run-1",
    startedAt: "2026-09-16T00:00:00.000Z",
    finishedAt: "2026-09-16T00:00:01.000Z",
    status: "success" as const,
    candidates: 0,
    verified: 0,
    repaired: 0,
    metadataFixed: 0,
    failed: 0,
    unavailable: 0,
    skipped: 0,
    bySource: [],
    byKind: {},
  })),
}));

function runWorkerCheck(env: Record<string, string | undefined>, args: string[] = ["--check"]) {
  return spawnSync(tsxBin, ["scripts/attachment-repair-worker.ts", ...args], {
    cwd: frontendDir,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
      APP_ENV: "",
      DEPLOY_ENV: "",
      VERCEL_ENV: "",
      RUNTIME_ENV: "",
      DATABASE_URL: "",
      MYSQL_DATABASE_URL: "",
      DATABASE_PATH: "",
      CRAWLER_OWNER: "",
      CRAWLER_ATTACHMENT_DIR: "",
      BROWSER_DOWNLOADER_URL: "",
      ATTACHMENT_WORKER_INTERVAL_MS: "",
      ATTACHMENT_WORKER_RUN_ONCE: "",
      ATTACHMENT_REPAIR_MAX_PER_SOURCE: "",
      ...env,
    },
  });
}

describe("attachment repair worker --check", () => {
  it("reports the resolved defaults for a local SQLite runtime", () => {
    const result = runWorkerCheck({ NODE_ENV: "development" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"ok": true');
    expect(result.stdout).toContain('"database": "sqlite"');
    // 6 h default cadence (spec section 6, decision 4).
    expect(result.stdout).toContain('"intervalMs": "21600000"');
    expect(result.stdout).toContain('"owner": "attachment_worker:<pid>"');
    expect(result.stdout).toContain('"browserDownloaderUrl": "unset"');
    expect(result.stdout).toContain(path.join("data", "attachments"));
    expect(result.stdout).toContain("attachments.mode=browser");
  });

  it("echoes explicit interval, limit, owner, archive root and sidecar URL", () => {
    const result = runWorkerCheck({
      NODE_ENV: "development",
      ATTACHMENT_WORKER_INTERVAL_MS: "900000",
      ATTACHMENT_REPAIR_MAX_PER_SOURCE: "3",
      ATTACHMENT_WORKER_RUN_ONCE: "1",
      CRAWLER_OWNER: "ops-console",
      CRAWLER_ATTACHMENT_DIR: `/srv/attachments${path.delimiter}/mnt/legacy`,
      BROWSER_DOWNLOADER_URL: "http://browser-downloader:8092",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"intervalMs": "900000"');
    expect(result.stdout).toContain('"maxPerSource": "3"');
    expect(result.stdout).toContain('"runOnce": true');
    expect(result.stdout).toContain('"owner": "ops-console"');
    // Only the first entry of the list is the write root; the rest stay read-only roots.
    expect(result.stdout).toContain('"archiveRoot": "/srv/attachments"');
    expect(result.stdout).toContain('"browserDownloaderUrl": "http://browser-downloader:8092"');
  });

  it("rejects a non-positive-integer interval", () => {
    const result = runWorkerCheck({ NODE_ENV: "development", ATTACHMENT_WORKER_INTERVAL_MS: "0" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ATTACHMENT_WORKER_INTERVAL_MS must be a positive integer");
  });

  it("rejects a non-positive-integer per-source limit", () => {
    const result = runWorkerCheck({ NODE_ENV: "development", ATTACHMENT_REPAIR_MAX_PER_SOURCE: "-2" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ATTACHMENT_REPAIR_MAX_PER_SOURCE must be a positive integer");
  });

  it("rejects a browser downloader URL that is not http(s)", () => {
    const result = runWorkerCheck({ NODE_ENV: "development", BROWSER_DOWNLOADER_URL: "ftp://downloader:8092" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("BROWSER_DOWNLOADER_URL must be an http or https URL");
  });

  it("rejects an unparseable browser downloader URL", () => {
    const result = runWorkerCheck({ NODE_ENV: "development", BROWSER_DOWNLOADER_URL: "not a url" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("BROWSER_DOWNLOADER_URL must be a valid URL");
  });

  it("blocks a production check when the database resolves to SQLite", () => {
    const result = runWorkerCheck({ NODE_ENV: "production" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must use mysql:// or mysql2:// for production and staging worker runtimes");
  });

  it("blocks a production check when DATABASE_URL resolves to SQLite even if MYSQL_DATABASE_URL is set", () => {
    const result = runWorkerCheck({
      NODE_ENV: "production",
      DATABASE_URL: "sqlite://data/prod.sqlite",
      MYSQL_DATABASE_URL: "mysql://user:pass@db.example.com:3306/winbids",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL resolves to SQLite");
  });

  it("passes a staging check backed by MySQL", () => {
    const result = runWorkerCheck({
      APP_ENV: "staging",
      DATABASE_URL: "mysql://user:pass@db.example.com:3306/winbids",
      BROWSER_DOWNLOADER_URL: "https://downloader.internal",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"database": "mysql"');
    expect(result.stdout).toContain('"strictMode": true');
  });
});

describe("attachment repair worker wiring", () => {
  const script = readFileSync(new URL("attachment-repair-worker.ts", import.meta.url), "utf8");
  const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");

  it("mirrors the crawler worker lifecycle", () => {
    expect(script).toContain("--check");
    expect(script).toContain("--once");
    expect(script).toContain("validateAttachmentWorkerEnvironment");
    expect(script).toContain("runAttachmentRepairOnce");
    expect(script).toContain("attachment_repair_completed");
    expect(script).toContain("attachment_repair_crashed");
    expect(script).toContain("captureException");
    expect(script).toContain('process.once("SIGINT", stop)');
    expect(script).toContain('process.once("SIGTERM", stop)');
    expect(script).toContain("runMigrations(db)");
    expect(script).toContain("closeResolvedMysqlPool()");
  });

  it("reads every documented environment variable", () => {
    expect(script).toContain("ATTACHMENT_WORKER_INTERVAL_MS");
    expect(script).toContain("ATTACHMENT_WORKER_RUN_ONCE");
    expect(script).toContain("ATTACHMENT_REPAIR_MAX_PER_SOURCE");
    expect(script).toContain("BROWSER_DOWNLOADER_URL");
    expect(script).toContain("CRAWLER_ATTACHMENT_DIR");
    expect(script).toContain("CRAWLER_OWNER");
  });

  it("is exposed through npm scripts and the workers health check", () => {
    expect(packageJson).toContain('"worker:attachments"');
    expect(packageJson).toContain('"worker:attachments:check"');
    expect(packageJson).toContain('"attachments:repair:once"');
    expect(packageJson).toContain("npm run worker:attachments:check");
  });
});

describe("attachment repair worker loop", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
    vi.clearAllMocks();
  });

  it("runs a single pass and forwards the resolved options", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "attachment-worker-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    const previous = { ...process.env };
    cleanups.push(() => {
      process.env = previous;
    });

    // Object.assign rather than field assignment: `process.env.NODE_ENV` is typed readonly.
    Object.assign(process.env, {
      NODE_ENV: "test",
      DATABASE_URL: "",
      MYSQL_DATABASE_URL: "",
      DATABASE_PATH: path.join(dir, "worker.sqlite"),
      ATTACHMENT_WORKER_RUN_ONCE: "1",
      ATTACHMENT_REPAIR_MAX_PER_SOURCE: "3",
      CRAWLER_OWNER: "test-owner",
      BROWSER_DOWNLOADER_URL: "http://127.0.0.1:8092",
    });

    const { runAttachmentRepairOnce } = await import("../src/server/attachments/repair-service");
    const { runLoop } = await import("./attachment-repair-worker");

    await runLoop();

    expect(runAttachmentRepairOnce).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runAttachmentRepairOnce).mock.calls[0]?.[0]).toMatchObject({
      owner: "test-owner",
      maxPerSource: 3,
      browserDownloaderUrl: "http://127.0.0.1:8092",
    });
  });
});
