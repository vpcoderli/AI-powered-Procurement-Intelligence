import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import * as artifactService from "@/server/artifacts/service";
import type { SupplierArtifact } from "@/server/artifacts/types";
import { GET } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/artifacts/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/artifacts/service")>();

  return {
    ...actual,
    getSupplierArtifactFile: vi.fn(),
  };
});

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const getSupplierArtifactFile = vi.mocked(artifactService.getSupplierArtifactFile);

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
      checksumSha256: "abc",
      expiresAt: null,
      reviewStatus: "pending_review",
      computedStatus: "active",
      notes: "",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      downloadUrl: "/api/intents/intent_1/artifacts/artifact_1",
    } satisfies SupplierArtifact);

    const response = await GET(new Request("http://localhost/api/intents/intent_1/artifacts/artifact_1"), {
      params: Promise.resolve({ id: "intent_1", artifactId: "artifact_1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("w9.pdf");
    await expect(response.text()).resolves.toBe("downloadable artifact");
  });
});
