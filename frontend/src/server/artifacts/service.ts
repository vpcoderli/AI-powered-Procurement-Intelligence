import crypto from "node:crypto";
import path from "node:path";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { writeAuditEvent, writeAuditEventFromMysql } from "@/server/events/event-log";
import { getUserIntent } from "@/server/intents/service";
import { IntentNotFoundError } from "@/server/intents/types";
import { resolveMalwareScanner as resolveObjectStorageMalwareScanner } from "@/server/storage/malware-scan";
import { createObjectStorageProvider } from "@/server/storage/object-storage";
import {
  createArtifactVersionRow,
  createArtifactVersionRowFromMysql,
  createSupplierArtifactRow,
  createSupplierArtifactRowFromMysql,
  findSupplierArtifactRow,
  findSupplierArtifactRowFromMysql,
  listArtifactVersionRows,
  listArtifactVersionRowsFromMysql,
  listSupplierArtifactRows,
  listSupplierArtifactRowsFromMysql,
  maxArtifactVersionNumber,
  maxArtifactVersionNumberFromMysql,
  softDeleteSupplierArtifactRow,
  softDeleteSupplierArtifactRowFromMysql,
  updateSupplierArtifactManifestRow,
  updateSupplierArtifactManifestRowFromMysql,
  type ArtifactVersionRow,
  type SupplierArtifactRow,
} from "./repository";
import {
  isArtifactPurpose,
  isArtifactReviewStatus,
  isArtifactType,
  type ArtifactComputedStatus,
  type ArtifactRetentionPolicy,
  type ArtifactSecurityScanStatus,
  type ArtifactVault,
  type CreateSupplierArtifactInput,
  type ReplaceSupplierArtifactInput,
  type SupplierArtifact,
  type SupplierArtifactVersion,
} from "./types";

const MAX_TITLE_LENGTH = 180;
const MAX_NOTES_LENGTH = 2000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_RETENTION_POLICY: ArtifactRetentionPolicy = "standard_business_record";

export class ArtifactVaultValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactVaultValidationError";
  }
}

interface ArtifactServiceOptions {
  storageRoot?: string;
  now?: Date;
  malwareScanner?: ArtifactMalwareScanner;
}

interface ArtifactMalwareScanInput {
  fileName: string;
  contentType: string;
  bytes: Buffer;
}

interface ArtifactMalwareScanResult {
  status: ArtifactSecurityScanStatus;
  /**
   * Identifies which scanner produced this result, e.g. `"local/noop"` (dev
   * fallback, always clean) or `"heuristic-v1"` (file-type allowlist + size
   * limit; see `@/server/storage/malware-scan.ts`). Not a real AV engine
   * name unless a real scanner has been wired in via `options.malwareScanner`.
   */
  provider: string;
  signature?: string;
}

interface ArtifactMalwareScanner {
  scan(input: ArtifactMalwareScanInput): Promise<ArtifactMalwareScanResult>;
}

function nowIso(options: ArtifactServiceOptions = {}) {
  return (options.now ?? new Date()).toISOString();
}

function artifactStorageRoot(options: ArtifactServiceOptions = {}) {
  return options.storageRoot ?? path.join("data", "artifact-vault");
}

function sanitizeFileName(value: string) {
  const trimmed = value.trim().replace(/[\\/]/g, "-").replace(/\s+/g, " ");
  const safe = trimmed.replace(/[^A-Za-z0-9._ -]/g, "");
  return safe || "artifact.bin";
}

function normalizeText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string") {
    throw new ArtifactVaultValidationError(`${field} must be a string.`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new ArtifactVaultValidationError(`${field} is required.`);
  }

  return trimmed.slice(0, maxLength);
}

function normalizeOptionalText(value: unknown, field: string, maxLength: number) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new ArtifactVaultValidationError(`${field} must be a string.`);
  }

  return value.trim().slice(0, maxLength);
}

function normalizeExpiresAt(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new ArtifactVaultValidationError("Expiration date must be a string.");
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ArtifactVaultValidationError("Expiration date is invalid.");
  }

  return date.toISOString();
}

function computedStatus(row: Pick<SupplierArtifactRow, "expiresAt">, now: Date): ArtifactComputedStatus {
  return row.expiresAt && new Date(row.expiresAt).getTime() < now.getTime() ? "expired" : "active";
}

