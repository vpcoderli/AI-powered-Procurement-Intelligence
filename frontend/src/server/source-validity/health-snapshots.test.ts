import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import type { LiveSourceHealthReport } from "./live-source-health";
import {
  listLiveSourceHealthSnapshots,
  recordLiveSourceHealthSnapshot,
  sourceHealthTrendBySource,
} from "./health-snapshots";

const REPORT: LiveSourceHealthReport = {
  ok: false,
  checkedAt: "2026-06-01T03:00:00.000Z",
  summary: {
    total: 2,
    healthy: 1,
    unhealthy: 1,
    skipped: 0,
  },
  results: [
    {
      stateCode: "CA",
      sourceId: "ca_caleprocure",
      label: "California Cal eProcure",
      url: "https://caleprocure.ca.gov",
      sourceAuthority: "official",
      trustStatus: "verified",
      status: "healthy",
      method: "HEAD",
      httpStatus: 200,
      statusText: "OK",
      errorCode: null,
      errorMessage: null,
      operationalSeverity: "none",
      recommendedAction: "none",
    },
    {
      stateCode: "TX",
      sourceId: "tx_esbd",
      label: "Texas SmartBuy",
      url: "https://www.txsmartbuy.gov/esbd",
      sourceAuthority: "official",
      trustStatus: "verified",
      status: "unhealthy",
      method: "GET",
      httpStatus: 503,
      statusText: "Service Unavailable",
      errorCode: "http_error",
      errorMessage: "HTTP 503 Service Unavailable",
      operationalSeverity: "warning",
      recommendedAction: "browser_or_access_review",
    },
  ],
};

describe("live source health snapshots", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("records and lists recent live source health reports without losing per-source results", () => {
    const snapshot = recordLiveSourceHealthSnapshot(testDb.db, REPORT, "2026-06-01T03:00:01.000Z");

    expect(snapshot).toMatchObject({
      ok: false,
      checkedAt: REPORT.checkedAt,
      createdAt: "2026-06-01T03:00:01.000Z",
      report: REPORT,
    });

    expect(listLiveSourceHealthSnapshots(testDb.db, 1)).toEqual([
      expect.objectContaining({
        id: snapshot.id,
        ok: false,
        report: REPORT,
      }),
    ]);
  });

  it("aggregates per-source health trend from recent snapshots", () => {
    recordLiveSourceHealthSnapshot(
      testDb.db,
      {
        ...REPORT,
        ok: true,
        checkedAt: "2026-06-01T01:00:00.000Z",
        summary: { total: 1, healthy: 1, unhealthy: 0, skipped: 0 },
        results: [{ ...REPORT.results[0], status: "healthy", httpStatus: 200, errorMessage: null }],
      },
      "2026-06-01T01:00:01.000Z",
    );
    recordLiveSourceHealthSnapshot(
      testDb.db,
      {
        ...REPORT,
        checkedAt: "2026-06-01T02:00:00.000Z",
        summary: { total: 1, healthy: 0, unhealthy: 1, skipped: 0 },
        results: [{ ...REPORT.results[0], status: "unhealthy", httpStatus: 503, errorMessage: "HTTP 503" }],
      },
      "2026-06-01T02:00:01.000Z",
    );
    recordLiveSourceHealthSnapshot(
      testDb.db,
      {
        ...REPORT,
        checkedAt: "2026-06-01T03:00:00.000Z",
        summary: { total: 1, healthy: 0, unhealthy: 1, skipped: 0 },
        results: [{ ...REPORT.results[0], status: "unhealthy", httpStatus: 504, errorMessage: "HTTP 504" }],
      },
      "2026-06-01T03:00:01.000Z",
    );

    const trends = sourceHealthTrendBySource(listLiveSourceHealthSnapshots(testDb.db, 5));

    expect(trends.get("ca_caleprocure")).toEqual({
      sampleSize: 3,
      healthyChecks: 1,
      unhealthyChecks: 2,
      skippedChecks: 0,
      healthyPercent: 33,
      currentStatus: "unhealthy",
      currentStreak: 2,
      lastUnhealthyAt: "2026-06-01T03:00:00.000Z",
    });
    expect(trends.get("ca")).toEqual(trends.get("ca_caleprocure"));
  });
});
