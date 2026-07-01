import { describe, expect, it } from "vitest";
import {
  formatProductionReadinessSummary,
  validateProductionReadiness,
} from "./production-readiness";

const validEnv = {
  NODE_ENV: "production",
  BILLING_PROVIDER: "stripe",
  STRIPE_SECRET_KEY: "sk_live_secret_123",
  STRIPE_WEBHOOK_SECRET: "whsec_live_123",
  STRIPE_PRICE_PRO_MONTHLY: "price_live_pro",
  STRIPE_PRICE_BUSINESS_MONTHLY: "price_live_business",
  DATABASE_URL: "mysql://user:pass@db.example.com:3306/winbids",
  NOTIFICATION_PROVIDER: "http",
  NOTIFICATION_HTTP_ENDPOINT: "https://notifications.example.com/send",
  PRODUCTION_OWNER_BILLING: "finance@example.com",
  PRODUCTION_OWNER_WORKERS: "ops@example.com",
  PRODUCTION_OWNER_BACKUPS: "infra@example.com",
  PRODUCTION_BACKUP_RUNBOOK_URL: "https://docs.example.com/winbids/backups",
  PRODUCTION_BACKUP_EVIDENCE_URL: "https://docs.example.com/winbids/evidence/backup-2026-06-10",
  PRODUCTION_RESTORE_EVIDENCE_URL: "https://docs.example.com/winbids/evidence/restore-2026-06-10",
  PRODUCTION_BACKUP_EVIDENCE_TIMESTAMP: "2026-06-10T09:30:00.000Z",
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
  OBJECT_STORAGE_STAGING_SMOKE_EVIDENCE_URL: "https://docs.example.com/winbids/evidence/storage-smoke-2026-06-10",
};

