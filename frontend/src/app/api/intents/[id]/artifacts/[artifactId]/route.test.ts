import crypto from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import * as artifactService from "@/server/artifacts/service";
import type { SupplierArtifact } from "@/server/artifacts/types";
import { DELETE, GET, PUT } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/artifacts/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/artifacts/service")>();

  return {
    ...actual,
    deleteSupplierArtifact: vi.fn(),
    getSupplierArtifactFile: vi.fn(),
    replaceSupplierArtifact: vi.fn(),
  };
});

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const deleteSupplierArtifact = vi.mocked(artifactService.deleteSupplierArtifact);
const getSupplierArtifactFile = vi.mocked(artifactService.getSupplierArtifactFile);
const replaceSupplierArtifact = vi.mocked(artifactService.replaceSupplierArtifact);

describe("GET /api/intents/[id]/artifacts/[artifactId]", () => {
  let directory: string;
  let filePath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await mkdtemp(path.join(os.tmpdir(), "artifact-download-"));
    filePath = path.join(directory, "w9.pdf");
    await writeFile(filePath, "downloadable artifact");
    resolvePrincipal.mockResolvedValue({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "business",
      features: ["artifact.vault.upload"],
    });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("streams a supplier artifact file from local storage", async () => {
    const checksumSha256 = crypto.createHash("sha256").update("downloadable artifact").digest("hex");
    getSupplierArtifactFile.mockResolvedValueOnce({
      id: "artifact_1",
      userId: "user_1",
      intentId: "intent_1",
      bidId: "bid_1",
      title: "Signed W-9",
      artifactType: "w9",
      purpose: "compliance_evidence",
      fileName: "w9.pdf",
      contentType: "application/pdf",
      byteSize: 21,
      storagePath: filePath,
      checksumSha256,
      expiresAt: null,
      reviewStatus: "pending_review",
      computedStatus: "active",
      notes: "",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      downloadUrl: "/api/intents/intent_1/artifacts/artifact_1",
      versions: [],
    } satisfies SupplierArtifact);

    const response = await GET(new Request("http://localhost/api/intents/intent_1/artifacts/artifact_1"), {
      params: Promise.resolve({ id: "intent_1", artifactId: "artifact_1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("w9.pdf");
    await expect(response.text()).resolves.toBe("downloadable artifact");
  });

  it("returns an integrity error when the stored file no longer matches the artifact manifest", async () => {
    getSupplierArtifactFile.mockResolvedValueOnce({
      id: "artifact_1",
      userId: "user_1",
      intentId: "intent_1",
      bidId: "bid_1",
      title: "Signed W-9",
      artifactType: "w9",
      purpose: "compliance_evidence",
      fileName: "w9.pdf",
      contentType: "application/pdf",
      byteSize: 21,
      storagePath: filePath,
      checksumSha256: crypto.createHash("sha256").update("original artifact").digest("hex"),
      expiresAt: null,
      reviewStatus: "pending_review",
      computedStatus: "active",
      notes: "",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      downloadUrl: "/api/intents/intent_1/artifacts/artifact_1",
      versions: [],
    } satisfies SupplierArtifact);

    const response = await GET(new Request("http://localhost/api/intents/intent_1/artifacts/artifact_1"), {
      params: Promise.resolve({ id: "intent_1", artifactId: "artifact_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("ARTIFACT_INTEGRITY_FAILED");
  });
});

describe("PUT /api/intents/[id]/artifacts/[artifactId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "business",
      features: ["artifact.vault.upload"],
    });
  });

  it("replaces a supplier artifact file and returns the refreshed vault", async () => {
    replaceSupplierArtifact.mockResolvedValueOnce({
      intentId: "intent_1",
      bidId: "bid_1",
      userId: "user_1",
      artifacts: [
        {
          id: "artifact_1",
          userId: "user_1",
          intentId: "intent_1",
          bidId: "bid_1",
          title: "Capability statement",
          artifactType: "capability_statement",
          purpose: "response_workspace",
          fileName: "capability-v2.pdf",
          contentType: "application/pdf",
          byteSize: 14,
          storagePath: "/tmp/capability-v2.pdf",
          checksumSha256: "hash_v2",
          expiresAt: null,
          reviewStatus: "pending_review",
          computedStatus: "active",
          securityScanStatus: "clean",
          retentionPolicy: "standard_business_record",
          notes: "Updated file.",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-02T00:00:00.000Z",
          downloadUrl: "/api/intents/intent_1/artifacts/artifact_1",
          versions: [
            {
              id: "artifact_version_1",
              artifactId: "artifact_1",
              versionNumber: 1,
              title: "Capability statement",
              fileName: "capability-v1.pdf",
              contentType: "application/pdf",
              byteSize: 14,
              storagePath: "/tmp/capability-v1.pdf",
              storageProvider: "local",
              checksumSha256: "hash_v1",
              securityScanStatus: "clean",
              retentionPolicy: "standard_business_record",
              replacementReason: "",
              createdByUserId: "user_1",
              createdAt: "2026-06-01T00:00:00.000Z",
            },
            {
              id: "artifact_version_2",
              artifactId: "artifact_1",
              versionNumber: 2,
              title: "Capability statement",
              fileName: "capability-v2.pdf",
              contentType: "application/pdf",
              byteSize: 14,
              storagePath: "/tmp/capability-v2.pdf",
              storageProvider: "local",
              checksumSha256: "hash_v2",
              securityScanStatus: "clean",
              retentionPolicy: "standard_business_record",
              replacementReason: "Updated past performance.",
              createdByUserId: "user_1",
              createdAt: "2026-06-02T00:00:00.000Z",
            },
          ],
        },
      ],
      summary: {
        total: 1,
        active: 1,
        expired: 0,
        pendingReview: 1,
      },
    });
    const form = new FormData();
    form.set("file", new File(["new capability"], "capability-v2.pdf", { type: "application/pdf" }));
    form.set("replacementReason", "Updated past performance.");
    form.set("notes", "Updated file.");

    const response = await PUT(new Request("http://localhost/api/intents/intent_1/artifacts/artifact_1", {
      method: "PUT",
      body: form,
    }), {
      params: Promise.resolve({ id: "intent_1", artifactId: "artifact_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(replaceSupplierArtifact).toHaveBeenCalledWith(
      {},
      "user_1",
      "intent_1",
      "artifact_1",
      expect.objectContaining({
        replacementReason: "Updated past performance.",
        notes: "Updated file.",
        file: expect.any(File),
      }),
    );
    expect(body.vault.artifacts[0].versions).toHaveLength(2);
  });
});

describe("DELETE /api/intents/[id]/artifacts/[artifactId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "business",
      features: ["artifact.vault.upload"],
    });
  });

  it("soft deletes a supplier artifact and returns the refreshed vault", async () => {
    deleteSupplierArtifact.mockResolvedValueOnce({
      intentId: "intent_1",
      bidId: "bid_1",
      artifacts: [],
      summary: {
        total: 0,
        active: 0,
        expired: 0,
        pendingReview: 0,
      },
    });

    const response = await DELETE(new Request("http://localhost/api/intents/intent_1/artifacts/artifact_1"), {
      params: Promise.resolve({ id: "intent_1", artifactId: "artifact_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(deleteSupplierArtifact).toHaveBeenCalledWith({}, "user_1", "intent_1", "artifact_1");
    expect(body).toEqual({
      vault: {
        intentId: "intent_1",
        bidId: "bid_1",
        artifacts: [],
        summary: {
          total: 0,
          active: 0,
          expired: 0,
          pendingReview: 0,
        },
      },
    });
  });
});