/**
 * Default artifact malware scanner. Delegates to the shared, pluggable
 * `resolveMalwareScanner` in `@/server/storage/malware-scan.ts`, which maps
 * `OBJECT_STORAGE_MALWARE_SCANNER` to a concrete implementation:
 *
 *  - unset / `local` / `local/noop` / `noop` / `none` -> a deterministic
 *    local/no-op scanner (dev-only; only blocks the hardcoded EICAR-style
 *    test signatures, otherwise always clean).
 *  - any other configured value (e.g. `external`) -> the heuristic scanner
 *    (file-type allowlist + size limit + the same test signatures), clearly
 *    labeled `engine: "heuristic-v1"` — not a real AV engine. See the module
 *    doc comment in `malware-scan.ts` for how to swap in ClamAV or an
 *    AWS-native S3 malware-scanning service later.
 *
 * `options.malwareScanner` still takes precedence for dependency injection
 * (tests, or a future real scanner wired in by the caller).
 */
function defaultMalwareScanner(): ArtifactMalwareScanner {
  const scanner = resolveObjectStorageMalwareScanner(process.env);

  return {
    async scan(input) {
      const result = await scanner.scan(input);
      return {
        status: result.status,
        provider: scanner.engine,
        signature: result.signature,
      };
    },
  };
}

function malwareScanner(options: ArtifactServiceOptions = {}) {
  return options.malwareScanner ?? defaultMalwareScanner();
}

function hydrateArtifactVersion(row: ArtifactVersionRow): SupplierArtifactVersion {
  return {
    id: row.id,
    artifactId: row.artifactId,
    versionNumber: row.versionNumber,
    title: row.title,
    fileName: row.fileName,
    contentType: row.contentType,
    byteSize: row.byteSize,
    storagePath: row.storagePath,
    storageProvider: row.storageProvider,
    checksumSha256: row.checksumSha256,
    securityScanStatus: row.securityScanStatus === "blocked" || row.securityScanStatus === "pending"
      ? row.securityScanStatus
      : "clean",
    retentionPolicy: row.retentionPolicy === "standard_business_record"
      ? row.retentionPolicy
      : DEFAULT_RETENTION_POLICY,
    replacementReason: row.replacementReason,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
  };
}

function attachVersionsToArtifacts(
  artifacts: SupplierArtifact[],
  versionRows: ArtifactVersionRow[],
) {
  const versionsByArtifactId = new Map<string, SupplierArtifactVersion[]>();

  for (const row of versionRows) {
    const versions = versionsByArtifactId.get(row.artifactId) ?? [];
    versions.push(hydrateArtifactVersion(row));
    versionsByArtifactId.set(row.artifactId, versions);
  }

  return artifacts.map((artifact) => ({
    ...artifact,
    versions: versionsByArtifactId.get(artifact.id) ?? [],
  }));
}

function downloadUrl(intentId: string, artifactId: string) {
  return `/api/intents/${encodeURIComponent(intentId)}/artifacts/${encodeURIComponent(artifactId)}`;
}

function hydrateArtifact(row: SupplierArtifactRow, now: Date): SupplierArtifact {
  if (!isArtifactType(row.artifactType)) {
    throw new Error("Invalid artifact field: artifactType");
  }
  if (!isArtifactPurpose(row.purpose)) {
    throw new Error("Invalid artifact field: purpose");
  }
  if (!isArtifactReviewStatus(row.reviewStatus)) {
    throw new Error("Invalid artifact field: reviewStatus");
  }

  return {
    id: row.id,
    userId: row.userId,
    intentId: row.intentId,
    bidId: row.bidId,
    title: row.title,
    artifactType: row.artifactType,
    purpose: row.purpose,
    fileName: row.fileName,
    contentType: row.contentType,
    byteSize: row.byteSize,
    storagePath: row.storagePath,
    checksumSha256: row.checksumSha256,
    expiresAt: row.expiresAt,
    reviewStatus: row.reviewStatus,
    computedStatus: computedStatus(row, now),
    securityScanStatus: "clean",
    retentionPolicy: DEFAULT_RETENTION_POLICY,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    downloadUrl: downloadUrl(row.intentId, row.id),
    versions: [],
  };
}

