import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDatabase } from "@/server/db/client";
import type { MysqlCrawlerLockStore } from "./lock-repository";
import type { CrawlableSource } from "./source-registry";
import type { CrawlTaskResult } from "./state-runner";
import { importCrawlerJsonRunIntoMysql, type CrawlerJsonRunPayload } from "./mysql-json-importer";
import { importCrawlerJsonRunIntoSqlite, stampJurisdiction } from "./sqlite-json-importer";
import { persistCrawlTaskResult } from "./crawl-task-persistence";
import { CrawlerLeaseLostError } from "./execution-context";

// Fully mocked (not the partial "wrap the real implementation" style configured-runner.test.ts
// uses for its containment test) — this module's own job is purely the stamp/dispatch/contain
// wiring, not bid-row upsert logic, which already has its own deep coverage in
// sqlite-json-importer.test.ts and mysql-json-importer.test.ts. Testing against spies here keeps
// this file from duplicating those assertions.
vi.mock("./mysql-json-importer", () => ({
  importCrawlerJsonRunIntoMysql: vi.fn(),
}));
vi.mock("./sqlite-json-importer", () => ({
  importCrawlerJsonRunIntoSqlite: vi.fn(),
  stampJurisdiction: vi.fn(),
}));

const mockedImportMysql = vi.mocked(importCrawlerJsonRunIntoMysql);
const mockedImportSqlite = vi.mocked(importCrawlerJsonRunIntoSqlite);
const mockedStampJurisdiction = vi.mocked(stampJurisdiction);

const NOW = "2026-07-31T00:00:00.000Z";
const database = {} as AppDatabase;
const mysql = {} as MysqlCrawlerLockStore;

function source(overrides: Partial<CrawlableSource> = {}): CrawlableSource {
  return {
    id: "src_a",
    label: "src_a",
    issuerType: "state",
    stateCode: "CA",
    baseUrl: "https://example.gov",
    cadence: "daily",
    providerFamily: null,
    jurisdictionLevel: "state",
    jurisdictionName: "California",
    fipsCode: "06",
    fetchConfig: {},
    lastSuccessAt: null,
    consecutiveFailures: 0,
    ...overrides,
  };
}

function payload(overrides: Partial<CrawlerJsonRunPayload> = {}): CrawlerJsonRunPayload {
  return {
    source: "src_a",
    runId: "run_1",
    status: "success",
    startedAt: NOW,
    bids: [{ id: "bid_1" }],
    ...overrides,
  };
}

function taskResult(overrides: Partial<CrawlTaskResult> = {}): CrawlTaskResult {
  return {
    ok: true,
    source: "src_a",
    status: "success",
    stdout: "",
    stderr: "",
    fetchedCount: 1,
    errorCode: null,
    payload: payload(),
    ...overrides,
  };
}

