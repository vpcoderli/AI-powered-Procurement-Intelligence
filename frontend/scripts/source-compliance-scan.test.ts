import { describe, expect, it, vi } from "vitest";
import type { SourceComplianceInput, SourceComplianceReport } from "../src/server/source-validity/robots-compliance-scan";
import {
  formatSourceComplianceScanHelp,
  loadComplianceSources,
  parseSourceComplianceScanArgs,
  persistSourceComplianceSnapshot,
  selectComplianceSources,
} from "./source-compliance-scan";

const NOW = "2026-09-16T10:00:00.000Z";

/** Real-shaped environments: NODE_ENV and friends come from the process, the URL is ours. */
function noMysqlEnv(): NodeJS.ProcessEnv {
  return { ...process.env, DATABASE_URL: undefined, MYSQL_DATABASE_URL: undefined };
}

function mysqlEnv(): NodeJS.ProcessEnv {
  return { ...process.env, DATABASE_URL: "mysql://user:pw@localhost:3306/apsi" };
}

const SOURCES: SourceComplianceInput[] = [
  { id: "bidnet_ny_erie", stateCode: "NY", label: "Erie County, NY (BidNet)", baseUrl: "https://x/erie" },
  { id: "bidnet_oh_city_columbus", stateCode: "OH", label: "Columbus, OH (BidNet)", baseUrl: "https://x/columbus" },
];

const REPORT: SourceComplianceReport = {
  ok: true,
  checkedAt: NOW,
  summary: { total: 1, clear: 1, flagged: 0, unreachable: 0 },
  results: [],
};

describe("parseSourceComplianceScanArgs", () => {
  it("defaults to the runtime data_sources registry", () => {
    expect(parseSourceComplianceScanArgs(["--all"])).toMatchObject({ registry: "data-sources", sourceFilters: [] });
  });

  it("switches to the state definition registry on request", () => {
    expect(parseSourceComplianceScanArgs(["--state-definitions", "--all"]).registry).toBe("state-definitions");
    expect(parseSourceComplianceScanArgs(["--state-definitions", "--data-sources"]).registry).toBe("data-sources");
  });

  it("still parses source filters, timeout and output flags", () => {
    expect(parseSourceComplianceScanArgs(["--source", "NY", "--source=bidnet_ny_erie", "--timeout-ms", "2000", "--json", "--persist", "--report-only"])).toMatchObject({
      sourceFilters: ["NY", "bidnet_ny_erie"],
      timeoutMs: 2_000,
      json: true,
      persist: true,
      reportOnly: true,
    });
    expect(() => parseSourceComplianceScanArgs(["--timeout-ms", "10"])).toThrow(/between 1000 and 60000/);
    expect(() => parseSourceComplianceScanArgs(["--nope"])).toThrow(/Unknown argument/);
  });

  it("documents the county/city coverage in its help text", () => {
    expect(formatSourceComplianceScanHelp()).toContain("county and city included");
    expect(formatSourceComplianceScanHelp()).toContain("--state-definitions");
  });
});

describe("selectComplianceSources", () => {
  it("returns everything without filters and matches ids or state codes", () => {
    expect(selectComplianceSources(SOURCES, [])).toEqual(SOURCES);
    expect(selectComplianceSources(SOURCES, ["oh"]).map((source) => source.id)).toEqual(["bidnet_oh_city_columbus"]);
    expect(selectComplianceSources(SOURCES, ["bidnet_ny_erie"]).map((source) => source.id)).toEqual(["bidnet_ny_erie"]);
  });

  it("rejects unknown filters", () => {
    expect(() => selectComplianceSources(SOURCES, ["ZZ"])).toThrow(/Unknown source filter\(s\): ZZ/);
  });
});

describe("loadComplianceSources", () => {
  it("reads data_sources through SQLite and applies filters", async () => {
    const db = { $client: { close: vi.fn() } };
    const listSqliteSources = vi.fn(() => SOURCES);

    const sources = await loadComplianceSources("data-sources", ["OH"], noMysqlEnv(), {
      createSqliteDatabase: () => db as never,
      runSqliteMigrations: vi.fn(),
      listSqliteSources: listSqliteSources as never,
    });

    expect(sources.map((source) => source.id)).toEqual(["bidnet_oh_city_columbus"]);
    expect(db.$client.close).toHaveBeenCalled();
  });

  it("reads data_sources through MySQL and always closes the pool", async () => {
    const end = vi.fn(async () => {});
    const listMysqlSources = vi.fn(async () => SOURCES);

    const sources = await loadComplianceSources(
      "data-sources",
      [],
      mysqlEnv(),
      { createMysqlPoolForUrl: () => ({ end }) as never, listMysqlSources: listMysqlSources as never },
    );

    expect(sources).toHaveLength(2);
    expect(end).toHaveBeenCalled();
  });

  it("uses the hardcoded state definitions without touching a database", async () => {
    const createSqliteDatabase = vi.fn();

    const sources = await loadComplianceSources("state-definitions", ["CA"], noMysqlEnv(), { createSqliteDatabase });

    expect(createSqliteDatabase).not.toHaveBeenCalled();
    expect(sources).toHaveLength(1);
    expect(sources[0].stateCode).toBe("CA");
  });
});

describe("persistSourceComplianceSnapshot", () => {
  it("writes the snapshot and the per-source robots columns (SQLite)", async () => {
    const db = { $client: { close: vi.fn() } };
    const recordSqliteSnapshot = vi.fn();
    const applySqliteRobots = vi.fn(() => 2);

    const runtime = await persistSourceComplianceSnapshot(REPORT, noMysqlEnv(), {
      createSqliteDatabase: () => db as never,
      runSqliteMigrations: vi.fn(),
      recordSqliteSnapshot: recordSqliteSnapshot as never,
      applySqliteRobots: applySqliteRobots as never,
    });

    expect(runtime).toBe("sqlite");
    expect(recordSqliteSnapshot).toHaveBeenCalled();
    expect(applySqliteRobots).toHaveBeenCalledWith(db, REPORT);
  });

  it("writes the snapshot and the per-source robots columns (MySQL)", async () => {
    const end = vi.fn(async () => {});
    const recordMysqlSnapshot = vi.fn(async () => undefined);
    const applyMysqlRobots = vi.fn(async () => 2);

    const runtime = await persistSourceComplianceSnapshot(
      REPORT,
      mysqlEnv(),
      {
        createMysqlPoolForUrl: () => ({ end }) as never,
        recordMysqlSnapshot: recordMysqlSnapshot as never,
        applyMysqlRobots: applyMysqlRobots as never,
      },
    );

    expect(runtime).toBe("mysql");
    expect(recordMysqlSnapshot).toHaveBeenCalled();
    expect(applyMysqlRobots).toHaveBeenCalled();
    expect(end).toHaveBeenCalled();
  });

  it("skips the robots write-back for a state-definition scan", async () => {
    const db = { $client: { close: vi.fn() } };
    const applySqliteRobots = vi.fn();

    await persistSourceComplianceSnapshot(
      REPORT,
      noMysqlEnv(),
      {
        createSqliteDatabase: () => db as never,
        runSqliteMigrations: vi.fn(),
        recordSqliteSnapshot: vi.fn() as never,
        applySqliteRobots: applySqliteRobots as never,
      },
      { writeBackRobots: false },
    );

    expect(applySqliteRobots).not.toHaveBeenCalled();
  });
});
