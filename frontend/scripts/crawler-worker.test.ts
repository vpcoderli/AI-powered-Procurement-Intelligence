import { afterEach, describe, expect, it, vi } from "vitest";

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
});