function buildVault(
  userId: string,
  intentId: string,
  bidId: string,
  rows: SupplierArtifactRow[],
  versionRows: ArtifactVersionRow[],
  now: Date,
): ArtifactVault {
  const artifacts = attachVersionsToArtifacts(
    rows.map((row) => hydrateArtifact(row, now)),
    versionRows,
  );

  return {
    intentId,
    bidId,
    userId,
    summary: {
      total: artifacts.length,
      active: artifacts.filter((artifact) => artifact.computedStatus === "active").length,
      expired: artifacts.filter((artifact) => artifact.computedStatus === "expired").length,
      pendingReview: artifacts.filter((artifact) => artifact.reviewStatus === "pending_review").length,
    },
    artifacts,
  };
}

async function listRows(database: AppDatabase, userId: string, intentId: string) {
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  return mysql
    ? listSupplierArtifactRowsFromMysql(mysql, userId, intentId)
    : listSupplierArtifactRows(database, userId, intentId);
}

async function listVersionRows(database: AppDatabase, userId: string, intentId: string) {
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  return mysql
    ? listArtifactVersionRowsFromMysql(mysql, userId, intentId)
    : listArtifactVersionRows(database, userId, intentId);
}

export async function getArtifactVault(
  database: AppDatabase,
  userId: string,
  intentId: string,
  options: ArtifactServiceOptions = {},
): Promise<ArtifactVault> {
  const intent = await getUserIntent(database, userId, intentId);

  if (!intent) {
    throw new IntentNotFoundError();
  }

  return buildVault(
    userId,
    intent.id,
    intent.bid.id,
    await listRows(database, userId, intent.id),
    await listVersionRows(database, userId, intent.id),
    options.now ?? new Date(),
  );
}

