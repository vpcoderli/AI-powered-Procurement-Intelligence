import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSourceHealthEvidenceBundle,
  formatSourceHealthEvidenceBundle,
  parseSourceHealthEvidenceArgs,
} from "./source-health-evidence";
import type { SourceHealthOperationalReport } from "./source-health-report";

const generatedAt = "2026-06-13T00:00:00.000Z";

const triagedReport: SourceHealthOperationalReport = {
  runtime: "sqlite",
  generatedAt,
  snapshot: {
    id: "source_health_latest",
    ok: false,
    checkedAt: "2026-06-12T22:00:00.000Z",
    createdAt: "2026-06-12T22:00:01.000Z",
  },
  summary: {
    total: 1,
    healthy: 0,
    unhealthy: 1,
    skipped: 0,
  },
  unhealthyClassificationCounts: {
    forbidden: 1,
  },
  sources: [
    {
      stateCode: "CA",
      sourceId: "ca_caleprocure",
      label: "California Cal eProcure",
      url: "https://caleprocure.ca.gov/?token=should-not-print",
      status: "unhealthy",
      classification: "forbidden",
      operationalSeverity: "warning",
      recommendedAction: "browser_or_access_review",
      owner: "source-ops@example.com",
      disposition: "vendor_account",
      nextReviewAt: "2026-06-15T00:00:00.000Z",
      checkedAt: "2026-06-12T22:00:00.000Z",
      httpStatus: 403,
      errorCode: "http_error",
      reason: "HTTP 403 Forbidden token=should-not-print",
      currentStatus: "unhealthy",
      currentStreak: 2,
      sampleSize: 3,
      healthyPercent: 33,
      lastUnhealthyAt: "2026-06-12T22:00:00.000Z",
    },
  ],
};

describe("source health evidence bundle", () => {
  it("marks live source health evidence ready when the latest snapshot covers expected states and unhealthy rows are triaged", () => {
    const bundle = buildSourceHealthEvidenceBundle(triagedReport, {
      expectedStateCount: 1,
      now: () => generatedAt,
    });
    const markdown = formatSourceHealthEvidenceBundle(bundle, "markdown");

    expect(bundle.ok).toBe(true);
    expect(bundle.readiness).toMatchObject({
      observedStateCount: 1,
      expectedStateCount: 1,
      unhealthySources: 1,
      unassignedUnhealthy: 0,
      missingDisposition: 0,
      missingNextReview: 0,
      overdueNextReview: 0,
    });
    expect(bundle.blockers).toEqual([]);
    expect(bundle.highPrioritySources[0]).toMatchObject({
      sourceId: "ca_caleprocure",
      url: "https://caleprocure.ca.gov/",
    });
    expect(markdown).toContain("Source Health Evidence READY");
    expect(markdown).toContain("https://caleprocure.ca.gov/");
    expect(markdown).toContain("source:health:ops");
    expect(markdown).toContain("source-ops@example.com");
  });

  it("blocks when no persisted live snapshot exists", () => {
    const bundle = buildSourceHealthEvidenceBundle({
      ...triagedReport,
      snapshot: null,
      summary: { total: 0, healthy: 0, unhealthy: 0, skipped: 0 },
      sources: [],
      unhealthyClassificationCounts: {},
    }, {
      expectedStateCount: 50,
      now: () => generatedAt,
    });

    expect(bundle.ok).toBe(false);
    expect(bundle.blockers).toContain("No persisted source health snapshot found. Run npm run source:health:ops first.");
    expect(formatSourceHealthEvidenceBundle(bundle, "markdown")).toContain("Source Health Evidence BLOCKED");
  });

  it("blocks untriaged, overdue, stale, and incomplete live evidence", () => {
    const bundle = buildSourceHealthEvidenceBundle({
      ...triagedReport,
      snapshot: {
        id: "source_health_stale",
        ok: false,
        checkedAt: "2026-06-01T00:00:00.000Z",
        createdAt: "2026-06-01T00:00:01.000Z",
      },
      sources: [
        {
          ...triagedReport.sources[0],
          owner: null,
          disposition: null,
          nextReviewAt: "2026-06-10T00:00:00.000Z",
          operationalSeverity: "critical",
          recommendedAction: "update_registry_url",
        },
      ],
    }, {
      expectedStateCount: 50,
      now: () => generatedAt,
      staleAfterHours: 72,
    });

    expect(bundle.ok).toBe(false);
    expect(bundle.readiness).toMatchObject({
      observedStateCount: 1,
      expectedStateCount: 50,
      criticalUnhealthy: 1,
      unassignedUnhealthy: 1,
      missingDisposition: 1,
      overdueNextReview: 1,
      staleSnapshot: true,
    });
    expect(bundle.blockers).toEqual(expect.arrayContaining([
      "Source health snapshot covers 1/50 expected state sources.",
      "Source health snapshot is stale: latest check is older than 72 hours.",
      "1 unhealthy source(s) are missing an owner.",
      "1 unhealthy source(s) are missing a disposition.",
      "1 unhealthy source(s) have overdue next-review dates.",
    ]));
  });

  it("sanitizes evidence bundle output", () => {
    const bundle = buildSourceHealthEvidenceBundle(triagedReport, {
      expectedStateCount: 1,
      now: () => generatedAt,
    });
    const serialized = [
      formatSourceHealthEvidenceBundle(bundle, "markdown"),
      formatSourceHealthEvidenceBundle(bundle, "json"),
    ].join("\n");

    expect(serialized).toContain("token=[REDACTED]");
    expect(serialized).not.toContain("should-not-print");
    expect(serialized).toContain("https://caleprocure.ca.gov/");
  });

  it("parses CLI args and registers the npm script", () => {
    expect(parseSourceHealthEvidenceArgs([
      "--format=json",
      "--output=reports/source-health-evidence.json",
      "--expected-state-count=50",
      "--stale-after-hours=48",
      "--allow-blocked",
    ])).toEqual({
      allowBlocked: true,
      expectedStateCount: 50,
      format: "json",
      help: false,
      output: "reports/source-health-evidence.json",
      staleAfterHours: 48,
    });

    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["source:health:evidence"]).toBe("tsx scripts/source-health-evidence.ts");
  });
});
