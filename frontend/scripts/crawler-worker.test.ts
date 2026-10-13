import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  closeDatabase: vi.fn(),
  closePool: vi.fn(async () => {}),
  tick: vi.fn(),
  createTick: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../src/server/db/client", () => ({ createDatabase: () => ({ $client: { close: state.closeDatabase } }) }));
vi.mock("../src/server/db/migrate", () => ({ runMigrations: vi.fn() }));
vi.mock("../src/server/db/mysql", () => ({ isMysqlDatabaseUrlConfigured: () => false, resolveMysqlPool: vi.fn(), closeResolvedMysqlPool: state.closePool }));
vi.mock("../src/server/crawler/worker-tick", () => ({ createCrawlerWorkerTick: state.createTick }));
vi.mock("../src/server/notifications/provider", () => ({ createNotificationProvider: vi.fn() }));
vi.mock("../src/server/notifications/retrying-provider", () => ({ createRetryingNotificationProvider: vi.fn() }));
vi.mock("../src/lib/observability/logger", () => ({ createLogger: () => ({ info: state.info, error: state.error }) }));
vi.mock("../src/lib/observability/sentry", () => ({ captureException: vi.fn() }));

describe("crawler worker execution", () => {
  beforeEach(() => {
    // The worker starts itself when its module is imported, so each test needs a fresh import and fresh call records.
    vi.resetModules();
    vi.clearAllMocks();
  });
  const originalArgs = process.argv;
  const originalExitCode = process.exitCode;
  const originalTermListeners = process.listeners("SIGTERM");
  const originalIntListeners = process.listeners("SIGINT");
  afterEach(() => {
    process.argv = originalArgs;
    process.exitCode = originalExitCode;
    for (const listener of process.listeners("SIGTERM")) if (!originalTermListeners.includes(listener)) process.removeListener("SIGTERM", listener);
    for (const listener of process.listeners("SIGINT")) if (!originalIntListeners.includes(listener)) process.removeListener("SIGINT", listener);
    vi.unstubAllEnvs();
  });

  it("calls one complete tick, reports its stage results, and closes the database after shutdown", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("APP_ENV", "");
    vi.stubEnv("DEPLOY_ENV", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("RUNTIME_ENV", "");
    process.argv = [process.argv[0], "crawler-worker.ts"];
    const prechecks = { queued: 0, processed: [], skipped: { budget: 0, paused: 0, retry: 0 }, stoppedFamilies: [] };
    state.tick.mockImplementation(async () => {
      process.emit("SIGTERM");
      return { lists: [], prechecks, backfill: [], precheckError: null };
    });
    state.createTick.mockReturnValue(state.tick);
    await import("./crawler-worker");
    await vi.waitFor(() => expect(state.closeDatabase).toHaveBeenCalledOnce(), { timeout: 500 });
    expect(state.createTick).toHaveBeenCalledOnce();
    expect(state.tick).toHaveBeenCalledOnce();
    expect(state.info).toHaveBeenCalledWith("crawler_run_completed", { results: [] });
    expect(state.info).toHaveBeenCalledWith("crawler_precheck_queue_completed", { prechecks });
    expect(state.closePool).toHaveBeenCalledOnce();
    expect(state.error).not.toHaveBeenCalled();
  });
  /** Runs one tick of the worker with the given result, then lets SIGTERM end its loop. */
  async function runOneTick(result: Record<string, unknown>) {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("APP_ENV", "");
    vi.stubEnv("DEPLOY_ENV", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("RUNTIME_ENV", "");
    process.argv = [process.argv[0], "crawler-worker.ts"];
    state.tick.mockImplementation(async () => {
      process.emit("SIGTERM");
      return { lists: [], prechecks: null, backfill: [], precheckError: null, ...result };
    });
    state.createTick.mockReturnValue(state.tick);
    await import("./crawler-worker");
    await vi.waitFor(() => expect(state.closeDatabase).toHaveBeenCalledOnce(), { timeout: 500 });
  }

  it("logs a deadline sweep that closed bids", async () => {
    const lifecycleSweep = { scanned: 40, closed: 3, unparseable: 1, closedByIssuerType: { state: 2, county: 1 }, dryRun: false };
    await runOneTick({ lifecycleSweep });

    expect(state.info).toHaveBeenCalledWith("crawler_lifecycle_sweep", { event: "crawler_lifecycle_sweep", ...lifecycleSweep });
    expect(state.error).not.toHaveBeenCalled();
  });

  it("stays quiet about a deadline sweep that closed nothing", async () => {
    await runOneTick({ lifecycleSweep: { scanned: 40, closed: 0, unparseable: 1, closedByIssuerType: {}, dryRun: false } });

    expect(state.info.mock.calls.map(([message]) => message)).toEqual(["crawler_run_completed"]);
    expect(state.error).not.toHaveBeenCalled();
  });

  it("logs a failed deadline sweep as an error and still ends the loop normally", async () => {
    await runOneTick({ lifecycleSweepError: "bids table is locked" });

    expect(state.error).toHaveBeenCalledWith("crawler_lifecycle_sweep", { event: "crawler_lifecycle_sweep", error: "bids table is locked" });
    expect(state.info).toHaveBeenCalledWith("crawler_run_completed", { results: [] });
    expect(state.closePool).toHaveBeenCalledOnce();
  });
});
