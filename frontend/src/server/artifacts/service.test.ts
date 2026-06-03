import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createIntentForBid } from "@/server/intents/service";
import {
  ArtifactVaultValidationError,
  createSupplierArtifact,
  getArtifactVault,
} from "./service";

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
      notes: "Use for vendor setup.",
      downloadUrl: `/api/intents/${encodeURIComponent(intent.id)}/artifacts/${encodeURIComponent(vault.artifacts[0].id)}`,
    });
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

  it("rejects empty files and unsupported artifact metadata", async () => {
    const intent = await createIntentForBid(testDb.db, "anon_seed", "1");

    await expect(createSupplierArtifact(testDb.db, "anon_seed", intent.id, {
      title: "",
      artifactType: "unsupported" as never,
      purpose: "compliance_evidence",
      file: new File([""], "empty.pdf", { type: "application/pdf" }),
    }, { storageRoot })).rejects.toBeInstanceOf(ArtifactVaultValidationError);
  });
});
