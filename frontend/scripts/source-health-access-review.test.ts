import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSourceHealthAccessReviewPacket,
  formatSourceHealthAccessReviewPacket,
  inferAccessReviewMode,
  parseSourceHealthAccessReviewArgs,
} from "./source-health-access-review";
import type { SourceHealthOperationalReport, SourceHealthOperationalSource } from "./source-health-report";

const generatedAt = "2026-06-13T00:00:00.000Z";

const baseSource: SourceHealthOperationalSource = {
  stateCode: "CA",
  sourceId: "ca_caleprocure",
  label: "California Cal eProcure",
  url: "https://caleprocure.ca.gov/?session=secret-session",
  status: "unhealthy",
  classification: "forbidden",
  operationalSeverity: "warning",
  recommendedAction: "browser_or_access_review",
  owner: "source-ops@example.com",
  disposition: "browser_access_review",
  nextReviewAt: "2026-06-15T00:00:00.000Z",
  checkedAt: "2026-06-12T22:00:00.000Z",
  httpStatus: 403,
  errorCode: "http_error",
  reason: "HTTP 403 Forbidden session=secret-session",
  currentStatus: "unhealthy",
  currentStreak: 2,
  sampleSize: 3,
  healthyPercent: 33,
  lastUnhealthyAt: "2026-06-12T22:00:00.000Z",
};

function reportWith(sources: SourceHealthOperationalSource[]): SourceHealthOperationalReport {
  return {
    runtime: "sqlite",
    generatedAt,
    snapshot: {
      id: "source_health_latest",
      ok: false,
      checkedAt: "2026-06-12T22:00:00.000Z",
      createdAt: "2026-06-12T22:00:01.000Z",
    },
    summary: {
      total: sources.length,
      healthy: sources.filter((source) => source.status === "healthy").length,
      unhealthy: sources.filter((source) => source.status === "unhealthy").length,
      skipped: 0,
    },
    unhealthyClassificationCounts: sources.reduce<Record<string, number>>((counts, source) => {
      if (source.status === "unhealthy") {
        counts[source.classification] = (counts[source.classification] ?? 0) + 1;
      }
      return counts;
    }, {}),
    sources,
  };
}

describe("source health access review packet", () => {
  it("maps classifications to browser, vendor, retry, network, and portal review modes", () => {
    expect(inferAccessReviewMode({ classification: "forbidden", recommendedAction: null })).toBe("browser_access");
    expect(inferAccessReviewMode({ classification: "bot_check", recommendedAction: null })).toBe("browser_access");
    expect(inferAccessReviewMode({ classification: "login_required", recommendedAction: null })).toBe("vendor_account");
    expect(inferAccessReviewMode({ classification: "timeout", recommendedAction: "retry_or_increase_timeout" })).toBe("long_timeout_retry");
    expect(inferAccessReviewMode({ classification: "tls_or_network_error", recommendedAction: "network_or_tls_review" })).toBe("network_tls");
    expect(inferAccessReviewMode({ classification: "http_error", recommendedAction: null })).toBe("portal_status");
    expect(inferAccessReviewMode({ classification: "empty_or_placeholder", recommendedAction: null })).toBe("parser_or_access");
    expect(inferAccessReviewMode({ classification: "unknown", recommendedAction: "update_registry_url" })).toBe("registry_url");
  });

  it("builds a focused access review packet for unhealthy sources that need human or production-network verification", () => {
    const packet = buildSourceHealthAccessReviewPacket(reportWith([
      baseSource,
      {
        ...baseSource,
        stateCode: "TX",
        sourceId: "tx_esbd",
        label: "Texas ESBD",
        classification: "login_required",
        recommendedAction: "browser_or_access_review",
        disposition: "vendor_account_review",
      },
      {
        ...baseSource,
        stateCode: "WA",
        sourceId: "wa_ok",
        label: "Washington Healthy",
        status: "healthy",
        classification: "ok",
        operationalSeverity: "none",
        recommendedAction: "none",
      },
    ]), {
      now: () => generatedAt,
    });

    expect(packet.summary).toMatchObject({
      totalSources: 3,
      reviewSources: 2,
      browserAccess: 1,
      vendorAccount: 1,
      longTimeoutRetry: 0,
      networkTls: 0,
      registryUrl: 0,
    });
    expect(packet.entries).toHaveLength(2);
    expect(packet.entries[0]).toMatchObject({
      stateCode: "CA",
      sourceId: "ca_caleprocure",
      url: "https://caleprocure.ca.gov/",
      reviewMode: "browser_access",
      requiredEvidence: expect.arrayContaining([
        "Browser open result from production-like network",
        "Screenshot or external ticket reference, not raw credentials",
      ]),
    });
    expect(packet.entries[1]).toMatchObject({
      stateCode: "TX",
      reviewMode: "vendor_account",
      requiredEvidence: expect.arrayContaining([
        "Vendor-account requirement confirmed or rejected",
      ]),
    });
  });

  it("filters by review mode and formats markdown/json/csv without leaking credential-like evidence", () => {
    const packet = buildSourceHealthAccessReviewPacket(reportWith([
      baseSource,
      {
        ...baseSource,
        stateCode: "NY",
        sourceId: "ny_timeout",
        classification: "timeout",
        recommendedAction: "retry_or_increase_timeout",
        reason: "timeout token=super-secret-token",
      },
    ]), {
      modes: ["long_timeout_retry"],
      now: () => generatedAt,
    });

    expect(packet.entries).toHaveLength(1);
    expect(packet.entries[0].reviewMode).toBe("long_timeout_retry");

    const serialized = [
      formatSourceHealthAccessReviewPacket(packet, "markdown"),
      formatSourceHealthAccessReviewPacket(packet, "json"),
      formatSourceHealthAccessReviewPacket(packet, "csv"),
    ].join("\n");

    expect(serialized).toContain("Source Health Access Review");
    expect(serialized).toContain("https://caleprocure.ca.gov/");
    expect(serialized).toContain("token=[REDACTED]");
    expect(serialized).not.toContain("super-secret-token");
    expect(serialized).not.toContain("secret-session");
  });

  it("parses CLI args and registers the npm script", () => {
    expect(parseSourceHealthAccessReviewArgs([
      "--format=json",
      "--output=reports/source-health-access-review.json",
      "--mode=browser_access,vendor_account",
      "--owner=source-ops@example.com",
    ])).toEqual({
      format: "json",
      help: false,
      modes: ["browser_access", "vendor_account"],
      output: "reports/source-health-access-review.json",
      owner: "source-ops@example.com",
    });

    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["source:health:access-review"]).toBe("tsx scripts/source-health-access-review.ts");
  });
});
