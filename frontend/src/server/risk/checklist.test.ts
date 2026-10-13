import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { en } from "@/lib/i18n/dictionaries/en";
import { riskCheckStatus, riskChecklistOutcome } from "@/lib/risk-check-status";
import { STATE_CRAWLER_SOURCES } from "@/lib/state-crawler-sources";
import { bidAttachments, bids, dataSources } from "@/server/db/schema";
import type { AppDatabase } from "@/server/db/client";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  assertRiskChecklistReport,
  createRiskChecklistReport,
  createRiskChecklistReportFromMysql,
  formatRiskChecklistReport,
  RISK_CHECK_IDS,
  stateCoverageCheck,
  type RiskCheckId,
  type RiskChecklistReport,
} from "./checklist";

let testDb: TestDatabase | null = null;

async function seededDatabase() {
  testDb = await createTestDatabase({ seed: true });
  seedAllStateBids(testDb.db);
  return testDb.db;
}

function seedAllStateBids(db: AppDatabase) {
  const timestamp = "2026-05-31T00:00:00.000Z";

  for (const source of STATE_CRAWLER_SOURCES) {
    const id = `${source.id}:risk-check-seed`;

    db.insert(bids)
      .values({
        id,
        source: source.label,
        sourceBidId: id,
        dedupeKey: id,
        title: `${source.label} Risk Check Opportunity`,
        description: `Non-empty ${source.stateCode} procurement description for risk checks.`,
        fullDescription: `Detailed ${source.stateCode} procurement content used by the risk checklist.`,
        originalCategory: "General Procurement",
        amount: "$10,000",
        amountMin: 10000,
        amountMax: 10000,
        currency: "USD",
        publishedDate: "2026-05-01",
        deadlineDate: "2026-06-30",
        issuerName: source.label,
        issuerType: "state",
        stateCode: source.stateCode,
        contactName: "Procurement Office",
        contactEmail: "procurement@example.gov",
        contactPhone: "+1 (555) 000-0000",
        sourceUrl: source.baseUrl,
        isActive: 1,
        rawPayload: JSON.stringify({ tags: ["state", source.stateCode] }),
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoNothing()
      .run();
  }
}

function approveAllStateSourcesForProduction(db: AppDatabase) {
  db.update(dataSources)
    .set({
      approvedForIngestion: 1,
      approvalStatus: "approved",
      legalReviewStatus: "approved_public",
      accessPattern: "public_http",
    })
    .run();
}

// Whether the 50-state checks are set aside is read from RISK_CHECK_SEED_DATA, so a shell that exports it must not change
// what a test that does not mean to set it expects.
beforeEach(() => {
  vi.stubEnv("RISK_CHECK_SEED_DATA", "");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await testDb?.cleanup();
  testDb = null;
});

describe("risk checklist", () => {
  it("passes for the seeded 50-state data and account feature matrix", async () => {
    const db = await seededDatabase();

    const report = await createRiskChecklistReport(db, new Date("2026-05-31T00:00:00.000Z"));

    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => check.id)).toEqual([
      "state-coverage",
      "state-content",
      "bid-detail-routes",
      "attachment-downloads",
      "state-data-quality-gate",
      "account-tier-separation",
      "source-ingestion-governance",
      "source-validity-metadata",
      "state-url-validity",
      "global-url-validity",
    ]);
    // The admin console titles each check by an id from this list, so it has to be the ids the report is made of.
    expect(report.checks.map((check) => check.id)).toEqual([...RISK_CHECK_IDS]);
    // English prints the console's title for a check in place of the label sent here, so the two have to read alike.
    const consoleTitles = en.admin as Record<string, string>;
    for (const entry of report.checks) {
      expect(consoleTitles[`riskCheckLabel_${entry.id.replace(/-/g, "_")}`], entry.id).toBe(entry.label);
    }
    expect(formatRiskChecklistReport(report)).toContain("Risk checklist PASS");
  });

  it("fails when a state has no active bid", async () => {
    const db = await seededDatabase();
    db.update(bids).set({ displayStatus: "suppressed" }).where(eq(bids.stateCode, "WY")).run();

    const report = await createRiskChecklistReport(db);

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "state-coverage")).toMatchObject({
      ok: false,
    });
    expect(formatRiskChecklistReport(report)).toContain("missing state WY");
  });

  it("fails when crawler content is empty", async () => {
    const db = await seededDatabase();
    db.update(bids)
      .set({ description: "", fullDescription: "" })
      .where(eq(bids.id, "al_state_procurement:risk-check-seed"))
      .run();

    const report = await createRiskChecklistReport(db);

    expect(report.ok).toBe(false);
    expect(formatRiskChecklistReport(report)).toContain("has empty required content");
  });

  it("fails when a state bid source URL is a placeholder", async () => {
    const db = await seededDatabase();
    db.update(bids)
      .set({ sourceUrl: "https://sam.gov/opp/12345/sow.pdf" })
      .where(eq(bids.id, "ca_caleprocure:risk-check-seed"))
      .run();

    const report = await createRiskChecklistReport(db);

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "state-url-validity")).toMatchObject({
      ok: false,
    });
    expect(formatRiskChecklistReport(report)).toContain("placeholder_url");
  });

  it("fails when any active bid source URL is a placeholder", async () => {
    const db = await seededDatabase();
    db.update(bids)
      .set({ sourceUrl: "https://sam.gov/opp/12345" })
      .where(eq(bids.id, "1"))
      .run();

    const report = await createRiskChecklistReport(db);

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "global-url-validity")).toMatchObject({
      ok: false,
    });
    expect(formatRiskChecklistReport(report)).toContain("1: sourceUrl placeholder_url");
  });

  it("reuses state data quality reason codes for archived attachment blockers", async () => {
    const db = await seededDatabase();
    db.insert(bidAttachments)
      .values({
        id: "ca_invalid_archive",
        bidId: "ca_caleprocure:risk-check-seed",
        name: "Invalid archived attachment",
        url: "https://caleprocure.ca.gov/event/CA-2026-1/attachments/missing.pdf",
        originalUrl: "https://caleprocure.ca.gov/event/CA-2026-1/attachments/missing.pdf",
        archiveStatus: "archived",
        storagePath: "ca/missing.pdf",
        checksumSha256: null,
        createdAt: "2026-05-31T00:00:00.000Z",
      })
      .run();

    const report = await createRiskChecklistReport(db, new Date("2026-05-31T00:00:00.000Z"));

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "state-data-quality-gate")).toMatchObject({
      ok: false,
    });
    expect(formatRiskChecklistReport(report)).toContain("attachment_archive_invalid");
  });

  it("fails when an enabled source is blocked by ingestion governance", async () => {
    const db = await seededDatabase();
    db.update(dataSources)
      .set({
        approvalStatus: "blocked",
        accessPattern: "restricted",
        legalReviewStatus: "restricted",
      })
      .where(eq(dataSources.stateCode, "CA"))
      .run();

    const report = await createRiskChecklistReport(db);

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "source-ingestion-governance")).toMatchObject({
      ok: false,
    });
    expect(formatRiskChecklistReport(report)).toContain("enabled but blocked for ingestion");
  });

  it("requires explicit approval for production source ingestion checks", async () => {
    const db = await seededDatabase();

    const report = await createRiskChecklistReport(db, new Date("2026-05-31T00:00:00.000Z"), {
      requireSourceApproval: true,
    });

    expect(report.ok).toBe(false);
    expect(formatRiskChecklistReport(report)).toContain("enabled but not approved for production ingestion");
  });

  it("passes production source ingestion checks after all state sources are approved", async () => {
    const db = await seededDatabase();
    approveAllStateSourcesForProduction(db);

    const report = await createRiskChecklistReport(db, new Date("2026-05-31T00:00:00.000Z"), {
      requireSourceApproval: true,
    });

    expect(report.ok).toBe(true);
    expect(formatRiskChecklistReport(report)).toContain("Risk checklist PASS");
  });
});

