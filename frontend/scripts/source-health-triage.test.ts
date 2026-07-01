import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  applySourceHealthTriagePlan,
  buildSourceHealthTriagePlan,
  inferSourceHealthDisposition,
  parseSourceHealthTriageArgs,
} from "./source-health-triage";
import type { SourceHealthOperationalReport, SourceHealthOperationalSource } from "./source-health-report";

const baseSource = {
  stateCode: "CA",
  sourceId: "ca_caleprocure",
  label: "California Cal eProcure",
  status: "unhealthy",
  classification: "forbidden",
  operationalSeverity: "warning",
  recommendedAction: "browser_or_access_review",
  owner: null,
  disposition: null,
  nextReviewAt: null,
  checkedAt: "2026-06-13T08:00:00.000Z",
  httpStatus: 403,
  errorCode: "http_error",
  reason: "HTTP 403 Forbidden token=raw-secret",
  currentStatus: "unhealthy",
  currentStreak: 2,
  sampleSize: 5,
  healthyPercent: 0,
  lastUnhealthyAt: "2026-06-13T08:00:00.000Z",
} satisfies SourceHealthOperationalSource;

function reportWith(sources: SourceHealthOperationalSource[]): SourceHealthOperationalReport {
  return {
    runtime: "sqlite",
    generatedAt: "2026-06-13T08:01:00.000Z",
    snapshot: {
      id: "source_health_latest",
      ok: false,
      checkedAt: "2026-06-13T08:00:00.000Z",
      createdAt: "2026-06-13T08:00:01.000Z",
    },
    summary: {
      total: sources.length,
      healthy: sources.filter((source) => source.status === "healthy").length,
      unhealthy: sources.filter((source) => source.status === "unhealthy").length,
      skipped: sources.filter((source) => source.status === "skipped").length,
    },
    unhealthyClassificationCounts: {},
    sources,
  };
}

describe("source health triage bulk assignment", () => {
  it("maps live source health classifications to durable dispositions", () => {
    expect(inferSourceHealthDisposition({ ...baseSource, classification: "timeout" })).toBe("retry_with_longer_timeout");
    expect(inferSourceHealthDisposition({ ...baseSource, classification: "login_required" })).toBe("vendor_account_review");
    expect(inferSourceHealthDisposition({ ...baseSource, classification: "bot_check" })).toBe("browser_access_review");
    expect(inferSourceHealthDisposition({ ...baseSource, classification: "forbidden" })).toBe("browser_access_review");
    expect(inferSourceHealthDisposition({ ...baseSource, classification: "empty_or_placeholder" })).toBe("parser_or_access_review");
    expect(inferSourceHealthDisposition({ ...baseSource, classification: "tls_or_network_error" })).toBe("network_or_tls_review");
    expect(inferSourceHealthDisposition({ ...baseSource, classification: "http_error" })).toBe("portal_status_review");
    expect(inferSourceHealthDisposition({ ...baseSource, recommendedAction: "update_registry_url" })).toBe("registry_url_review");
  });

  it("builds an apply plan only for unhealthy sources missing triage fields by default", () => {
    const plan = buildSourceHealthTriagePlan(reportWith([
      baseSource,
      {
        ...baseSource,
        stateCode: "TX",
        sourceId: "tx_esbd",
        classification: "login_required",
        owner: "source-ops@example.com",
        disposition: "vendor_account_review",
        nextReviewAt: "2026-06-20T00:00:00.000Z",
      },
      {
        ...baseSource,
        stateCode: "FL",
        sourceId: "fl_mfmp",
        status: "healthy",
        classification: "ok",
        recommendedAction: "none",
      },
    ]), {
      owner: "source-ops@example.com",
      now: () => "2026-06-13T00:00:00.000Z",
      nextReviewDays: 7,
    });

    expect(plan.applyCount).toBe(1);
    expect(plan.skippedCount).toBe(2);
    expect(plan.entries[0]).toMatchObject({
      sourceId: "ca_caleprocure",
      stateCode: "CA",
      next: {
        owner: "source-ops@example.com",
        disposition: "browser_access_review",
        nextReviewAt: "2026-06-20T00:00:00.000Z",
        reviewedAt: "2026-06-13T00:00:00.000Z",
      },
    });
    expect(plan.entries[0].next.notes).toContain("snapshot=source_health_latest");
    expect(plan.entries[0].next.notes).toContain("classification=forbidden");
    expect(JSON.stringify(plan)).not.toContain("raw-secret");
  });

  it("can include already triaged unhealthy sources when --all-unhealthy is selected", () => {
    const plan = buildSourceHealthTriagePlan(reportWith([
      {
        ...baseSource,
        owner: "old-owner@example.com",
        disposition: "manual_review",
        nextReviewAt: "2026-06-14T00:00:00.000Z",
      },
    ]), {
      onlyMissing: false,
      owner: "source-ops@example.com",
      now: () => "2026-06-13T00:00:00.000Z",
    });

    expect(plan.applyCount).toBe(1);
    expect(plan.entries[0]).toMatchObject({
      previous: {
        owner: "old-owner@example.com",
        disposition: "manual_review",
        nextReviewAt: "2026-06-14T00:00:00.000Z",
      },
      next: {
        owner: "source-ops@example.com",
      },
    });
  });

  it("does not call updater during dry-run and applies updates only when requested", async () => {
    const plan = buildSourceHealthTriagePlan(reportWith([baseSource]), {
      owner: "source-ops@example.com",
      now: () => "2026-06-13T00:00:00.000Z",
    });
    const updater = vi.fn().mockResolvedValue(undefined);

    await expect(applySourceHealthTriagePlan(plan, { apply: false, updater })).resolves.toEqual({
      applied: 0,
      dryRun: true,
    });
    expect(updater).not.toHaveBeenCalled();

    await expect(applySourceHealthTriagePlan(plan, { apply: true, updater })).resolves.toEqual({
      applied: 1,
      dryRun: false,
    });
    expect(updater).toHaveBeenCalledWith("ca_caleprocure", {
      liveHealthOwner: "source-ops@example.com",
      liveHealthDisposition: "browser_access_review",
      liveHealthNextReviewAt: "2026-06-20T00:00:00.000Z",
      liveHealthNotes: expect.stringContaining("classification=forbidden"),
      liveHealthReviewedAt: "2026-06-13T00:00:00.000Z",
    });
  });

  it("parses CLI args and registers the npm script", () => {
    expect(parseSourceHealthTriageArgs([
      "--owner=source-ops@example.com",
      "--next-review-days=3",
      "--all-unhealthy",
      "--apply",
      "--format=json",
      "--output=reports/source-health-triage.json",
    ])).toEqual({
      allUnhealthy: true,
      apply: true,
      format: "json",
      help: false,
      nextReviewDays: 3,
      output: "reports/source-health-triage.json",
      owner: "source-ops@example.com",
    });

    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["source:health:triage"]).toBe("tsx scripts/source-health-triage.ts");
  });
});
