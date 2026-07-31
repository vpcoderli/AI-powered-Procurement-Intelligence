import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { STATE_CRAWLER_SOURCES } from "@/lib/state-crawler-sources";
import { bidAttachments, bids, dataSources } from "@/server/db/schema";
import type { AppDatabase } from "@/server/db/client";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createRiskChecklistReport, createRiskChecklistReportFromMysql, formatRiskChecklistReport } from "./checklist";

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

afterEach(async () => {
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

    await createRiskChecklistReportFromMysql(mysql as never, new Date("2026-05-31T00:00:00.000Z"));

    // Regression guard for the phase-1 dialect-parity gap: the row mapper has always read
    // these fields, but the SELECT never listed them, so MySQL silently returned null forever.
    expect(capturedDataSourcesSql).toContain("jurisdiction_level AS jurisdictionLevel");
    expect(capturedDataSourcesSql).toContain("jurisdiction_name AS jurisdictionName");
    expect(capturedDataSourcesSql).toContain("fips_code AS fipsCode");
    expect(capturedDataSourcesSql).toContain("fetch_config AS fetchConfig");
  });
});
