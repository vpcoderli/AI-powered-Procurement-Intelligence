import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { STATE_CRAWLER_SOURCES } from "@/lib/state-crawler-sources";
import type { AppDatabase } from "@/server/db/client";
import { bidAttachments, bids, crawlerLogs, dataSources } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  cleanupDuplicateCanonicalStateSources,
  createStateDataQualityReport,
  createStateDataQualityReportFromMysql,
  formatStateDataQualityReport,
} from "./state-data-quality";

const NOW = "2026-06-30T00:00:00.000Z";

let testDb: TestDatabase | null = null;

afterEach(async () => {
  delete process.env.CRAWLER_ATTACHMENT_DIR;
  await testDb?.cleanup();
  testDb = null;
});

async function createSeededQualityDatabase(options: { omitStates?: string[] } = {}) {
  testDb = await createTestDatabase();
  const omitted = new Set(options.omitStates ?? []);

  for (const source of STATE_CRAWLER_SOURCES) {
    testDb.db
      .insert(dataSources)
      .values({
        id: source.id,
        label: source.label,
        issuerType: "state",
        stateCode: source.stateCode,
        baseUrl: source.baseUrl,
        isEnabled: 1,
        cadence: "daily",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();

    if (omitted.has(source.stateCode)) continue;
    seedStateBid(testDb.db, source.stateCode, source.id, source.label, source.baseUrl);
  }

  return testDb;
}

function seedStateBid(
  db: AppDatabase,
  stateCode: string,
  sourceId: string,
  label: string,
  sourceUrl: string,
) {
  db.insert(bids)
    .values({
      id: `${sourceId}:quality-seed`,
      source: label,
      sourceBidId: `${sourceId}:quality-seed`,
      dedupeKey: `${sourceId}:quality-seed`,
      title: `${label} Quality Gate Opportunity`,
      description: `Non-empty ${stateCode} procurement description.`,
      fullDescription: `Detailed ${stateCode} procurement detail page content.`,
      originalCategory: "General Procurement",
      amount: "$10,000",
      amountMin: 10000,
      amountMax: 10000,
      currency: "USD",
      publishedDate: "2026-06-01",
      deadlineDate: "2026-07-15",
      issuerName: label,
      issuerType: "state",
      stateCode,
      contactName: "Procurement Office",
      contactEmail: "procurement@example.gov",
      contactPhone: "+1 (555) 000-0000",
      sourceUrl,
      isActive: 1,
      detailArchiveStatus: "not_archived",
      firstSeenAt: NOW,
      lastSeenAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

function reasonCodesForState(report: Awaited<ReturnType<typeof createStateDataQualityReport>>, stateCode: string) {
  const row = report.rows.find((entry) => entry.stateCode === stateCode);
  expect(row, `${stateCode} row`).toBeDefined();
  return row!.reasons.map((reason) => reason.code);
}

describe("50-state data quality gate", () => {
  it("returns one deterministic row per state and marks missing state data as a P0 blocker", async () => {
    const seeded = await createSeededQualityDatabase({ omitStates: ["WY"] });

    const report = await createStateDataQualityReport(seeded.db, new Date(NOW));

    expect(report.ok).toBe(false);
    expect(report.rows).toHaveLength(50);
    expect(report.summary.totalStates).toBe(50);
    expect(report.summary.p0BlockerStates).toBe(1);
    expect(reasonCodesForState(report, "WY")).toContain("missing_state_bid");
    expect(report.rows.map((row) => row.stateCode)).toEqual(
      [...STATE_CRAWLER_SOURCES].map((source) => source.stateCode).sort(),
    );
    expect(formatStateDataQualityReport(report)).toContain("WY");
    expect(formatStateDataQualityReport(report)).toContain("missing_state_bid");
  });

  it("classifies duplicate enabled canonical state sources as a P0 blocker", async () => {
    const seeded = await createSeededQualityDatabase();
    seeded.db
      .insert(dataSources)
      .values({
        id: "ca_duplicate_enabled",
        label: "California Duplicate Enabled",
        issuerType: "state",
        stateCode: "CA",
        baseUrl: "https://caleprocure.ca.gov",
        isEnabled: 1,
        cadence: "daily",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();

    const report = await createStateDataQualityReport(seeded.db, new Date(NOW));

    expect(report.ok).toBe(false);
    expect(reasonCodesForState(report, "CA")).toContain("duplicate_canonical_enabled_source");
    expect(report.rows.find((row) => row.stateCode === "CA")).toMatchObject({
      riskLevel: "P0",
      enabledSourceCount: 2,
    });
  });

  it("cleans duplicate enabled state source aliases by keeping the canonical crawler source", async () => {
    const seeded = await createSeededQualityDatabase();
    seeded.db
      .insert(dataSources)
      .values({
        id: "cal_eprocure",
        label: "Cal eProcure Legacy Alias",
        issuerType: "state",
        stateCode: "CA",
        baseUrl: "https://caleprocure.ca.gov/event/67890",
        isEnabled: 1,
        cadence: "daily",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();

    const result = cleanupDuplicateCanonicalStateSources(seeded.db, new Date(NOW));
    const report = await createStateDataQualityReport(seeded.db, new Date(NOW));

    expect(result).toMatchObject({
      checkedStates: 50,
      disabledSourceIds: ["cal_eprocure"],
    });
    expect(
      seeded.db.select().from(dataSources).all().find((source) => source.id === "ca_caleprocure"),
    ).toMatchObject({ isEnabled: 1 });
    expect(
      seeded.db.select().from(dataSources).all().find((source) => source.id === "cal_eprocure"),
    ).toMatchObject({ isEnabled: 0 });
    expect(reasonCodesForState(report, "CA")).not.toContain("duplicate_canonical_enabled_source");
    expect(report.rows.find((row) => row.stateCode === "CA")).toMatchObject({
      enabledSourceCount: 1,
    });
  });

  it("keeps not_archived attachments as download notes instead of real openable files", async () => {
    const seeded = await createSeededQualityDatabase();
    seeded.db
      .insert(bidAttachments)
      .values({
        id: "ca_attachment_note",
        bidId: "ca_caleprocure:quality-seed",
        name: "Solicitation note",
        url: "https://caleprocure.ca.gov/event/CA-2026-1/attachments/solicitation.pdf",
        originalUrl: "https://caleprocure.ca.gov/event/CA-2026-1/attachments/solicitation.pdf",
        archiveStatus: "not_archived",
        storagePath: null,
        checksumSha256: null,
        createdAt: NOW,
      })
      .run();

    const report = await createStateDataQualityReport(seeded.db, new Date(NOW));
    const ca = report.rows.find((row) => row.stateCode === "CA");

    expect(ca).toMatchObject({
      attachmentStatus: "download_note",
      attachmentSummary: {
        total: 1,
        realFileOpenable: 0,
        downloadNote: 1,
        missingOrFailed: 0,
      },
    });
    expect(reasonCodesForState(report, "CA")).toContain("attachment_download_note");
    expect(reasonCodesForState(report, "CA")).not.toContain("attachment_archive_invalid");
    expect(report.attachmentWorklist).toEqual([
      expect.objectContaining({
        id: "CA:ca_caleprocure:quality-seed:ca_attachment_note",
        stateCode: "CA",
        sourceId: "ca_caleprocure",
        bidId: "ca_caleprocure:quality-seed",
        attachmentId: "ca_attachment_note",
        name: "Solicitation note",
        archiveStatus: "not_archived",
        recommendedAction: expect.stringContaining("Archive the attachment locally"),
      }),
    ]);
    expect(formatStateDataQualityReport(report)).toContain("Attachment worklist:");
  });

  it("treats archived attachments without a valid file and checksum as a P0 blocker", async () => {
    const seeded = await createSeededQualityDatabase();
    seeded.db
      .insert(bidAttachments)
      .values({
        id: "ca_missing_archived_file",
        bidId: "ca_caleprocure:quality-seed",
        name: "Missing archived file",
        url: "https://caleprocure.ca.gov/event/CA-2026-1/attachments/missing.pdf",
        originalUrl: "https://caleprocure.ca.gov/event/CA-2026-1/attachments/missing.pdf",
        archiveStatus: "archived",
        storagePath: "ca/missing.pdf",
        checksumSha256: null,
        createdAt: NOW,
      })
      .run();

    const report = await createStateDataQualityReport(seeded.db, new Date(NOW), {
      attachmentRoots: [seeded.directory],
    });

    expect(report.ok).toBe(false);
    expect(reasonCodesForState(report, "CA")).toContain("attachment_archive_invalid");
    expect(report.rows.find((row) => row.stateCode === "CA")).toMatchObject({
      attachmentStatus: "missing_or_failed",
      riskLevel: "P0",
    });
  });

  it("accepts archived attachments only when the local file opens and the checksum matches", async () => {
    const seeded = await createSeededQualityDatabase();
    const attachmentDir = path.join(seeded.directory, "ca");
    const attachmentPath = path.join(attachmentDir, "solicitation.txt");
    await mkdir(attachmentDir, { recursive: true });
    await writeFile(attachmentPath, "real attachment bytes");
    seeded.db
      .insert(bidAttachments)
      .values({
        id: "ca_openable_archived_file",
        bidId: "ca_caleprocure:quality-seed",
        name: "Openable archived file",
        url: "https://caleprocure.ca.gov/event/CA-2026-1/attachments/solicitation.txt",
        originalUrl: "https://caleprocure.ca.gov/event/CA-2026-1/attachments/solicitation.txt",
        archiveStatus: "archived",
        storagePath: "ca/solicitation.txt",
        checksumSha256: "0658205decd6a23b88b03ab5398348cb8b7f38b43b36a38038d3b91d52ec8523",
        createdAt: NOW,
      })
      .run();

    const report = await createStateDataQualityReport(seeded.db, new Date(NOW), {
      attachmentRoots: [seeded.directory],
    });

    expect(report.rows.find((row) => row.stateCode === "CA")).toMatchObject({
      attachmentStatus: "real_file_openable",
      attachmentSummary: {
        total: 1,
        realFileOpenable: 1,
        downloadNote: 0,
        missingOrFailed: 0,
      },
    });
    expect(reasonCodesForState(report, "CA")).not.toContain("attachment_archive_invalid");
  });

  it("marks successful crawler runs with zero fetched rows as a P0 blocker", async () => {
    const seeded = await createSeededQualityDatabase();
    seeded.db
      .insert(crawlerLogs)
      .values({
        id: "ca_zero_rows",
        source: "ca_caleprocure",
        runId: "ca_zero_rows_run",
        status: "success",
        startedAt: "2026-06-29T00:00:00.000Z",
        finishedAt: "2026-06-29T00:01:00.000Z",
        durationMs: 60000,
        fetchedCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
      })
      .run();

    const report = await createStateDataQualityReport(seeded.db, new Date(NOW));

    expect(report.ok).toBe(false);
    expect(reasonCodesForState(report, "CA")).toContain("crawler_success_zero_rows");
  });

  it("builds a prioritized remediation action queue from state quality reason codes", async () => {
    const seeded = await createSeededQualityDatabase({ omitStates: ["WY"] });
    seeded.db
      .insert(crawlerLogs)
      .values({
        id: "ca_zero_rows",
        source: "ca_caleprocure",
        runId: "ca_zero_rows_run",
        status: "success",
        startedAt: "2026-06-29T00:00:00.000Z",
        finishedAt: "2026-06-29T00:01:00.000Z",
        durationMs: 60000,
        fetchedCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
      })
      .run();
    seeded.db
      .insert(bidAttachments)
      .values({
        id: "ca_attachment_note",
        bidId: "ca_caleprocure:quality-seed",
        name: "Solicitation note",
        url: "https://caleprocure.ca.gov/event/CA-2026-1/attachments/solicitation.pdf",
        originalUrl: "https://caleprocure.ca.gov/event/CA-2026-1/attachments/solicitation.pdf",
        archiveStatus: "not_archived",
        storagePath: null,
        checksumSha256: null,
        createdAt: NOW,
      })
      .run();

    const report = await createStateDataQualityReport(seeded.db, new Date(NOW));

    expect(report.actions[0]).toMatchObject({
      id: "CA:ca_caleprocure:crawler_success_zero_rows",
      priority: "P0",
      stateCode: "CA",
      sourceId: "ca_caleprocure",
      reasonCode: "crawler_success_zero_rows",
      ownerHint: "data-ops",
      dueInHours: 24,
    });
    expect(report.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "WY:wy_state_procurement:missing_state_bid",
          priority: "P0",
          ownerHint: "data-ops",
          recommendedAction: expect.stringContaining("Run or repair the state crawler"),
        }),
        expect.objectContaining({
          id: "CA:ca_caleprocure:attachment_download_note",
          priority: "P2",
          ownerHint: "archive-ops",
          recommendedAction: expect.stringContaining("Archive the attachment locally"),
        }),
      ]),
    );
    expect(formatStateDataQualityReport(report)).toContain("Remediation actions:");
  });
});

function createMysqlQualityStore(options: {
  omitStates?: string[];
  duplicateEnabledState?: string;
  notArchivedAttachmentState?: string;
  zeroRowCrawlerState?: string;
} = {}) {
  const omitted = new Set(options.omitStates ?? []);
  const bidsRows = STATE_CRAWLER_SOURCES
    .filter((source) => !omitted.has(source.stateCode))
    .map((source) => mysqlBidRow(source));
  const dataSourceRows = STATE_CRAWLER_SOURCES.flatMap((source) => {
    const rows: Record<string, unknown>[] = [mysqlDataSourceRow(source)];
    if (source.stateCode === options.duplicateEnabledState) {
      rows.push({
        ...mysqlDataSourceRow(source),
        id: `${source.id}_duplicate`,
        label: `${source.label} Duplicate`,
      });
    }
    return rows;
  });
  const attachmentRows = STATE_CRAWLER_SOURCES.flatMap((source) => {
    if (source.stateCode !== options.notArchivedAttachmentState) return [];

    return [
      {
        id: `${source.id}_download_note`,
        bidId: `${source.id}:quality-seed`,
        name: "Download note",
        url: `${source.baseUrl}/attachments/note.pdf`,
        originalUrl: `${source.baseUrl}/attachments/note.pdf`,
        archiveStatus: "not_archived",
        storagePath: null,
        checksumSha256: null,
        createdAt: NOW,
      },
    ];
  });
  const crawlerRows = STATE_CRAWLER_SOURCES.map((source) => ({
    id: `${source.id}_crawler`,
    source: source.id,
    runId: `${source.id}_run`,
    status: "success",
    startedAt: "2026-06-29T00:00:00.000Z",
    finishedAt: "2026-06-29T00:01:00.000Z",
    durationMs: 60000,
    fetchedCount: source.stateCode === options.zeroRowCrawlerState ? "0" : "1",
    insertedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    metadata: null,
  }));
  const riskRows = [
    {
      id: "risk_snapshot",
      ok: 1,
      checkedAt: "2026-06-29T00:00:00.000Z",
      reportJson: "{}",
      createdAt: "2026-06-29T00:00:00.000Z",
    },
  ];
  const sourceHealthRows = [
    {
      id: "source_health_snapshot",
      ok: 1,
      checkedAt: "2026-06-29T00:00:00.000Z",
      summaryJson: "{}",
      resultsJson: JSON.stringify(
        STATE_CRAWLER_SOURCES.map((source) => ({
          stateCode: source.stateCode,
          status: "healthy",
        })),
      ),
      createdAt: "2026-06-29T00:00:00.000Z",
    },
  ];

  const capturedSql: { bids?: string; dataSources?: string } = {};

  return {
    capturedSql,
    query: async (sql: string) => {
      if (sql.includes("FROM bids")) {
        capturedSql.bids = sql;
        return [bidsRows, undefined];
      }
      if (sql.includes("FROM bid_attachments")) return [attachmentRows, undefined];
      if (sql.includes("FROM data_sources")) {
        capturedSql.dataSources = sql;
        return [dataSourceRows, undefined];
      }
      if (sql.includes("FROM crawler_logs")) return [crawlerRows, undefined];
      if (sql.includes("FROM risk_check_snapshots")) return [riskRows, undefined];
      if (sql.includes("FROM source_health_snapshots")) return [sourceHealthRows, undefined];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

function mysqlBidRow(source: (typeof STATE_CRAWLER_SOURCES)[number]) {
  return {
    id: `${source.id}:quality-seed`,
    source: source.label,
    sourceBidId: `${source.id}:quality-seed`,
    dedupeKey: `${source.id}:quality-seed`,
    title: `${source.label} Quality Gate Opportunity`,
    description: `Non-empty ${source.stateCode} procurement description.`,
    fullDescription: `Detailed ${source.stateCode} procurement detail page content.`,
    originalCategory: "General Procurement",
    amount: "$10,000",
    amountMin: "10000",
    amountMax: 10000,
    currency: "USD",
    publishedDate: "2026-06-01",
    deadlineDate: "2026-07-15",
    issuerName: source.label,
    issuerType: "state",
    stateCode: source.stateCode.toLowerCase(),
    contactName: "Procurement Office",
    contactEmail: "procurement@example.gov",
    contactPhone: "+1 (555) 000-0000",
    sourceUrl: source.baseUrl,
    isActive: "1",
    rawPayload: null,
    sourceConfidence: "medium",
    qualityFlagsJson: "[]",
    adminReviewStatus: "unreviewed",
    adminReviewNote: null,
    adminReviewedAt: null,
    adminReviewedBy: null,
    displayStatus: "published",
    detailArchiveStatus: "not_archived",
    detailArchivePath: null,
    detailFetchedAt: null,
    detailChecksumSha256: null,
    detailArchiveError: null,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function mysqlDataSourceRow(source: (typeof STATE_CRAWLER_SOURCES)[number]) {
  return {
    id: source.id,
    label: source.label,
    issuerType: "state",
    stateCode: source.stateCode.toLowerCase(),
    baseUrl: source.baseUrl,
    isEnabled: "1",
    cadence: "daily",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("50-state data quality gate MySQL runtime", () => {
  it("parses MySQL row values and still returns one deterministic row for each state", async () => {
    const report = await createStateDataQualityReportFromMysql(
      createMysqlQualityStore({ omitStates: ["WY"], zeroRowCrawlerState: "CA" }) as never,
      new Date(NOW),
    );

    expect(report.rows).toHaveLength(50);
    expect(report.summary.totalStates).toBe(50);
    expect(report.rows.map((row) => row.stateCode)).toEqual(
      [...STATE_CRAWLER_SOURCES].map((source) => source.stateCode).sort(),
    );
    expect(report.rows.find((row) => row.stateCode === "CA")).toMatchObject({
      bidCount: 1,
      enabledSourceCount: 1,
      latestCrawlerStartedAt: "2026-06-29T00:00:00.000Z",
    });
    expect(reasonCodesForState(report, "CA")).toContain("crawler_success_zero_rows");
    expect(reasonCodesForState(report, "WY")).toContain("missing_state_bid");
  });

  it("classifies duplicate enabled canonical sources from MySQL rows as P0", async () => {
    const report = await createStateDataQualityReportFromMysql(
      createMysqlQualityStore({ duplicateEnabledState: "CA" }) as never,
      new Date(NOW),
    );

    expect(reasonCodesForState(report, "CA")).toContain("duplicate_canonical_enabled_source");
    expect(report.rows.find((row) => row.stateCode === "CA")).toMatchObject({
      riskLevel: "P0",
      enabledSourceCount: 2,
    });
  });

  it("keeps MySQL not_archived attachments in the download-note layer", async () => {
    const report = await createStateDataQualityReportFromMysql(
      createMysqlQualityStore({ notArchivedAttachmentState: "CA" }) as never,
      new Date(NOW),
    );

    expect(report.rows.find((row) => row.stateCode === "CA")).toMatchObject({
      attachmentStatus: "download_note",
      attachmentSummary: {
        total: 1,
        realFileOpenable: 0,
        downloadNote: 1,
        missingOrFailed: 0,
      },
    });
    expect(reasonCodesForState(report, "CA")).toContain("attachment_download_note");
    expect(reasonCodesForState(report, "CA")).not.toContain("attachment_archive_invalid");
  });

  it("selects the phase-1 jurisdiction, fips, and fetch-config columns in the bids and data_sources queries", async () => {
    const store = createMysqlQualityStore();

    await createStateDataQualityReportFromMysql(store as never, new Date(NOW));

    // Regression guard for the phase-1 dialect-parity gap: the row mappers have always read
    // these fields, but the SELECTs never listed them, so MySQL silently returned null forever.
    expect(store.capturedSql.bids).toContain("jurisdiction_level AS jurisdictionLevel");
    expect(store.capturedSql.bids).toContain("jurisdiction_name AS jurisdictionName");
    expect(store.capturedSql.bids).toContain("fips_code AS fipsCode");

    expect(store.capturedSql.dataSources).toContain("jurisdiction_level AS jurisdictionLevel");
    expect(store.capturedSql.dataSources).toContain("jurisdiction_name AS jurisdictionName");
    expect(store.capturedSql.dataSources).toContain("fips_code AS fipsCode");
    expect(store.capturedSql.dataSources).toContain("fetch_config AS fetchConfig");
  });
});