describe("production readiness preflight", () => {
  it("accepts production billing, MySQL runtime, and ownership handoff fields", () => {
    expect(validateProductionReadiness(validEnv)).toMatchObject({
      ok: true,
      billing: { ok: true, provider: "stripe", database: "mysql", stripeMode: "live" },
      workers: { database: "mysql", notificationProvider: "http" },
      objectStorage: { provider: "s3" },
      ownership: {
        billing: "configured",
        workers: "configured",
        backups: "configured",
        backupRunbook: "configured",
      },
      evidence: {
        backup: "configured",
        restore: "configured",
        backupTimestamp: "configured",
      },
    });
  });

  it("rejects missing production owners, backup runbook, and backup evidence", () => {
    expect(() =>
      validateProductionReadiness({
        ...validEnv,
        PRODUCTION_OWNER_WORKERS: "",
        PRODUCTION_BACKUP_RUNBOOK_URL: "",
        PRODUCTION_BACKUP_EVIDENCE_URL: "",
      }),
    ).toThrow(/PRODUCTION_OWNER_WORKERS is required; PRODUCTION_BACKUP_RUNBOOK_URL is required; PRODUCTION_BACKUP_EVIDENCE_URL is required/);
  });

  it("rejects a backup runbook that is not an http or https URL", () => {
    expect(() =>
      validateProductionReadiness({
        ...validEnv,
        PRODUCTION_BACKUP_RUNBOOK_URL: "file:///runbook.md",
      }),
    ).toThrow(/PRODUCTION_BACKUP_RUNBOOK_URL must be an http or https URL/);
  });

  it("rejects missing restore evidence and invalid backup evidence timestamps in staging", () => {
    expect(() =>
      validateProductionReadiness({
        ...validEnv,
        NODE_ENV: "staging",
        PRODUCTION_RESTORE_EVIDENCE_URL: "",
        PRODUCTION_BACKUP_EVIDENCE_TIMESTAMP: "June 10",
      }),
    ).toThrow(/PRODUCTION_RESTORE_EVIDENCE_URL is required; PRODUCTION_BACKUP_EVIDENCE_TIMESTAMP must be an ISO-8601 timestamp/);
  });

  it("blocks production readiness when the notification provider is a local fallback", () => {
    expect(() =>
      validateProductionReadiness({
        ...validEnv,
        NOTIFICATION_PROVIDER: "file",
      }),
    ).toThrow(/NOTIFICATION_PROVIDER=file is a local\/dev fallback and cannot be used for production or staging launch/);
  });

  it("blocks production readiness when object storage resolves to local without an explicit production override", () => {
    expect(() =>
      validateProductionReadiness({
        ...validEnv,
        OBJECT_STORAGE_PROVIDER: "local",
        PRODUCTION_ALLOW_LOCAL_OBJECT_STORAGE: "",
      }),
    ).toThrow(/OBJECT_STORAGE_PROVIDER=local is a local\/dev fallback and cannot be used for production or staging launch/);
  });

  it("allows local object storage in production only when explicitly acknowledged", () => {
    expect(validateProductionReadiness({
      ...validEnv,
      OBJECT_STORAGE_PROVIDER: "local",
      PRODUCTION_ALLOW_LOCAL_OBJECT_STORAGE: "1",
    })).toMatchObject({
      ok: true,
      objectStorage: {
        provider: "local",
        localAllowedByOverride: true,
      },
    });
  });

  it("blocks S3-compatible object storage readiness when required configuration is missing", () => {
    expect(() =>
      validateProductionReadiness({
        ...validEnv,
        OBJECT_STORAGE_PROVIDER: "s3",
        OBJECT_STORAGE_BUCKET: "",
        OBJECT_STORAGE_REGION: "",
        OBJECT_STORAGE_BASE_URL: "",
        OBJECT_STORAGE_CREDENTIALS_REF: "",
      }),
    ).toThrow(/OBJECT_STORAGE_BUCKET is required when OBJECT_STORAGE_PROVIDER=s3; OBJECT_STORAGE_REGION is required when OBJECT_STORAGE_PROVIDER=s3; OBJECT_STORAGE_BASE_URL is required when OBJECT_STORAGE_PROVIDER=s3; OBJECT_STORAGE_CREDENTIALS_REF is required when OBJECT_STORAGE_PROVIDER=s3/);
  });

  it("blocks production readiness when the worker database runtime resolves to SQLite", () => {
    expect(() =>
      validateProductionReadiness({
        ...validEnv,
        DATABASE_URL: "sqlite://data/prod.sqlite",
        MYSQL_DATABASE_URL: "mysql://user:pass@db.example.com:3306/winbids",
      }),
    ).toThrow(/DATABASE_URL resolves to SQLite; production and staging worker runtimes must use DATABASE_URL or MYSQL_DATABASE_URL with mysql:\/\/ or mysql2:\/\//);
  });

  it("does not expose secret values in summaries or validation errors", () => {
    const summary = formatProductionReadinessSummary(validateProductionReadiness(validEnv));
    expect(summary).toContain("productionReadiness=ok");
    expect(summary).toContain("PRODUCTION_OWNER_BILLING=configured");
    expect(summary).toContain("PRODUCTION_BACKUP_EVIDENCE_URL=configured");
    expect(summary).toContain("PRODUCTION_RESTORE_EVIDENCE_URL=configured");
    expect(summary).toContain("PRODUCTION_BACKUP_EVIDENCE_TIMESTAMP=configured");
    expect(summary).toContain("objectStorageProvider=s3");
    expect(summary).toContain("OBJECT_STORAGE_PUBLIC_ACCESS=private");
    expect(summary).toContain("OBJECT_STORAGE_SIGNED_URL_MODE=configured");
    expect(summary).toContain("OBJECT_STORAGE_CDN_URL=configured");
    expect(summary).toContain("OBJECT_STORAGE_MALWARE_SCANNER=configured");
    expect(summary).toContain("OBJECT_STORAGE_RETENTION_POLICY=configured");
    expect(summary).toContain("OBJECT_STORAGE_STAGING_SMOKE_EVIDENCE_URL=configured");
    expect(summary).not.toContain("sk_live_secret_123");
    expect(summary).not.toContain("whsec_live_123");
    expect(summary).not.toContain("aws-secrets-manager:prod/object-storage");
    expect(summary).not.toContain("https://docs.example.com/winbids/evidence");
    expect(summary).not.toContain("https://artifacts.example.com");

    try {
      validateProductionReadiness({
        ...validEnv,
        BILLING_PROVIDER: "local",
        STRIPE_SECRET_KEY: "sk_test_secret_123",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("sk_test_secret_123");
      expect(message).not.toContain("whsec_live_123");
      return;
    }

    throw new Error("Expected validation to fail");
  });
});