describe("persistCrawlTaskResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedStampJurisdiction.mockImplementation((p: CrawlerJsonRunPayload) => ({ ...p, stamped: true }) as never);
  });

  it("does nothing and returns the result unchanged when the task result has no payload", async () => {
    const result = taskResult({ payload: null });

    const returned = await persistCrawlTaskResult(database, undefined, source(), result);

    expect(returned).toBe(result);
    expect(mockedStampJurisdiction).not.toHaveBeenCalled();
    expect(mockedImportSqlite).not.toHaveBeenCalled();
    expect(mockedImportMysql).not.toHaveBeenCalled();
  });

  it("stamps jurisdiction and imports via the SQLite importer when no MySQL store is provided", async () => {
    const result = taskResult();
    const theSource = source();

    const returned = await persistCrawlTaskResult(database, undefined, theSource, result);

    expect(mockedStampJurisdiction).toHaveBeenCalledWith(result.payload, theSource);
    expect(mockedImportSqlite).toHaveBeenCalledTimes(1);
    expect(mockedImportSqlite).toHaveBeenCalledWith(database, { ...result.payload, stamped: true }, undefined);
    expect(mockedImportMysql).not.toHaveBeenCalled();
    expect(returned).toBe(result);
  });

  it("stamps jurisdiction and imports via the MySQL importer when a MySQL store is provided", async () => {
    const result = taskResult();
    const theSource = source();

    const returned = await persistCrawlTaskResult(database, mysql, theSource, result);

    expect(mockedStampJurisdiction).toHaveBeenCalledWith(result.payload, theSource);
    expect(mockedImportMysql).toHaveBeenCalledTimes(1);
    expect(mockedImportMysql).toHaveBeenCalledWith(mysql, { ...result.payload, stamped: true }, undefined);
    expect(mockedImportSqlite).not.toHaveBeenCalled();
    expect(returned).toBe(result);
  });

  it("persists a failure payload too, not just success ones", async () => {
    const result = taskResult({
      ok: false,
      status: "failure",
      errorCode: "EmptyCrawlerResultError",
      payload: payload({ status: "failure", bids: [], errorCode: "EmptyCrawlerResultError" }),
    });

    await persistCrawlTaskResult(database, undefined, source(), result);

    expect(mockedImportSqlite).toHaveBeenCalledTimes(1);
  });

  it("forwards the lease fence and reports lease loss as a failed source result", async () => {
    const lease = { source: "src_a", owner: "owner", now: () => NOW };
    mockedImportMysql.mockRejectedValueOnce(new CrawlerLeaseLostError());
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const returned = await persistCrawlTaskResult(database, mysql, source(), taskResult(), lease);
      expect(mockedImportMysql).toHaveBeenNthCalledWith(1, mysql, expect.any(Object), lease);
      expect(returned).toMatchObject({ ok: false, status: "failure", errorCode: "CrawlerLeaseLostError", payload: { status: "failure", errorCode: "CrawlerLeaseLostError" } });
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("contains a SQLite importer throw: logs crawler_json_import_failed and returns a failed result", async () => {
    const result = taskResult();
    const theSource = source({ id: "throwing_source" });
    mockedImportSqlite.mockImplementationOnce(() => {
      throw new Error("sqlite import boom");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const returned = await persistCrawlTaskResult(database, undefined, theSource, result);

    expect(returned.ok).toBe(false);
    expect(returned.status).toBe("failure");
    expect(returned.errorCode).toBe("CrawlerPersistenceError");
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [loggedPayload] = consoleErrorSpy.mock.calls[0] as [string];
    expect(JSON.parse(loggedPayload)).toMatchObject({
      event: "crawler_json_import_failed",
      source: "throwing_source",
      error: "sqlite import boom",
    });

    consoleErrorSpy.mockRestore();
  });

  it("contains a MySQL importer rejection: logs crawler_json_import_failed and returns a failed result", async () => {
    const result = taskResult();
    const theSource = source({ id: "throwing_mysql_source" });
    mockedImportMysql.mockRejectedValueOnce(new Error("mysql import boom"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const returned = await persistCrawlTaskResult(database, mysql, theSource, result);

    expect(returned.ok).toBe(false);
    expect(returned.errorCode).toBe("CrawlerPersistenceError");
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [loggedPayload] = consoleErrorSpy.mock.calls[0] as [string];
    expect(JSON.parse(loggedPayload)).toMatchObject({
      event: "crawler_json_import_failed",
      source: "throwing_mysql_source",
      error: "mysql import boom",
    });

    consoleErrorSpy.mockRestore();
  });

  // Coordinator addendum to Task X7: as committed in f83ca11, the stampJurisdiction call sat
  // outside the try/catch that contains the importer calls, so a throw from stamping (not just
  // from importing) would propagate uncaught — and neither loop that calls this function guards
  // its own call, so that throw would abort the entire batch, not just the offending source.
  // Fixed by moving the stampJurisdiction call inside the same try. This proves the containment
  // boundary now covers stamping too, using a mocked throw rather than reproducing the concrete
  // "bids is truthy but not an array" trigger (see route.test.ts's
  // "does not abort the batch when a payload's bids is present but not an array" for that exact,
  // real-stampJurisdiction, end-to-end scenario).
  it("contains a stampJurisdiction throw the same way as an importer throw: logs crawler_json_import_failed and returns a failed result", async () => {
    const result = taskResult();
    const theSource = source({ id: "throwing_stamp_source" });
    mockedStampJurisdiction.mockImplementationOnce(() => {
      throw new TypeError("payload.bids.map is not a function");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const returned = await persistCrawlTaskResult(database, undefined, theSource, result);

    expect(returned.ok).toBe(false);
    expect(returned.status).toBe("failure");
    expect(returned.errorCode).toBe("CrawlerPersistenceError");
    expect(mockedImportSqlite).toHaveBeenCalledWith(database, expect.objectContaining({ status: "failure", errorCode: "CrawlerPersistenceError", bids: [] }));
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const [loggedPayload] = consoleErrorSpy.mock.calls[0] as [string];
    expect(JSON.parse(loggedPayload)).toMatchObject({
      event: "crawler_json_import_failed",
      source: "throwing_stamp_source",
      error: "payload.bids.map is not a function",
    });

    consoleErrorSpy.mockRestore();
  });
});
