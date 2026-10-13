import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_BIDS } from "@/lib/mock-data";
import { riskChecklistOutcome } from "@/lib/risk-check-status";
import { STATE_CRAWLER_SOURCES } from "@/lib/state-crawler-sources";
import type { Bid } from "@/server/bids/domain";
import { getBidByIdFromMysql, listBidsFromMysql } from "@/server/bids/repository";
import { toServerBidFixture } from "@/server/bids/test-fixtures";
import {
  assertRiskChecklistReport,
  createRiskChecklistReportFromMysql,
  formatRiskChecklistReport,
  RISK_CHECK_IDS,
  type RiskChecklistReport,
} from "./checklist";

// The seed-data opt-out of the 50-state coverage check has to behave the same on the MySQL path as on SQLite's
// (checklist.test.ts). The bids come from a stubbed repository; the query that filters them and the checklist are the
// real ones, and the pool answers only the governance query.
vi.mock("@/server/bids/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/bids/repository")>()),
  listBidsFromMysql: vi.fn(),
  getBidByIdFromMysql: vi.fn(),
}));

const NOW = new Date("2026-05-31T00:00:00.000Z");

/**
 * The state codes the `bids` table holds a row for, whatever the row: what the pool answers the seed-data opt-out's
 * `SELECT DISTINCT state_code FROM bids` with. `serveBids` sets it.
 */
let bidRowStates: string[] = [];

/**
 * The pool the MySQL checklist reads through: `data_sources` with no rows, so each source keeps its registry governance, and,
 * under the seed-data opt-out only, the distinct state codes of the `bids` table.
 */
const pool = {
  query: async (sql: string) => {
    if (sql.includes("FROM data_sources")) return [[], undefined] as [unknown[], unknown?];
    if (sql.includes("DISTINCT state_code") && sql.includes("FROM bids")) {
      return [bidRowStates.map((stateCode) => ({ stateCode })), undefined] as [unknown[], unknown?];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  },
};

function stateBid(source: (typeof STATE_CRAWLER_SOURCES)[number]): Bid {
  return {
    ...toServerBidFixture(MOCK_BIDS[0]),
    id: `${source.id}:risk-check-mysql`,
    source: source.label,
    issuerName: source.label,
    issuerType: "state",
    stateCode: source.stateCode,
    sourceUrl: source.baseUrl,
    attachments: [],
    isActive: true,
  };
}

/** What CI's seed holds: a bid in each of five states. */
const SEED_STATES = ["CA", "FL", "IL", "NY", "TX"];
const seedLikeBids = STATE_CRAWLER_SOURCES.filter((source) => SEED_STATES.includes(source.stateCode)).map(stateBid);
const everyStateBids = STATE_CRAWLER_SOURCES.map(stateBid);

/**
 * What the repository lists (inactive bids included: the query filters them), and which states the table has a row for:
 * by default the states of the listed bids, plus any `hiddenRowStates` for rows the listing never returns.
 */
function serveBids(bids: Bid[], hiddenRowStates: string[] = []) {
  vi.mocked(listBidsFromMysql).mockResolvedValue(bids);
  vi.mocked(getBidByIdFromMysql).mockImplementation(async (_mysql, id) => bids.find((bid) => bid.id === id));
  bidRowStates = [...bids.map((bid) => bid.stateCode), ...hiddenRowStates];
}

function checkOf(report: RiskChecklistReport, id: string) {
  const found = report.checks.find((entry) => entry.id === id);
  if (!found) throw new Error(`the report has no ${id} check`);
  return found;
}

// What decides whether the opt-out is honoured: RISK_CHECK_SEED_DATA, and the variables a deployed environment sets (any of
// NODE_ENV, APP_ENV, DEPLOY_ENV, VERCEL_ENV or RUNTIME_ENV naming production or staging refuses it). A shell, or a CI job, that
// exports one of them must not change what a test that does not mean to set it expects, so every test starts from a neutral
// environment: the opt-out off, NODE_ENV as vitest sets it, the others blank. A loop that varies one of them goes back to
// it with these, not with vi.unstubAllEnvs(), which would restore whatever the shell exported.
function blankDeploymentEnvironment() {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["APP_ENV", "DEPLOY_ENV", "VERCEL_ENV", "RUNTIME_ENV"]) vi.stubEnv(key, "");
}

function resetRiskCheckEnvironment() {
  blankDeploymentEnvironment();
  vi.stubEnv("RISK_CHECK_SEED_DATA", "");
}

