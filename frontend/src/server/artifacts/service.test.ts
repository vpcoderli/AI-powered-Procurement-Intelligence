import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createIntentForBid } from "@/server/intents/service";
import {
  ArtifactVaultValidationError,
  createSupplierArtifact,
  deleteSupplierArtifact,
  getArtifactVault,
  replaceSupplierArtifact,
} from "./service";

const objectStorageEnvKeys = [
  "OBJECT_STORAGE_PROVIDER",
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_REGION",
  "OBJECT_STORAGE_BASE_URL",
  "OBJECT_STORAGE_CREDENTIALS_REF",
] as const;

function setObjectStorageEnv(values: Record<typeof objectStorageEnvKeys[number], string>) {
  const previous = new Map<string, string | undefined>();

  for (const key of objectStorageEnvKeys) {
    previous.set(key, process.env[key]);
    process.env[key] = values[key];
  }

  return () => {
    for (const key of objectStorageEnvKeys) {
      const oldValue = previous.get(key);
      if (oldValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = oldValue;
      }
    }
  };
}

describe("artifact vault service", () => {
  let testDb: TestDatabase;
  let storageRoot: string;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: true });
    storageRoot = await mkdtemp(path.join(os.tmpdir(), "artifact-vault-"));
  });

  afterEach(async () => {
    await testDb.cleanup();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("stores a supplier artifact for an intent and lists it with computed status", async () => {
    const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
    const file = new File(["signed w9 content"], " W-9 Form.pdf ", { type: "application/pdf" });

    const vault = await createSupplierArtifact(testDb.db, "anon_seed", intent.id, {
      title: "  Signed W-9  ",
      artifactType: "w9",
      purpose: "compliance_evidence",
      expiresAt: "2027-01-01T00:00:00.000Z",
      notes: "Use for vendor setup.",
      file,
    }, { storageRoot, now: new Date("2026-06-01T00:00:00.000Z") });

    expect(vault.summary).toEqual({
      total: 1,
      active: 1,
      expired: 0,
      pendingReview: 1,
    });
    expect(vault.artifacts[0]).toMatchObject({
      userId: "anon_seed",
      intentId: intent.id,
      bidId: intent.bid.id,
      title: "Signed W-9",
      artifactType: "w9",
      purpose: "compliance_evidence",
      fileName: "W-9 Form.pdf",
      contentType: "application/pdf",
      byteSize: 17,
      reviewStatus: "pending_review",
      computedStatus: "active",
      securityScanStatus: "clean",
      retentionPolicy: "standard_business_record",
      notes: "Use for vendor setup.",
      downloadUrl: `/api/intents/${encodeURIComponent(intent.id)}/artifacts/${encodeURIComponent(vault.artifacts[0].id)}`,
    });
    expect(vault.artifacts[0].versions).toEqual([
      expect.objectContaining({
        versionNumber: 1,
        fileName: "W-9 Form.pdf",
        byteSize: 17,
        storageProvider: "local",
        securityScanStatus: "clean",
        retentionPolicy: "standard_business_record",
        replacementReason: "",
      }),
    ]);
    await expect(readFile(vault.artifacts[0].storagePath, "utf8")).resolves.toBe("signed w9 content");

    await expect(
      getArtifactVault(testDb.db, "anon_seed", intent.id, { now: new Date("2028-01-01T00:00:00.000Z") }),
    ).resolves.toMatchObject({
      summary: {
        total: 1,
        active: 0,
        expired: 1,
        pendingReview: 1,
      },
      artifacts: [expect.objectContaining({ computedStatus: "expired" })],
    });
  });

  it("fails closed instead of writing local artifacts when S3-compatible credentials are not injected", async () => {
    const restoreEnv = setObjectStorageEnv({
      OBJECT_STORAGE_PROVIDER: "s3",
      OBJECT_STORAGE_BUCKET: "prod-artifacts",
      OBJECT_STORAGE_REGION: "us-east-1",
      OBJECT_STORAGE_BASE_URL: "https://s3.us-east-1.amazonaws.com",
      OBJECT_STORAGE_CREDENTIALS_REF: "aws-secrets-manager:prod/object-storage",
    });

    try {
      const intent = await createIntentForBid(testDb.db, "anon_seed", "1");

      await expect(createSupplierArtifact(testDb.db, "anon_seed", intent.id, {
        title: "Signed W-9",
        artifactType: "w9",
        purpose: "compliance_evidence",
        file: new File(["signed w9 content"], "w9.pdf", { type: "application/pdf" }),
      }, { storageRoot })).rejects.toThrow(/OBJECT_STORAGE_ACCESS_KEY_ID and OBJECT_STORAGE_SECRET_ACCESS_KEY are required/);
      await expect(readdir(storageRoot)).resolves.toEqual([]);
    } finally {
      restoreEnv();
    }
  });

  it("blocks uploads with deterministic malware test signatures before storage or artifact rows are written", async () => {
    const intent = await createIntentForBid(testDb.db, "anon_seed", "1");

    await expect(createSupplierArtifact(testDb.db, "anon_seed", intent.id, {
      title: "Suspicious capability statement",
      artifactType: "capability_statement",
      purpose: "business_profile",
      file: new File(["hello MALWARE_TEST_SIGNATURE world"], "capability.pdf", { type: "application/pdf" }),
    }, { storageRoot })).rejects.toThrow(/blocked by malware scan/i);

    await expect(readdir(storageRoot)).resolves.toEqual([]);
    await expect(getArtifactVault(testDb.db, "anon_seed", intent.id)).resolves.toMatchObject({
      summary: {
        total: 0,
        active: 0,
        expired: 0,
        pendingReview: 0,
      },
      artifacts: [],
    });
  });

  it("replaces an artifact file while preserving version history", async () => {
    const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
    const created = await createSupplierArtifact(testDb.db, "anon_seed", intent.id, {
      title: "Capability statement",
      artifactType: "capability_statement",
      purpose: "response_workspace",
      file: new File(["old capability"], "capability-v1.pdf", { type: "application/pdf" }),
      notes: "Initial upload.",
    }, { storageRoot, now: new Date("2026-06-01T00:00:00.000Z") });
    const artifactId = created.artifacts[0].id;

    const replaced = await replaceSupplierArtifact(testDb.db, "anon_seed", intent.id, artifactId, {
      file: new File(["new capability"], "capability-v2.pdf", { type: "application/pdf" }),
      replacementReason: "Updated past performance page.",
      notes: "Ready for response package.",
    }, { storageRoot, now: new Date("2026-06-02T00:00:00.000Z") });
    const artifact = replaced.artifacts[0];
    const event = testDb.db.$client
      .prepare("SELECT event_name, target_id, metadata_json FROM event_log WHERE event_name = ?")
      .get("artifact.replaced") as { event_name: string; target_id: string; metadata_json: string };

    expect(artifact).toMatchObject({
      id: artifactId,
      fileName: "capability-v2.pdf",
      byteSize: 14,
      notes: "Ready for response package.",
      updatedAt: "2026-06-02T00:00:00.000Z",
    });
    expect(artifact.versions).toEqual([
      expect.objectContaining({
        versionNumber: 1,
        fileName: "capability-v1.pdf",
        byteSize: 14,
        replacementReason: "",
        createdAt: "2026-06-01T00:00:00.000Z",
      }),
      expect.objectContaining({
        versionNumber: 2,
        fileName: "capability-v2.pdf",
        byteSize: 14,
        replacementReason: "Updated past performance page.",
        createdAt: "2026-06-02T00:00:00.000Z",
      }),
    ]);
    await expect(readFile(artifact.storagePath, "utf8")).resolves.toBe("new capability");
    expect(event).toEqual(expect.objectContaining({
      event_name: "artifact.replaced",
      target_id: artifactId,
    }));
    expect(JSON.parse(event.metadata_json)).toEqual(expect.objectContaining({
      intentId: intent.id,
      bidId: intent.bid.id,
      versionNumber: 2,
      hasReplacementReason: true,
    }));
  });

  it("blocks artifact replacements with malware signatures before changing the current artifact", async () => {
    const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
    const created = await createSupplierArtifact(testDb.db, "anon_seed", intent.id, {
      title: "Capability statement",
      artifactType: "capability_statement",
      purpose: "response_workspace",
      file: new File(["old capability"], "capability-v1.pdf", { type: "application/pdf" }),
    }, { storageRoot, now: new Date("2026-06-01T00:00:00.000Z") });
    const artifactId = created.artifacts[0].id;

    await expect(replaceSupplierArtifact(testDb.db, "anon_seed", intent.id, artifactId, {
      file: new File(["EICAR-STANDARD-ANTIVIRUS-TEST-FILE"], "bad.pdf", { type: "application/pdf" }),
      replacementReason: "Bad replacement.",
    }, { storageRoot, now: new Date("2026-06-02T00:00:00.000Z") })).rejects.toThrow(/replacement blocked by malware scan/i);

    await expect(getArtifactVault(testDb.db, "anon_seed", intent.id)).resolves.toMatchObject({
      artifacts: [
        expect.objectContaining({
          id: artifactId,
          fileName: "capability-v1.pdf",
          versions: [expect.objectContaining({ versionNumber: 1 })],
        }),
      ],
    });
  });

  it("rejects empty files and unsupported artifact metadata", async () => {
    const intent = await createIntentForBid(testDb.db, "anon_seed", "1");

    await expect(createSupplierArtifact(testDb.db, "anon_seed", intent.id, {
      title: "",
      artifactType: "unsupported" as never,
      purpose: "compliance_evidence",
      file: new File([""], "empty.pdf", { type: "application/pdf" }),
    }, { storageRoot })).rejects.toBeInstanceOf(ArtifactVaultValidationError);
  });

  it("soft deletes supplier artifacts, excludes them from the active vault, and writes an audit event", async () => {
    const intent = await createIntentForBid(testDb.db, "anon_seed", "1");
    const file = new File(["signed w9 content"], "w9.pdf", { type: "application/pdf" });
    const created = await createSupplierArtifact(testDb.db, "anon_seed", intent.id, {
      title: "Signed W-9",
      artifactType: "w9",
      purpose: "compliance_evidence",
      file,
    }, { storageRoot, now: new Date("2026-06-01T00:00:00.000Z") });

    await deleteSupplierArtifact(testDb.db, "anon_seed", intent.id, created.artifacts[0].id, {
      now: new Date("2026-06-02T00:00:00.000Z"),
    });

    const vault = await getArtifactVault(testDb.db, "anon_seed", intent.id);
    const event = testDb.db.$client
      .prepare("SELECT event_name, actor_id, target_type, target_id, metadata_json FROM event_log WHERE event_name = ?")
      .get("artifact.deleted") as {
        event_name: string;
        actor_id: string;
        target_type: string;
        target_id: string;
        metadata_json: string;
      };

    expect(vault.artifacts).toHaveLength(0);
    expect(event).toEqual(expect.objectContaining({
      event_name: "artifact.deleted",
      actor_id: "anon_seed",
      target_type: "supplier_artifact",
      target_id: created.artifacts[0].id,
    }));
    expect(JSON.parse(event.metadata_json)).toEqual(expect.objectContaining({
      intentId: intent.id,
      bidId: intent.bid.id,
      fileName: "w9.pdf",
    }));
  });
});
