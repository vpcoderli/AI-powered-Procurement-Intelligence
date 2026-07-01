import {
  formatProductionBillingPreflightSummary,
  validateProductionBillingPreflight,
  type ProductionBillingPreflightResult,
} from "@/server/billing/production-preflight";
import {
  validateObjectStoragePreflight,
  type ObjectStoragePreflightResult,
} from "@/server/storage/object-storage";

type ProductionReadinessEnv = Record<string, string | undefined>;

export interface ProductionReadinessResult {
  ok: true;
  billing: ProductionBillingPreflightResult;
  workers: {
    database: "mysql" | "sqlite";
    notificationProvider: "file" | "console" | "http";
    strictMode: boolean;
  };
  objectStorage: ObjectStoragePreflightResult;
  ownership: {
    billing: "configured";
    workers: "configured";
    backups: "configured";
    backupRunbook: "configured";
  };
  evidence: {
    backup: "configured";
    restore: "configured";
    backupTimestamp: "configured";
  };
  warnings: string[];
}

const requiredOwnerKeys = [
  "PRODUCTION_OWNER_BILLING",
  "PRODUCTION_OWNER_WORKERS",
  "PRODUCTION_OWNER_BACKUPS",
  "PRODUCTION_BACKUP_RUNBOOK_URL",
] as const;

const requiredEvidenceKeys = [
  "PRODUCTION_BACKUP_EVIDENCE_URL",
  "PRODUCTION_RESTORE_EVIDENCE_URL",
  "PRODUCTION_BACKUP_EVIDENCE_TIMESTAMP",
] as const;

function value(env: ProductionReadinessEnv, key: string) {
  return env[key]?.trim() ?? "";
}

const productionLikeValues = new Set(["production", "prod", "staging"]);
const notificationProviders = new Set(["file", "console", "http"]);

function isProductionLikeWorkerRuntime(env: ProductionReadinessEnv) {
  return [
    value(env, "NODE_ENV"),
    value(env, "APP_ENV"),
    value(env, "DEPLOY_ENV"),
    value(env, "VERCEL_ENV"),
    value(env, "RUNTIME_ENV"),
  ].some((raw) => productionLikeValues.has(raw.toLowerCase()));
}

function resolvedDatabaseUrl(env: ProductionReadinessEnv) {
  return value(env, "DATABASE_URL") || value(env, "MYSQL_DATABASE_URL");
}

function mysqlDatabaseRuntimeConfigured(env: ProductionReadinessEnv) {
  return /^mysql2?:\/\//.test(resolvedDatabaseUrl(env));
}

function sqliteResolutionMessage(env: ProductionReadinessEnv) {
  if (value(env, "DATABASE_URL") && !/^mysql2?:\/\//.test(value(env, "DATABASE_URL"))) {
    return "DATABASE_URL resolves to SQLite; production and staging worker runtimes must use DATABASE_URL or MYSQL_DATABASE_URL with mysql:// or mysql2://";
  }
  if (value(env, "MYSQL_DATABASE_URL") && !/^mysql2?:\/\//.test(value(env, "MYSQL_DATABASE_URL"))) {
    return "MYSQL_DATABASE_URL resolves to SQLite; production and staging worker runtimes must use DATABASE_URL or MYSQL_DATABASE_URL with mysql:// or mysql2://";
  }
  return "DATABASE_URL or MYSQL_DATABASE_URL must use mysql:// or mysql2:// for production and staging worker runtimes";
}

function validateProductionWorkerPreflight(
  env: ProductionReadinessEnv,
  errors: string[],
): ProductionReadinessResult["workers"] {
  const strictMode = isProductionLikeWorkerRuntime(env);
  const provider = (value(env, "NOTIFICATION_PROVIDER") || "file").toLowerCase();

  if (!notificationProviders.has(provider)) {
    errors.push("NOTIFICATION_PROVIDER must be file, console, or http");
  }

  if (strictMode && !mysqlDatabaseRuntimeConfigured(env)) {
    errors.push(sqliteResolutionMessage(env));
  }

  if (strictMode && (provider === "file" || provider === "console")) {
    errors.push(
      `NOTIFICATION_PROVIDER=${provider} is a local/dev fallback and cannot be used for production or staging launch; set NOTIFICATION_PROVIDER=http`,
    );
  }

  return {
    database: mysqlDatabaseRuntimeConfigured(env) ? "mysql" : "sqlite",
    notificationProvider: notificationProviders.has(provider)
      ? provider as "file" | "console" | "http"
      : "file",
    strictMode,
  };
}

function validateHttpUrl(raw: string, key: string, errors: string[]) {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) {
      errors.push(`${key} must be an http or https URL`);
    }
  } catch {
    errors.push(`${key} must be a valid URL`);
  }
}

