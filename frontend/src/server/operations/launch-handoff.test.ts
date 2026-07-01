import { describe, expect, it } from "vitest";
import {
  buildLaunchHandoffReport,
  formatLaunchHandoffMarkdown,
} from "./launch-handoff";

const generatedAt = "2026-06-13T00:00:00.000Z";

const readyEnv = {
  NODE_ENV: "production",
  BILLING_PROVIDER: "stripe",
  STRIPE_SECRET_KEY: "sk_live_prod_123",
  STRIPE_WEBHOOK_SECRET: "whsec_prod_123",
  STRIPE_PRICE_PRO_MONTHLY: "price_live_pro",
  STRIPE_PRICE_BUSINESS_MONTHLY: "price_live_business",
  DATABASE_URL: "mysql://user:pass@db.example.com:3306/winbids",
  NOTIFICATION_PROVIDER: "http",
  NOTIFICATION_HTTP_ENDPOINT: "https://notifications.example.com/send",
  PRODUCTION_OWNER_BILLING: "finance@example.com",
  PRODUCTION_OWNER_WORKERS: "ops@example.com",
  PRODUCTION_OWNER_BACKUPS: "infra@example.com",
  PRODUCTION_BACKUP_RUNBOOK_URL: "https://docs.example.com/winbids/backups",
  PRODUCTION_BACKUP_EVIDENCE_URL: "https://docs.example.com/winbids/evidence/backup",
  PRODUCTION_RESTORE_EVIDENCE_URL: "https://docs.example.com/winbids/evidence/restore",
  PRODUCTION_BACKUP_EVIDENCE_TIMESTAMP: "2026-06-13T00:00:00.000Z",
  OBJECT_STORAGE_PROVIDER: "s3",
  OBJECT_STORAGE_BUCKET: "prod-artifacts",
  OBJECT_STORAGE_REGION: "us-east-1",
  OBJECT_STORAGE_BASE_URL: "https://s3.us-east-1.amazonaws.com",
  OBJECT_STORAGE_CREDENTIALS_REF: "aws-secrets-manager:prod/object-storage",
  OBJECT_STORAGE_PUBLIC_ACCESS: "private",
  OBJECT_STORAGE_SIGNED_URL_MODE: "cloudfront-signed",
  OBJECT_STORAGE_CDN_URL: "https://artifacts.example.com",
  OBJECT_STORAGE_MALWARE_SCANNER: "external",
  OBJECT_STORAGE_RETENTION_POLICY: "standard_business_record",
  OBJECT_STORAGE_STAGING_SMOKE_EVIDENCE_URL: "https://docs.example.com/winbids/evidence/storage-smoke",
  STRIPE_SANDBOX_SECRET_KEY: "sk_test_sandbox_123",
  STRIPE_SANDBOX_WEBHOOK_SECRET: "whsec_sandbox_123",
  STRIPE_SANDBOX_PRICE_PRO_MONTHLY: "price_test_pro",
  STRIPE_SANDBOX_PRICE_BUSINESS_MONTHLY: "price_test_business",
  AWS_STAGING_OWNER: "release@example.com",
  AWS_STAGING_DRY_RUN_EVIDENCE_URL: "https://docs.example.com/winbids/evidence/aws-dry-run",
  AWS_STAGING_DEPLOYMENT_URL: "https://staging.example.com",
  AWS_STAGING_RELEASE_SHA: "abc123",
  SOURCE_HEALTH_OWNER: "source-ops@example.com",
  SOURCE_HEALTH_OPS_EVIDENCE_URL: "https://docs.example.com/winbids/evidence/source-health",
  SOURCE_HEALTH_ACCESS_REVIEW_URL: "https://docs.example.com/winbids/evidence/source-health-access-review",
  DEMO_BROWSER_EVIDENCE_URL: "https://docs.example.com/winbids/evidence/browser",
  RISK_CHECK_EVIDENCE_URL: "https://docs.example.com/winbids/evidence/risk",
};

