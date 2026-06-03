import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { getUserIntent } from "@/server/intents/service";
import { IntentNotFoundError } from "@/server/intents/types";
import {
  createSupplierArtifactRow,
  createSupplierArtifactRowFromMysql,
  findSupplierArtifactRow,
  findSupplierArtifactRowFromMysql,
  listSupplierArtifactRows,
  listSupplierArtifactRowsFromMysql,
  type SupplierArtifactRow,
} from "./repository";
import {
  isArtifactPurpose,
  isArtifactReviewStatus,
  isArtifactType,
  type ArtifactComputedStatus,
  type ArtifactVault,
  type CreateSupplierArtifactInput,
  type SupplierArtifact,
} from "./types";

const MAX_TITLE_LENGTH = 180;
const MAX_NOTES_LENGTH = 2000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

export class ArtifactVaultValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactVaultValidationError";
  }
}

interface ArtifactServiceOptions {
  storageRoot?: string;
  now?: Date;
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
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    downloadUrl: downloadUrl(row.intentId, row.id),
  };
}

function buildVault(userId: string, intentId: string, bidId: string, rows: SupplierArtifactRow[], now: Date): ArtifactVault {
  const artifacts = rows.map((row) => hydrateArtifact(row, now));

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

  return buildVault(userId, intent.id, intent.bid.id, await listRows(database, userId, intent.id), options.now ?? new Date());
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
  const checksumSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const fileName = sanitizeFileName(input.file.name);
  const storageDirectory = path.join(artifactStorageRoot(options), userId, intent.id);
  const storagePath = path.join(storageDirectory, `${id}-${fileName}`);

  await mkdir(storageDirectory, { recursive: true });
  await writeFile(storagePath, bytes);

  const row = {
    id,
    intentId: intent.id,
    bidId: intent.bid.id,
    userId,
    title,
    artifactType: input.artifactType,
    purpose: input.purpose,
    fileName,
    contentType: input.file.type || "application/octet-stream",
    byteSize: input.file.size,
    storagePath,
    checksumSha256,
    expiresAt: normalizeExpiresAt(input.expiresAt),
    reviewStatus: "pending_review",
    notes: normalizeOptionalText(input.notes, "Artifact notes", MAX_NOTES_LENGTH),
    createdAt: timestamp,
    updatedAt: timestamp,
  } satisfies SupplierArtifactRow;

  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
  if (mysql) {
    await createSupplierArtifactRowFromMysql(mysql, row);
  } else {
    createSupplierArtifactRow(database, row);
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