beforeEach(() => {
  resetRiskCheckEnvironment();
  bidRowStates = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const counts = (active: number, withRows: number, noRows: number) =>
  `${active}/50 required states have at least one active bid; with bid rows but no active state-level bid: ${withRows}; with no bid rows at all: ${noRows}`;

describe("risk checklist on MySQL with seed data", () => {
  // The MySQL report is the same list less the state data quality gate, which only the SQLite report builds.
  const MYSQL_CHECK_IDS = RISK_CHECK_IDS.filter((id) => id !== "state-data-quality-gate");

  it("reports state coverage as NOT RUN, never PASS, with the real numbers, when the run says it is on seed data", async () => {
    serveBids(seedLikeBids);

    const report = await createRiskChecklistReportFromMysql(pool as never, NOW, { seedData: true });

    expect(report.checks.map((entry) => entry.id)).toEqual(MYSQL_CHECK_IDS);
    expect(checkOf(report, "state-coverage")).toMatchObject({ status: "not_run", ok: false });
    expect(checkOf(report, "state-coverage").summary).toBe(`not evaluated on seed data: ${counts(5, 0, 45)}`);
    expect((checkOf(report, "state-coverage").details ?? []).filter((detail) => detail.startsWith("missing state "))).toHaveLength(45);
    for (const entry of report.checks.filter((candidate) => candidate.id !== "state-coverage")) {
      expect(entry, entry.id).toMatchObject({ ok: true, status: "pass" });
    }
    expect(report.ok).toBe(false);
    expect(riskChecklistOutcome(report)).toBe("incomplete");
    expect(() => assertRiskChecklistReport(report)).not.toThrow();
    const text = formatRiskChecklistReport(report);
    expect(text).toContain("(NOT RUN: state-coverage)");
    expect(text).toContain("NOT RUN state-coverage: not evaluated on seed data: 5/50 required states have at least one active bid");
    expect(text).not.toContain("PASS state-coverage");
  });

  it("fails the same data without the opt-out, as before", async () => {
    serveBids(seedLikeBids);

    const report = await createRiskChecklistReportFromMysql(pool as never, NOW);

    expect(checkOf(report, "state-coverage")).toMatchObject({ status: "fail", ok: false, summary: "5/50 required states have at least one active bid" });
    expect(riskChecklistOutcome(report)).toBe("fail");
    expect(() => assertRiskChecklistReport(report)).toThrow(/FAIL state-coverage/);
    expect(formatRiskChecklistReport(report)).not.toContain("NOT RUN");
  });

  it("takes the opt-out from RISK_CHECK_SEED_DATA=true too, and the option beats the variable", async () => {
    serveBids(seedLikeBids);
    vi.stubEnv("RISK_CHECK_SEED_DATA", "true");

    expect(checkOf(await createRiskChecklistReportFromMysql(pool as never, NOW), "state-coverage").status).toBe("not_run");
    expect(checkOf(await createRiskChecklistReportFromMysql(pool as never, NOW, { seedData: false }), "state-coverage").status).toBe("fail");

    vi.stubEnv("RISK_CHECK_SEED_DATA", "1");
    expect(checkOf(await createRiskChecklistReportFromMysql(pool as never, NOW), "state-coverage").status).toBe("fail");
  });

  it("ignores the opt-out in production, whichever way it was given: all 50 states are required there", async () => {
    serveBids(seedLikeBids);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RISK_CHECK_SEED_DATA", "true");

    for (const options of [{}, { seedData: true }]) {
      const report = await createRiskChecklistReportFromMysql(pool as never, NOW, options);

      expect(checkOf(report, "state-coverage"), JSON.stringify(options)).toMatchObject({ status: "fail", ok: false });
      expect(riskChecklistOutcome(report)).toBe("fail");
      expect(() => assertRiskChecklistReport(report)).toThrow(/FAIL state-coverage/);
      expect(formatRiskChecklistReport(report)).not.toContain("NOT RUN");
    }
  });

  it("passes full 50-state coverage with or without the opt-out", async () => {
    serveBids(everyStateBids);

    for (const options of [{}, { seedData: true }, { seedData: false }]) {
      const report = await createRiskChecklistReportFromMysql(pool as never, NOW, options);

      expect(checkOf(report, "state-coverage"), JSON.stringify(options)).toMatchObject({
        status: "pass",
        ok: true,
        summary: "50/50 required states have at least one active bid",
      });
      expect(report.ok).toBe(true);
      expect(riskChecklistOutcome(report)).toBe("pass");
      expect(formatRiskChecklistReport(report)).toContain("Risk checklist PASS");
      expect(formatRiskChecklistReport(report)).not.toContain("NOT RUN");
    }
  });

  it("does not excuse another failing check", async () => {
    serveBids(seedLikeBids.map((bid, index) => (index === 0 ? { ...bid, sourceUrl: "https://sam.gov/opp/12345" } : bid)));

    const report = await createRiskChecklistReportFromMysql(pool as never, NOW, { seedData: true });

    expect(checkOf(report, "state-coverage").status).toBe("not_run");
    expect(checkOf(report, "state-url-validity")).toMatchObject({ status: "fail", ok: false });
    expect(riskChecklistOutcome(report)).toBe("fail");
    expect(() => assertRiskChecklistReport(report)).toThrow(/FAIL state-url-validity/);
  });
});

// The same floor as on SQLite (checklist.test.ts): the opt-out sets aside only a state with no bid rows of any kind, which the
// table's distinct state codes say; a state whose rows are there while none is an active state-level bid fails, and so does a
// database in which no required state has an active bid at all. Nothing names a state in the code under test.
describe("risk checklist on MySQL with seed data: the opt-out has a floor", () => {
  const inactive = (bid: Bid): Bid => ({ ...bid, isActive: false });

  it("fails a database in which no required state has an active state-level bid: an empty one is not an unknown", async () => {
    serveBids([]);

    const report = await createRiskChecklistReportFromMysql(pool as never, NOW, { seedData: true });

    expect(checkOf(report, "state-coverage")).toMatchObject({ status: "fail", ok: false, summary: counts(0, 0, 50) });
    expect((checkOf(report, "state-coverage").details ?? [])[0]).toMatch(/no required state has an active state-level bid/);
    expect(riskChecklistOutcome(report)).toBe("fail");
    expect(() => assertRiskChecklistReport(report)).toThrow(/FAIL state-coverage/);
  });

  it("fails the seed once every bid of it is inactive: the rows are there, and none is active", async () => {
    serveBids(seedLikeBids.map(inactive));

    const report = await createRiskChecklistReportFromMysql(pool as never, NOW, { seedData: true });

    expect(checkOf(report, "state-coverage")).toMatchObject({ status: "fail", ok: false, summary: counts(0, 5, 45) });
    expect((checkOf(report, "state-coverage").details ?? [])[0]).toMatch(/no required state has an active state-level bid/);
    expect(riskChecklistOutcome(report)).toBe("fail");
    expect(() => assertRiskChecklistReport(report)).toThrow(/FAIL state-coverage/);
  });

  it("fails a state that has bid rows but no active state-level bid, leaves the states with no rows at all NOT RUN, and counts each class", async () => {
    serveBids(seedLikeBids.map((bid, index) => (index === 0 ? inactive(bid) : bid)));

    const report = await createRiskChecklistReportFromMysql(pool as never, NOW, { seedData: true });

    const coverage = checkOf(report, "state-coverage");
    const failing = seedLikeBids[0].stateCode;
    expect(coverage).toMatchObject({ status: "fail", ok: false, summary: counts(4, 1, 45) });
    expect((coverage.details ?? [])[0]).toBe(`missing state ${failing} (has bid rows, none an active state-level bid)`);
    expect((coverage.details ?? []).filter((detail) => detail.endsWith("(no bid rows at all)"))).toHaveLength(45);
    expect(riskChecklistOutcome(report)).toBe("fail");
    expect(() => assertRiskChecklistReport(report)).toThrow(/FAIL state-coverage/);
  });

  it("counts a row the listing never returns, such as a suppressed one, as bid data present", async () => {
    serveBids(seedLikeBids, ["WY"]);

    const report = await createRiskChecklistReportFromMysql(pool as never, NOW, { seedData: true });

    expect(checkOf(report, "state-coverage")).toMatchObject({ status: "fail", summary: counts(5, 1, 44) });
    expect(checkOf(report, "state-coverage").details).toContain("missing state WY (has bid rows, none an active state-level bid)");
  });

  it("keeps the states with no rows at all NOT RUN, which is what CI's seed is, and exits clean", async () => {
    serveBids(seedLikeBids);

    const report = await createRiskChecklistReportFromMysql(pool as never, NOW, { seedData: true });

    expect(checkOf(report, "state-coverage")).toMatchObject({ status: "not_run", summary: `not evaluated on seed data: ${counts(5, 0, 45)}` });
    expect(() => assertRiskChecklistReport(report)).not.toThrow();
  });

  it("does not read the table's rows without the opt-out: the query is only for a run that sets states aside", async () => {
    serveBids(seedLikeBids);
    const asked: string[] = [];
    const spyingPool = { query: async (sql: string) => { asked.push(sql); return pool.query(sql); } };

    await createRiskChecklistReportFromMysql(spyingPool as never, NOW);

    expect(asked.some((sql) => sql.includes("DISTINCT state_code"))).toBe(false);
  });

  it("refuses the opt-out in a production-like environment, whatever variable says so", async () => {
    serveBids(seedLikeBids);
    vi.stubEnv("RISK_CHECK_SEED_DATA", "true");

    for (const [key, value] of [["NODE_ENV", "production"], ["APP_ENV", "staging"], ["DEPLOY_ENV", "prod"], ["VERCEL_ENV", "production"], ["RUNTIME_ENV", " Staging "]]) {
      vi.stubEnv(key, value);
      for (const options of [{}, { seedData: true }]) {
        const report = await createRiskChecklistReportFromMysql(pool as never, NOW, options);

        expect(checkOf(report, "state-coverage"), `${key}=${value}`).toMatchObject({ status: "fail", summary: "5/50 required states have at least one active bid" });
        expect(() => assertRiskChecklistReport(report)).toThrow(/FAIL state-coverage/);
      }
      // Back to neutral for the next variable, with the opt-out still on.
      blankDeploymentEnvironment();
    }
  });
});