describe("launch handoff report", () => {
  const readySourceHealthEvidence = JSON.stringify({
    ok: true,
    readiness: {
      observedStateCount: 50,
      expectedStateCount: 50,
      staleSnapshot: false,
      unhealthySources: 29,
      criticalUnhealthy: 0,
      unassignedUnhealthy: 0,
      missingDisposition: 0,
      missingNextReview: 0,
      overdueNextReview: 0,
    },
    blockers: [],
  });
  const readyAccessReviewPacket = JSON.stringify({
    summary: {
      totalSources: 50,
      reviewSources: 29,
      browserAccess: 8,
      vendorAccount: 11,
      longTimeoutRetry: 6,
      networkTls: 2,
      registryUrl: 0,
      portalStatus: 1,
      parserOrAccess: 1,
      manualReview: 0,
    },
    entries: Array.from({ length: 29 }, (_, index) => ({
      stateCode: index === 0 ? "CA" : "TX",
      sourceId: index === 0 ? "ca_caleprocure" : `tx_esbd_${index}`,
      reviewMode: index === 0 ? "browser_access" : "vendor_account",
      owner: "source-ops@example.com",
      requiredEvidence: [
        "Browser open result from production-like network",
        "Screenshot or external ticket reference, not raw credentials",
      ],
    })),
  });

  it("marks every launch track ready when external evidence and safe configuration markers exist", () => {
    const report = buildLaunchHandoffReport(readyEnv, { now: () => generatedAt });

    expect(report.ok).toBe(true);
    expect(report.generatedAt).toBe(generatedAt);
    expect(report.summary).toEqual({ total: 6, ready: 6, blocked: 0 });
    expect(report.tracks.map((track) => `${track.id}:${track.status}`)).toEqual([
      "stripe_sandbox:ready",
      "production_preflight:ready",
      "aws_staging_dry_run:ready",
      "live_source_health_ops:ready",
      "browser_demo_evidence:ready",
      "risk_gate:ready",
    ]);
  });

  it("validates local source-health evidence file content before marking source track ready", () => {
    const report = buildLaunchHandoffReport({
      ...readyEnv,
      SOURCE_HEALTH_OPS_EVIDENCE_URL: "",
      SOURCE_HEALTH_OPS_EVIDENCE_FILE: "/evidence/source-health.json",
      SOURCE_HEALTH_ACCESS_REVIEW_URL: "",
      SOURCE_HEALTH_ACCESS_REVIEW_FILE: "/evidence/source-health-access-review.json",
    }, {
      now: () => generatedAt,
      readFile: (filePath) => {
        expect(["/evidence/source-health.json", "/evidence/source-health-access-review.json"]).toContain(filePath);
        if (filePath === "/evidence/source-health-access-review.json") return readyAccessReviewPacket;
        return readySourceHealthEvidence;
      },
    });

    expect(report.tracks.find((track) => track.id === "live_source_health_ops")).toMatchObject({
      status: "ready",
      blockers: [],
    });
  });

  it("requires access-review evidence for source-health launch handoff", () => {
    const report = buildLaunchHandoffReport({
      ...readyEnv,
      SOURCE_HEALTH_OPS_EVIDENCE_URL: "",
      SOURCE_HEALTH_OPS_EVIDENCE_FILE: "/evidence/source-health.json",
      SOURCE_HEALTH_ACCESS_REVIEW_URL: "",
      SOURCE_HEALTH_ACCESS_REVIEW_FILE: "",
    }, {
      now: () => generatedAt,
      readFile: () => readySourceHealthEvidence,
    });

    expect(report.tracks.find((track) => track.id === "live_source_health_ops")?.blockers).toContain(
      "Live source health access review requires one of: SOURCE_HEALTH_ACCESS_REVIEW_URL, SOURCE_HEALTH_ACCESS_REVIEW_FILE",
    );
  });

  it("blocks local access-review files that are missing, malformed, or incomplete", () => {
    const missing = buildLaunchHandoffReport({
      ...readyEnv,
      SOURCE_HEALTH_OPS_EVIDENCE_URL: "",
      SOURCE_HEALTH_OPS_EVIDENCE_FILE: "/evidence/source-health.json",
      SOURCE_HEALTH_ACCESS_REVIEW_URL: "",
      SOURCE_HEALTH_ACCESS_REVIEW_FILE: "/missing/access-review.json",
    }, {
      now: () => generatedAt,
      readFile: (filePath) => {
        if (filePath === "/evidence/source-health.json") return readySourceHealthEvidence;
        throw new Error("ENOENT");
      },
    });

    expect(missing.tracks.find((track) => track.id === "live_source_health_ops")?.blockers).toContain(
      "SOURCE_HEALTH_ACCESS_REVIEW_FILE could not be read",
    );

    const malformed = buildLaunchHandoffReport({
      ...readyEnv,
      SOURCE_HEALTH_OPS_EVIDENCE_URL: "",
      SOURCE_HEALTH_OPS_EVIDENCE_FILE: "/evidence/source-health.json",
      SOURCE_HEALTH_ACCESS_REVIEW_URL: "",
      SOURCE_HEALTH_ACCESS_REVIEW_FILE: "/bad/access-review.json",
    }, {
      now: () => generatedAt,
      readFile: (filePath) => filePath === "/evidence/source-health.json" ? readySourceHealthEvidence : "{bad-json",
    });

    expect(malformed.tracks.find((track) => track.id === "live_source_health_ops")?.blockers).toContain(
      "SOURCE_HEALTH_ACCESS_REVIEW_FILE must contain valid JSON",
    );

    const incomplete = buildLaunchHandoffReport({
      ...readyEnv,
      SOURCE_HEALTH_OPS_EVIDENCE_URL: "",
      SOURCE_HEALTH_OPS_EVIDENCE_FILE: "/evidence/source-health.json",
      SOURCE_HEALTH_ACCESS_REVIEW_URL: "",
      SOURCE_HEALTH_ACCESS_REVIEW_FILE: "/incomplete/access-review.json",
    }, {
      now: () => generatedAt,
      readFile: (filePath) => filePath === "/evidence/source-health.json"
        ? readySourceHealthEvidence
        : JSON.stringify({
            summary: {
              totalSources: 50,
              reviewSources: 1,
            },
            entries: [
              {
                stateCode: "CA",
                sourceId: "ca_caleprocure",
                owner: "source-ops@example.com",
                requiredEvidence: [],
              },
            ],
          }),
    });

    expect(incomplete.tracks.find((track) => track.id === "live_source_health_ops")?.blockers).toEqual(
      expect.arrayContaining([
        "SOURCE_HEALTH_ACCESS_REVIEW_FILE covers 1/29 unhealthy source review(s).",
        "SOURCE_HEALTH_ACCESS_REVIEW_FILE entry ca_caleprocure is missing reviewMode.",
        "SOURCE_HEALTH_ACCESS_REVIEW_FILE entry ca_caleprocure is missing requiredEvidence.",
      ]),
    );
  });

  it("blocks local source-health evidence files that are missing, malformed, or not ready", () => {
    const missing = buildLaunchHandoffReport({
      ...readyEnv,
      SOURCE_HEALTH_OPS_EVIDENCE_URL: "",
      SOURCE_HEALTH_OPS_EVIDENCE_FILE: "/missing/source-health.json",
    }, {
      now: () => generatedAt,
      readFile: () => {
        throw new Error("ENOENT: no such file or directory");
      },
    });

    expect(missing.tracks.find((track) => track.id === "live_source_health_ops")?.blockers).toEqual([
      "SOURCE_HEALTH_OPS_EVIDENCE_FILE could not be read",
    ]);

    const malformed = buildLaunchHandoffReport({
      ...readyEnv,
      SOURCE_HEALTH_OPS_EVIDENCE_URL: "",
      SOURCE_HEALTH_OPS_EVIDENCE_FILE: "/bad/source-health.json",
    }, {
      now: () => generatedAt,
      readFile: () => "{not-json",
    });

    expect(malformed.tracks.find((track) => track.id === "live_source_health_ops")?.blockers).toEqual([
      "SOURCE_HEALTH_OPS_EVIDENCE_FILE must contain valid JSON",
    ]);

    const blocked = buildLaunchHandoffReport({
      ...readyEnv,
      SOURCE_HEALTH_OPS_EVIDENCE_URL: "",
      SOURCE_HEALTH_OPS_EVIDENCE_FILE: "/blocked/source-health.json",
    }, {
      now: () => generatedAt,
      readFile: () => JSON.stringify({
        ok: false,
        readiness: {
          observedStateCount: 50,
          expectedStateCount: 50,
          staleSnapshot: false,
          criticalUnhealthy: 0,
          unassignedUnhealthy: 1,
          missingDisposition: 1,
          missingNextReview: 1,
          overdueNextReview: 0,
        },
        blockers: ["1 unhealthy source(s) are missing an owner."],
      }),
    });

    expect(blocked.tracks.find((track) => track.id === "live_source_health_ops")?.blockers).toEqual([
      "SOURCE_HEALTH_OPS_EVIDENCE_FILE is not ready: 1 unhealthy source(s) are missing an owner.",
      "SOURCE_HEALTH_OPS_EVIDENCE_FILE readiness has 1 unassigned unhealthy source(s).",
      "SOURCE_HEALTH_OPS_EVIDENCE_FILE readiness has 1 source(s) missing disposition.",
      "SOURCE_HEALTH_OPS_EVIDENCE_FILE readiness has 1 source(s) missing next-review.",
    ]);
  });

  it("returns actionable blockers and commands when external credentials or evidence are missing", () => {
    const report = buildLaunchHandoffReport({}, { now: () => generatedAt });
    const markdown = formatLaunchHandoffMarkdown(report);

    expect(report.ok).toBe(false);
    expect(report.summary).toEqual({ total: 6, ready: 0, blocked: 6 });
    expect(markdown).toContain("Launch handoff BLOCKED");
    expect(markdown).toContain("npm run billing:stripe:sandbox -- --tier=pro");
    expect(markdown).toContain("NODE_ENV=production npm run ops:production:check");
    expect(markdown).toContain("npm run source:health:ops");
    expect(markdown).toContain("npm run demo:browser-evidence");
    expect(markdown).toContain("npm run risk:check");
  });

  it("never exposes secret values in markdown or JSON output", () => {
    const report = buildLaunchHandoffReport({
      ...readyEnv,
      STRIPE_SANDBOX_SECRET_KEY: "sk_live_should_not_print",
      STRIPE_SANDBOX_WEBHOOK_SECRET: "whsec_should_not_print",
      DATABASE_URL: "mysql://user:very-secret-password@db.example.com:3306/winbids",
      AWS_SECRET_ACCESS_KEY: "aws-secret-access-key",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "object-storage-secret",
    }, { now: () => generatedAt });
    const serialized = `${formatLaunchHandoffMarkdown(report)}\n${JSON.stringify(report)}`;

    expect(serialized).not.toContain("sk_live_should_not_print");
    expect(serialized).not.toContain("whsec_should_not_print");
    expect(serialized).not.toContain("very-secret-password");
    expect(serialized).not.toContain("aws-secret-access-key");
    expect(serialized).not.toContain("object-storage-secret");
    expect(serialized).toContain("STRIPE_SANDBOX_SECRET_KEY must be a Stripe test mode secret key");
  });
});