describe("risk checklist MySQL source governance query", () => {
  it("selects the phase-1 jurisdiction and fetch-config columns added to data_sources", async () => {
    let capturedDataSourcesSql = "";
    const mysql = {
      query: async (sql: string) => {
        if (sql.includes("FROM data_sources")) {
          capturedDataSourcesSql = sql;
          return [[], undefined] as [unknown[], unknown?];
        }
        if (sql.includes("FROM bids")) {
          return [[], undefined] as [unknown[], unknown?];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };

    const report = await createRiskChecklistReportFromMysql(mysql as never, new Date("2026-05-31T00:00:00.000Z"));

    // The MySQL report is the same list less the state data quality gate, which only the SQLite report builds.
    expect(report.checks.map((check) => check.id)).toEqual(
      RISK_CHECK_IDS.filter((id) => id !== "state-data-quality-gate"),
    );
    // Production runs MySQL: its labels must read like the console's English titles too.
    const mysqlConsoleTitles = en.admin as Record<string, string>;
    for (const entry of report.checks) {
      expect(mysqlConsoleTitles[`riskCheckLabel_${entry.id.replace(/-/g, "_")}`], entry.id).toBe(entry.label);
    }

    // Regression guard for the phase-1 dialect-parity gap: the row mapper has always read
    // these fields, but the SELECT never listed them, so MySQL silently returned null forever.
    expect(capturedDataSourcesSql).toContain("jurisdiction_level AS jurisdictionLevel");
    expect(capturedDataSourcesSql).toContain("jurisdiction_name AS jurisdictionName");
    expect(capturedDataSourcesSql).toContain("fips_code AS fipsCode");
    expect(capturedDataSourcesSql).toContain("fetch_config AS fetchConfig");
  });
});

/**
 * The data CI seeds before `npm run risk:check` (`npm run db:seed`): the demo bids only. Five of them are state bids
 * (CA, FL, IL, NY, TX), so 45 states have no bid, and the 50-state results cannot be verified from it.
 */
async function seedOnlyDatabase() {
  testDb = await createTestDatabase({ seed: true });
  return testDb.db;
}

const NOW = new Date("2026-05-31T00:00:00.000Z");
const SEED_DATA_ONLY_STATE_COUNT = 5;

function checkOf(report: RiskChecklistReport, id: string) {
  const found = report.checks.find((entry) => entry.id === id);
  if (!found) throw new Error(`the report has no ${id} check`);
  return found;
}

/**
 * Every check of the checklist, one by one, against the seeded throwaway database CI runs it on: what its verdict is a
 * claim about, and so whether the seed-data opt-out sets it aside. A check is set aside only when its verdict is about
 * the coverage of the business database, which seed data cannot satisfy by construction; a check about code, config or
 * the rows that are present runs, and must pass, on seed data too (what it says is scoped by the count in its summary).
 * Keyed by the ids the checklist is made of, so a new check does not compile until someone has decided which it is.
 */
const SEED_DATA_TREATMENT: Record<RiskCheckId, { setAside: boolean; reason: string }> = {
  "state-coverage": {
    setAside: true,
    reason: "every one of the 50 states has an active bid: a completeness claim about the business database that five seeded states can never satisfy",
  },
  "state-data-quality-gate": {
    setAside: true,
    reason:
      "no P0 reason across the 50 state rows. Its missing_state_bid reason is the same coverage claim and is set aside, so the gate is NOT RUN while a state has no bid; " +
      "its other P0 reasons (empty core field, bad detail route or archive, placeholder URL, registry metadata, duplicate enabled source, a crawler success with zero rows) are code, config or rows that are present, and still fail it",
  },
  "state-content": {
    setAside: false,
    reason: "every state bid that is present has a title, issuer, URL, state and description: a claim about those rows (5 on seed data), which seed data can satisfy and a broken demo row still fails",
  },
  "bid-detail-routes": {
    setAside: false,
    reason: "the id of every state bid that is present survives route encoding and is found by detail lookup: code run over the rows present",
  },
  "attachment-downloads": {
    setAside: false,
    reason: "every attachment of a state bid that is present uses the internal download route and would not 404: code run over the rows present",
  },
  "account-tier-separation": {
    setAside: false,
    reason: "the free, pro, business and admin entitlement matrix: code, no data at all",
  },
  "source-ingestion-governance": {
    setAside: false,
    reason: "registry governance metadata, restricted-source blocks and local ingestion readiness: code and config (real-world approval is the separate, production-only requireSourceApproval)",
  },
  "source-validity-metadata": {
    setAside: false,
    reason: "authority, trust, evidence mode and notes of the 50 registry sources: code, no data at all",
  },
  "state-url-validity": {
    setAside: false,
    reason: "no state bid that is present has a placeholder source URL or an unsafe attachment URL: a claim about those rows",
  },
  "global-url-validity": {
    setAside: false,
    reason: "no active bid that is present has a placeholder source URL or an unsafe attachment URL: a claim about those rows",
  },
};

describe("risk checklist on seed data", () => {
  const DATA_CHECKS = RISK_CHECK_IDS.filter((id) => SEED_DATA_TREATMENT[id].setAside);

  it("decides, for every check the checklist is made of, whether the opt-out sets it aside", async () => {
    // The table covers exactly the checks the report is made of, so none was left undecided or kept after it was dropped.
    expect(Object.keys(SEED_DATA_TREATMENT).sort()).toEqual([...RISK_CHECK_IDS].sort());
    expect(DATA_CHECKS).toEqual(["state-coverage", "state-data-quality-gate"]);

    const db = await seedOnlyDatabase();
    const report = await createRiskChecklistReport(db, NOW, { seedData: true });

    expect(report.checks.map((entry) => entry.id)).toEqual([...RISK_CHECK_IDS]);
    for (const entry of report.checks) {
      const treatment = SEED_DATA_TREATMENT[entry.id as RiskCheckId];
      expect(riskCheckStatus(entry), `${entry.id} verdict: ${treatment.reason}`).toBe(treatment.setAside ? "not_run" : "pass");
    }
  });

  it("reports the 50-state checks as NOT RUN, never PASS, with the real numbers, when the run says it is on seed data", async () => {
    const db = await seedOnlyDatabase();

    const report = await createRiskChecklistReport(db, NOW, { seedData: true });

    expect(checkOf(report, "state-coverage")).toMatchObject({ status: "not_run", ok: false });
    expect(checkOf(report, "state-coverage").summary).toBe(
      `not evaluated on seed data: ${SEED_DATA_ONLY_STATE_COUNT}/50 required states have at least one active bid`,
    );
    // Which states are missing stays on record, as it does for a failure.
    expect((checkOf(report, "state-coverage").details ?? []).filter((detail) => detail.startsWith("missing state "))).toHaveLength(
      50 - SEED_DATA_ONLY_STATE_COUNT,
    );
    expect(checkOf(report, "state-data-quality-gate")).toMatchObject({ status: "not_run", ok: false });
    expect(checkOf(report, "state-data-quality-gate").summary).toContain(`${50 - SEED_DATA_ONLY_STATE_COUNT}/50 states have no active bid`);
    // Nothing else is waived: every other check ran, and passed.
    for (const entry of report.checks.filter((candidate) => !DATA_CHECKS.includes(candidate.id as RiskCheckId))) {
      expect(entry, entry.id).toMatchObject({ ok: true, status: "pass" });
    }
  });

  it("is not ok, since not every check passed, and not failed either: assert lets it through and says what did not run", async () => {
    const db = await seedOnlyDatabase();

    const report = await createRiskChecklistReport(db, NOW, { seedData: true });
    const text = formatRiskChecklistReport(report);

    expect(report.ok).toBe(false);
    expect(riskChecklistOutcome(report)).toBe("incomplete");
    expect(() => assertRiskChecklistReport(report)).not.toThrow();
    // NOT RUN is its own word, on the headline and on the check's line, and nothing is called PASS that was not run.
    expect(text).toContain(`Risk checklist INCOMPLETE at ${NOW.toISOString()} (NOT RUN: state-coverage, state-data-quality-gate)`);
    expect(text).toContain("NOT RUN state-coverage: not evaluated on seed data: 5/50 required states have at least one active bid");
    expect(text).toContain("NOT RUN state-data-quality-gate:");
    expect(text).not.toContain("PASS state-coverage");
    expect(text).not.toContain("PASS state-data-quality-gate");
    expect(text).not.toContain("Risk checklist PASS");
    expect(text).not.toContain("FAIL");
    expect(text).toContain("PASS state-content:");
  });

  it("says why the checks were not run, on the check itself", async () => {
    const db = await seedOnlyDatabase();

    const report = await createRiskChecklistReport(db, NOW, { seedData: true });

    for (const id of DATA_CHECKS) {
      expect((checkOf(report, id).details ?? [])[0], id).toMatch(/seed data/i);
    }
  });

  it("fails the same data without the opt-out, as before", async () => {
    const db = await seedOnlyDatabase();

    const report = await createRiskChecklistReport(db, NOW);

    expect(checkOf(report, "state-coverage")).toMatchObject({ status: "fail", ok: false });
    expect(checkOf(report, "state-coverage").summary).toBe("5/50 required states have at least one active bid");
    expect(checkOf(report, "state-data-quality-gate")).toMatchObject({ status: "fail", ok: false });
    expect(report.ok).toBe(false);
    expect(riskChecklistOutcome(report)).toBe("fail");
    expect(() => assertRiskChecklistReport(report)).toThrow(/FAIL state-coverage/);
    const text = formatRiskChecklistReport(report);
    expect(text).toContain("Risk checklist FAIL");
    expect(text).not.toContain("NOT RUN");
  });

  it("takes the opt-out from RISK_CHECK_SEED_DATA=true, and from no other value", async () => {
    const db = await seedOnlyDatabase();

    vi.stubEnv("RISK_CHECK_SEED_DATA", "true");
    const optedOut = await createRiskChecklistReport(db, NOW);
    expect(checkOf(optedOut, "state-coverage").status).toBe("not_run");
    expect(() => assertRiskChecklistReport(optedOut)).not.toThrow();

    for (const value of ["1", "yes", "TRUE", "false", ""]) {
      vi.stubEnv("RISK_CHECK_SEED_DATA", value);
      const report = await createRiskChecklistReport(db, NOW);
      expect(checkOf(report, "state-coverage").status, `RISK_CHECK_SEED_DATA=${value}`).toBe("fail");
    }
  });

  it("lets the option beat the variable, in both directions", async () => {
    const db = await seedOnlyDatabase();

    vi.stubEnv("RISK_CHECK_SEED_DATA", "true");
    expect(checkOf(await createRiskChecklistReport(db, NOW, { seedData: false }), "state-coverage").status).toBe("fail");

    vi.stubEnv("RISK_CHECK_SEED_DATA", "");
    expect(checkOf(await createRiskChecklistReport(db, NOW, { seedData: true }), "state-coverage").status).toBe("not_run");
  });

  it("ignores the opt-out in production, whichever way it was given: all 50 states are required there", async () => {
    const db = await seedOnlyDatabase();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RISK_CHECK_SEED_DATA", "true");

    for (const options of [{}, { seedData: true }]) {
      const report = await createRiskChecklistReport(db, NOW, options);

      expect(checkOf(report, "state-coverage"), JSON.stringify(options)).toMatchObject({ status: "fail", ok: false });
      expect(checkOf(report, "state-coverage").summary).toBe("5/50 required states have at least one active bid");
      expect(checkOf(report, "state-data-quality-gate"), JSON.stringify(options)).toMatchObject({ status: "fail", ok: false });
      expect(riskChecklistOutcome(report)).toBe("fail");
      expect(() => assertRiskChecklistReport(report)).toThrow(/FAIL state-coverage/);
      expect(formatRiskChecklistReport(report)).not.toContain("NOT RUN");
    }
  });

  it("passes full 50-state coverage with or without the opt-out: the opt-out never turns a result into a non-result", async () => {
    const db = await seededDatabase();

    for (const options of [{}, { seedData: true }, { seedData: false }]) {
      const report = await createRiskChecklistReport(db, NOW, options);

      expect(report.ok, JSON.stringify(options)).toBe(true);
      expect(riskChecklistOutcome(report)).toBe("pass");
      expect(checkOf(report, "state-coverage")).toMatchObject({ status: "pass", ok: true, summary: "50/50 required states have at least one active bid" });
      expect(checkOf(report, "state-data-quality-gate")).toMatchObject({ status: "pass", ok: true });
      expect(report.checks.every((entry) => riskCheckStatus(entry) === "pass")).toBe(true);
      const text = formatRiskChecklistReport(report);
      expect(text).toContain("Risk checklist PASS");
      expect(text).not.toContain("NOT RUN");
    }
  });

  it("does not excuse another failure: a P0 reason other than a missing bid still fails the gate", async () => {
    const db = await seedOnlyDatabase();
    db.update(bids).set({ description: "", fullDescription: "" }).where(eq(bids.stateCode, "CA")).run();

    const report = await createRiskChecklistReport(db, NOW, { seedData: true });

    expect(checkOf(report, "state-content")).toMatchObject({ status: "fail" });
    expect(checkOf(report, "state-data-quality-gate")).toMatchObject({ status: "fail", ok: false });
    const gateDetails = (checkOf(report, "state-data-quality-gate").details ?? []).join("\n");
    expect(gateDetails).toContain("empty_core_field");
    // What the opt-out sets aside is not reported as a failure.
    expect(gateDetails).not.toContain("missing_state_bid");
    // The coverage check still did not run, and the report says both.
    expect(checkOf(report, "state-coverage").status).toBe("not_run");
    expect(riskChecklistOutcome(report)).toBe("fail");
    expect(() => assertRiskChecklistReport(report)).toThrow(/FAIL state-data-quality-gate/);
    expect(formatRiskChecklistReport(report)).toContain("Risk checklist FAIL");
    expect(formatRiskChecklistReport(report)).toContain("NOT RUN state-coverage");
  });

  it("does not excuse a failing check that has nothing to do with the states", async () => {
    const db = await seedOnlyDatabase();
    db.update(bids).set({ sourceUrl: "https://sam.gov/opp/12345" }).where(eq(bids.id, "1")).run();

    const report = await createRiskChecklistReport(db, NOW, { seedData: true });

    expect(checkOf(report, "global-url-validity")).toMatchObject({ status: "fail" });
    expect(() => assertRiskChecklistReport(report)).toThrow(/FAIL global-url-validity/);
  });
});

describe("stateCoverageCheck", () => {
  const fifty = Array.from({ length: 50 }, (_, index) => `S${String(index).padStart(2, "0")}`);

  it("passes when every required state has a bid, and fails with the missing ones named when one has not", () => {
    expect(stateCoverageCheck({ requiredStates: fifty, availableStates: fifty, seedData: false })).toMatchObject({
      id: "state-coverage",
      ok: true,
      status: "pass",
      summary: "50/50 required states have at least one active bid",
    });
    const missing = stateCoverageCheck({ requiredStates: fifty, availableStates: fifty.slice(2), seedData: false });
    expect(missing).toMatchObject({ ok: false, status: "fail", summary: "48/50 required states have at least one active bid" });
    expect(missing.details).toEqual(["missing state S00", "missing state S01"]);
  });

  it("is NOT RUN, with the real count and the missing states, when seed data has not got them all", () => {
    const check = stateCoverageCheck({ requiredStates: fifty, availableStates: fifty.slice(0, 5), seedData: true });

    expect(check).toMatchObject({
      id: "state-coverage",
      ok: false,
      status: "not_run",
      summary: "not evaluated on seed data: 5/50 required states have at least one active bid",
    });
    expect((check.details ?? []).filter((detail) => detail.startsWith("missing state "))).toHaveLength(45);
  });

  it("passes on seed data that has them all", () => {
    expect(stateCoverageCheck({ requiredStates: fifty, availableStates: fifty, seedData: true })).toMatchObject({
      ok: true,
      status: "pass",
      summary: "50/50 required states have at least one active bid",
    });
  });

  it("fails on seed data when the registry does not list 50 states: that is the code's problem, not the data's", () => {
    const registry = fifty.slice(0, 49);

    expect(stateCoverageCheck({ requiredStates: registry, availableStates: registry.slice(0, 5), seedData: true })).toMatchObject({
      ok: false,
      status: "fail",
    });
    expect(stateCoverageCheck({ requiredStates: registry, availableStates: registry, seedData: true })).toMatchObject({
      ok: false,
      status: "fail",
    });
  });
});