export async function createSupplierArtifact(
  database: AppDatabase,
  userId: string,
  intentId: string,
  input: CreateSupplierArtifactInput,
  options: ArtifactServiceOptions = {},
): Promise<ArtifactVault> {
  const intent = await getUserIntent(database, userId, intentId);

  if (!intent) {
    throw new IntentNotFoundError();
  }

  const title = normalizeText(input.title, "Artifact title", MAX_TITLE_LENGTH);
  if (!isArtifactType(input.artifactType)) {
    throw new ArtifactVaultValidationError("Unsupported artifact type.");
  }
  if (!isArtifactPurpose(input.purpose)) {
    throw new ArtifactVaultValidationError("Unsupported artifact purpose.");
  }
  if (!(input.file instanceof File)) {
    throw new ArtifactVaultValidationError("Artifact file is required.");
  }
  if (input.file.size <= 0) {
    throw new ArtifactVaultValidationError("Artifact file cannot be empty.");
  }
  if (input.file.size > MAX_FILE_BYTES) {
    throw new ArtifactVaultValidationError("Artifact file is too large.");
  }

  const id = `artifact_${crypto.randomUUID()}`;
  const timestamp = nowIso(options);
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const fileName = sanitizeFileName(input.file.name);
  const contentType = input.file.type || "application/octet-stream";
  const scanResult = await malwareScanner(options).scan({
    fileName,
    contentType,
    bytes,
  });

  if (scanResult.status === "blocked") {
    throw new ArtifactVaultValidationError("Artifact upload blocked by malware scan.");
  }

  const storage = createObjectStorageProvider({ localRoot: artifactStorageRoot(options) });
  const stored = await storage.putObject({
    key: [userId, intent.id, `${id}-${fileName}`],
    bytes,
    contentType,
  });

  const row = {
    id,
    intentId: intent.id,
    bidId: intent.bid.id,
    userId,
    title,
    artifactType: input.artifactType,
    purpose: input.purpose,
    fileName,
    contentType,
    byteSize: stored.byteSize,
    storagePath: stored.storagePath,
    checksumSha256: stored.checksumSha256,
    expiresAt: normalizeExpiresAt(input.expiresAt),
    reviewStatus: "pending_review",
    notes: normalizeOptionalText(input.notes, "Artifact notes", MAX_NOTES_LENGTH),
    deletedAt: null,
    deletedByUserId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies SupplierArtifactRow;

  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const versionRow = {
    id: `artifact_version_${crypto.randomUUID()}`,
    artifactId: id,
    intentId: intent.id,
    bidId: intent.bid.id,
    userId,
    versionNumber: 1,
    title,
    fileName,
    contentType,
    byteSize: stored.byteSize,
    storagePath: stored.storagePath,
    storageProvider: stored.provider,
    checksumSha256: stored.checksumSha256,
    securityScanStatus: scanResult.status,
    retentionPolicy: DEFAULT_RETENTION_POLICY,
    replacementReason: "",
    createdByUserId: userId,
    createdAt: timestamp,
  };

  if (mysql) {
    await createSupplierArtifactRowFromMysql(mysql, row);
    await createArtifactVersionRowFromMysql(mysql, versionRow);
  } else {
    createSupplierArtifactRow(database, row);
    createArtifactVersionRow(database, versionRow);
  }

  return getArtifactVault(database, userId, intent.id, options);
}

export async function replaceSupplierArtifact(
  database: AppDatabase,
  userId: string,
  intentId: string,
  artifactId: string,
  input: ReplaceSupplierArtifactInput,
  options: ArtifactServiceOptions = {},
): Promise<ArtifactVault> {
  const intent = await getUserIntent(database, userId, intentId);

  if (!intent) {
    throw new IntentNotFoundError();
  }

  if (!(input.file instanceof File)) {
    throw new ArtifactVaultValidationError("Replacement artifact file is required.");
  }
  if (input.file.size <= 0) {
    throw new ArtifactVaultValidationError("Replacement artifact file cannot be empty.");
  }
  if (input.file.size > MAX_FILE_BYTES) {
    throw new ArtifactVaultValidationError("Replacement artifact file is too large.");
  }

  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const existing = mysql
    ? await findSupplierArtifactRowFromMysql(mysql, userId, intent.id, artifactId)
    : findSupplierArtifactRow(database, userId, intent.id, artifactId);

  if (!existing) {
    throw new ArtifactVaultValidationError("Artifact is not available.");
  }

  const timestamp = nowIso(options);
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const fileName = sanitizeFileName(input.file.name);
  const contentType = input.file.type || "application/octet-stream";
  const title = input.title === undefined || input.title === null || input.title === ""
    ? existing.title
    : normalizeText(input.title, "Artifact title", MAX_TITLE_LENGTH);
  const notes = input.notes === undefined ? existing.notes : normalizeOptionalText(input.notes, "Artifact notes", MAX_NOTES_LENGTH);
  const expiresAt = input.expiresAt === undefined ? existing.expiresAt : normalizeExpiresAt(input.expiresAt);
  const replacementReason = normalizeOptionalText(input.replacementReason, "Replacement reason", MAX_NOTES_LENGTH);
  const scanResult = await malwareScanner(options).scan({
    fileName,
    contentType,
    bytes,
  });

  if (scanResult.status === "blocked") {
    throw new ArtifactVaultValidationError("Artifact replacement blocked by malware scan.");
  }

  const storage = createObjectStorageProvider({ localRoot: artifactStorageRoot(options) });
  const stored = await storage.putObject({
    key: [userId, intent.id, `${artifactId}-${timestamp.replace(/[^0-9A-Za-z]/g, "")}-${fileName}`],
    bytes,
    contentType,
  });
  const versionNumber = (mysql
    ? await maxArtifactVersionNumberFromMysql(mysql, userId, intent.id, artifactId)
    : maxArtifactVersionNumber(database, userId, intent.id, artifactId)) + 1;
  const versionRow = {
    id: `artifact_version_${crypto.randomUUID()}`,
    artifactId,
    intentId: intent.id,
    bidId: intent.bid.id,
    userId,
    versionNumber,
    title,
    fileName,
    contentType,
    byteSize: stored.byteSize,
    storagePath: stored.storagePath,
    storageProvider: stored.provider,
    checksumSha256: stored.checksumSha256,
    securityScanStatus: scanResult.status,
    retentionPolicy: DEFAULT_RETENTION_POLICY,
    replacementReason,
    createdByUserId: userId,
    createdAt: timestamp,
  };
  const manifestPatch = {
    title,
    fileName,
    contentType,
    byteSize: stored.byteSize,
    storagePath: stored.storagePath,
    checksumSha256: stored.checksumSha256,
    expiresAt,
    notes,
    updatedAt: timestamp,
  };

  if (mysql) {
    await createArtifactVersionRowFromMysql(mysql, versionRow);
    await updateSupplierArtifactManifestRowFromMysql(mysql, userId, intent.id, artifactId, manifestPatch);
    await writeAuditEventFromMysql(mysql, {
      eventName: "artifact.replaced",
      actorType: "user",
      actorId: userId,
      actorRole: "user",
      targetType: "supplier_artifact",
      targetId: artifactId,
      outcome: "success",
      severity: "info",
      source: "artifact.vault",
      occurredAt: timestamp,
      metadata: {
        intentId: intent.id,
        bidId: intent.bid.id,
        versionNumber,
        previousChecksumSha256: existing.checksumSha256,
        checksumSha256: stored.checksumSha256,
        hasReplacementReason: Boolean(replacementReason),
      },
      idempotencyKey: `artifact:${artifactId}:replaced:${timestamp}`,
    });
  } else {
    createArtifactVersionRow(database, versionRow);
    updateSupplierArtifactManifestRow(database, userId, intent.id, artifactId, manifestPatch);
    writeAuditEvent(database, {
      eventName: "artifact.replaced",
      actorType: "user",
      actorId: userId,
      actorRole: "user",
      targetType: "supplier_artifact",
      targetId: artifactId,
      outcome: "success",
      severity: "info",
      source: "artifact.vault",
      occurredAt: timestamp,
      metadata: {
        intentId: intent.id,
        bidId: intent.bid.id,
        versionNumber,
        previousChecksumSha256: existing.checksumSha256,
        checksumSha256: stored.checksumSha256,
        hasReplacementReason: Boolean(replacementReason),
      },
      idempotencyKey: `artifact:${artifactId}:replaced:${timestamp}`,
    });
  }

  return getArtifactVault(database, userId, intent.id, options);
}

export async function getSupplierArtifactFile(
  database: AppDatabase,
  userId: string,
  intentId: string,
  artifactId: string,
) {
  const intent = await getUserIntent(database, userId, intentId);

  if (!intent) {
    throw new IntentNotFoundError();
  }

  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const row = mysql
    ? await findSupplierArtifactRowFromMysql(mysql, userId, intent.id, artifactId)
    : findSupplierArtifactRow(database, userId, intent.id, artifactId);

  if (!row) {
    throw new ArtifactVaultValidationError("Artifact is not available.");
  }

  return hydrateArtifact(row, new Date());
}

export async function deleteSupplierArtifact(
  database: AppDatabase,
  userId: string,
  intentId: string,
  artifactId: string,
  options: ArtifactServiceOptions = {},
): Promise<ArtifactVault> {
  const intent = await getUserIntent(database, userId, intentId);

  if (!intent) {
    throw new IntentNotFoundError();
  }

  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  const row = mysql
    ? await findSupplierArtifactRowFromMysql(mysql, userId, intent.id, artifactId)
    : findSupplierArtifactRow(database, userId, intent.id, artifactId);

  if (!row) {
    throw new ArtifactVaultValidationError("Artifact is not available.");
  }

  const timestamp = nowIso(options);

  if (mysql) {
    await softDeleteSupplierArtifactRowFromMysql(mysql, userId, intent.id, artifactId, timestamp);
    await writeAuditEventFromMysql(mysql, {
      eventName: "artifact.deleted",
      actorType: "user",
      actorId: userId,
      actorRole: "user",
      targetType: "supplier_artifact",
      targetId: artifactId,
      outcome: "success",
      severity: "info",
      source: "artifact.vault",
      occurredAt: timestamp,
      metadata: {
        intentId: intent.id,
        bidId: intent.bid.id,
        fileName: row.fileName,
        artifactType: row.artifactType,
        purpose: row.purpose,
      },
      beforeAfter: {
        before: { deletedAt: null },
        after: { deletedAt: timestamp, deletedByUserId: userId },
      },
      idempotencyKey: `artifact:${artifactId}:deleted:${timestamp}`,
    });
  } else {
    softDeleteSupplierArtifactRow(database, userId, intent.id, artifactId, timestamp);
    writeAuditEvent(database, {
      eventName: "artifact.deleted",
      actorType: "user",
      actorId: userId,
      actorRole: "user",
      targetType: "supplier_artifact",
      targetId: artifactId,
      outcome: "success",
      severity: "info",
      source: "artifact.vault",
      occurredAt: timestamp,
      metadata: {
        intentId: intent.id,
        bidId: intent.bid.id,
        fileName: row.fileName,
        artifactType: row.artifactType,
        purpose: row.purpose,
      },
      beforeAfter: {
        before: { deletedAt: null },
        after: { deletedAt: timestamp, deletedByUserId: userId },
      },
      idempotencyKey: `artifact:${artifactId}:deleted:${timestamp}`,
    });
  }

  return getArtifactVault(database, userId, intent.id, options);
}