function validateIsoTimestamp(raw: string, key: string, errors: string[]) {
  const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!isoTimestampPattern.test(raw) || Number.isNaN(Date.parse(raw))) {
    errors.push(`${key} must be an ISO-8601 timestamp`);
  }
}

export function validateProductionReadiness(env: ProductionReadinessEnv = process.env): ProductionReadinessResult {
  const errors: string[] = [];
  let billing: ProductionBillingPreflightResult | undefined;
  let objectStorage: ObjectStoragePreflightResult | undefined;

  try {
    billing = validateProductionBillingPreflight(env);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const workers = validateProductionWorkerPreflight(env, errors);

  try {
    objectStorage = validateObjectStoragePreflight(env, { strictMode: workers.strictMode });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  for (const key of requiredOwnerKeys) {
    if (!value(env, key)) {
      errors.push(`${key} is required`);
    }
  }

  for (const key of requiredEvidenceKeys) {
    if (!value(env, key)) {
      errors.push(`${key} is required`);
    }
  }

  if (value(env, "PRODUCTION_BACKUP_RUNBOOK_URL")) {
    validateHttpUrl(value(env, "PRODUCTION_BACKUP_RUNBOOK_URL"), "PRODUCTION_BACKUP_RUNBOOK_URL", errors);
  }

  if (value(env, "PRODUCTION_BACKUP_EVIDENCE_URL")) {
    validateHttpUrl(value(env, "PRODUCTION_BACKUP_EVIDENCE_URL"), "PRODUCTION_BACKUP_EVIDENCE_URL", errors);
  }

  if (value(env, "PRODUCTION_RESTORE_EVIDENCE_URL")) {
    validateHttpUrl(value(env, "PRODUCTION_RESTORE_EVIDENCE_URL"), "PRODUCTION_RESTORE_EVIDENCE_URL", errors);
  }

  if (value(env, "PRODUCTION_BACKUP_EVIDENCE_TIMESTAMP")) {
    validateIsoTimestamp(
      value(env, "PRODUCTION_BACKUP_EVIDENCE_TIMESTAMP"),
      "PRODUCTION_BACKUP_EVIDENCE_TIMESTAMP",
      errors,
    );
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  if (!billing) {
    throw new Error("Production billing preflight did not return a result.");
  }
  if (!objectStorage) {
    throw new Error("Object storage preflight did not return a result.");
  }

  return {
    ok: true,
    billing,
    workers,
    objectStorage,
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
    warnings: billing.warnings,
  };
}

export function formatProductionReadinessSummary(result: ProductionReadinessResult) {
  return [
    "productionReadiness=ok",
    formatProductionBillingPreflightSummary(result.billing),
    `workerDatabase=${result.workers.database}`,
    `notificationProvider=${result.workers.notificationProvider}`,
    `workerStrictMode=${result.workers.strictMode}`,
    `objectStorageProvider=${result.objectStorage.provider}`,
    `objectStorageStrictMode=${result.objectStorage.strictMode}`,
    `objectStorageLocalOverride=${result.objectStorage.localAllowedByOverride}`,
    ...(result.objectStorage.s3
      ? [
        "OBJECT_STORAGE_BUCKET=configured",
        "OBJECT_STORAGE_REGION=configured",
        "OBJECT_STORAGE_BASE_URL=configured",
        "OBJECT_STORAGE_CREDENTIALS_REF=configured",
        ...(result.objectStorage.s3.publicAccess ? ["OBJECT_STORAGE_PUBLIC_ACCESS=private"] : []),
        ...(result.objectStorage.s3.signedUrlMode ? ["OBJECT_STORAGE_SIGNED_URL_MODE=configured"] : []),
        ...(result.objectStorage.s3.cdnUrl ? ["OBJECT_STORAGE_CDN_URL=configured"] : []),
        ...(result.objectStorage.s3.malwareScanner ? ["OBJECT_STORAGE_MALWARE_SCANNER=configured"] : []),
        ...(result.objectStorage.s3.retentionPolicy ? ["OBJECT_STORAGE_RETENTION_POLICY=configured"] : []),
        ...(result.objectStorage.s3.stagingSmokeEvidence ? ["OBJECT_STORAGE_STAGING_SMOKE_EVIDENCE_URL=configured"] : []),
      ]
      : []),
    "PRODUCTION_OWNER_BILLING=configured",
    "PRODUCTION_OWNER_WORKERS=configured",
    "PRODUCTION_OWNER_BACKUPS=configured",
    "PRODUCTION_BACKUP_RUNBOOK_URL=configured",
    "PRODUCTION_BACKUP_EVIDENCE_URL=configured",
    "PRODUCTION_RESTORE_EVIDENCE_URL=configured",
    "PRODUCTION_BACKUP_EVIDENCE_TIMESTAMP=configured",
    `warnings=${result.warnings.length}`,
  ].join("\n");
}
