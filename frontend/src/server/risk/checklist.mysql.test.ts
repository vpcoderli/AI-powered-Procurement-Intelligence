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

/** The pool the MySQL checklist reads `data_sources` through; no rows, so each source keeps its registry governance. */
const pool = {
  query: async (sql: string) => {
    if (sql.includes("FROM data_sources")) return [[], undefined] as [unknown[], unknown?];
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

function serveBids(bids: Bid[]) {
  vi.mocked(listBidsFromMysql).mockResolvedValue(bids);
  vi.mocked(getBidByIdFromMysql).mockImplementation(async (_mysql, id) => bids.find((bid) => bid.id === id));
}

function checkOf(report: RiskChecklistReport, id: string) {
  const found = report.checks.find((entry) => entry.id === id);
  if (!found) throw new Error(`the report has no ${id} check`);
  return found;
}

beforeEach(() => {
  vi.stubEnv("RISK_CHECK_SEED_DATA", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("risk checklist on MySQL with seed data", () => {
  // The MySQL report is the same list less the state data quality gate, which only the SQLite report builds.
  const MYSQL_CHECK_IDS = RISK_CHECK_IDS.filter((id) => id !== "state-data-quality-gate");

  it("reports state coverage as NOT RUN, never PASS, with the real numbers, when the run says it is on seed data", async () => {
    serveBids(seedLikeBids);

    const report = await createRiskChecklistReportFromMysql(pool as never, NOW, { seedData: true });

    expect(report.checks.map((entry) => entry.id)).toEqual(MYSQL_CHECK_IDS);
    expect(checkOf(report, "state-coverage")).toMatchObject({ status: "not_run", ok: false });
    expect(checkOf(report, "state-coverage").summary).toBe(
      "not evaluated on seed data: 5/50 required states have at least one active bid",
    );
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
