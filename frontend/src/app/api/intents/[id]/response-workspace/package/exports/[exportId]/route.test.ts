import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import type { RequestPrincipal } from "@/server/auth/principal";
import * as responseWorkspaceService from "@/server/response-workspace/service";
import { ResponseWorkspaceValidationError } from "@/server/response-workspace/service";
import type { ResponsePackageExportResponse } from "@/server/response-workspace/types";
import { GET, PATCH } from "./route";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/response-workspace/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/response-workspace/service")>();

  return {
    ...actual,
    getResponsePackageExportFile: vi.fn(),
    markResponsePackageExportDownloaded: vi.fn(),
    updateResponsePackageExportReview: vi.fn(),
  };
});

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const getResponsePackageExportFile = vi.mocked(responseWorkspaceService.getResponsePackageExportFile);
const markResponsePackageExportDownloaded = vi.mocked(responseWorkspaceService.markResponsePackageExportDownloaded);
const updateResponsePackageExportReview = vi.mocked(responseWorkspaceService.updateResponsePackageExportReview);
const readFileMock = vi.mocked(readFile);

const businessPrincipal: RequestPrincipal = {
  kind: "authenticated" as const,
  userId: "user_1",
  role: "user" as const,
  tier: "business" as const,
  features: ["bid_search", "response.workspace.create"],
};

const reviewResponse: ResponsePackageExportResponse = {
  exportRecord: {
    id: "response_package_export_1",
    snapshotId: "response_package_snapshot_1",
    intentId: "intent_1",
    bidId: "bid_1",
    userId: "user_1",
    requestedByUserId: "user_1",
    status: "ready",
    format: "pdf",
    fileName: "response-package.pdf",
    contentType: "application/pdf",
    byteSize: 100,
    checksumSha256: "hash",
    readiness: {
      ready: true,
      totalOutlineSections: 1,
      completedOutlineSections: 1,
      blockedItems: 0,
      artifactPlaceholders: 0,
      artifactPlaceholdersWithLinks: 0,
      missingArtifactLinks: 0,
      openItems: 0,
    },
    downloadUrl: "/api/intents/intent_1/response-workspace/package/exports/response_package_export_1",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-10T14:00:00.000Z",
    downloadedAt: null,
    reviewStatus: "approved",
    reviewedAt: "2026-06-10T14:00:00.000Z",
    reviewedByUserId: "user_1",
    reviewNotes: "Approved",
    reviewHistory: [],
  },
};

describe("GET /api/intents/[id]/response-workspace/package/exports/[exportId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(businessPrincipal);
  });

  it("downloads a generated response package export", async () => {
    const bytes = Buffer.from("# Response package");
    readFileMock.mockResolvedValueOnce(bytes);
    getResponsePackageExportFile.mockResolvedValueOnce({
      id: "response_package_export_1",
      fileName: "response-package.md",
      contentType: "text/markdown; charset=utf-8",
      byteSize: 18,
      storagePath: "data/response-package-exports/response-package.md",
      checksumSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    });

    const response = await GET(
      new Request("http://localhost/api/intents/intent_1/response-workspace/package/exports/response_package_export_1"),
      { params: Promise.resolve({ id: "intent_1", exportId: "response_package_export_1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="response-package.md"');
    expect(await response.text()).toContain("Response package");
    expect(markResponsePackageExportDownloaded).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      "intent_1",
      "response_package_export_1",
    );
  });

  it("downloads a generated zip response package export with zip headers", async () => {
    const bytes = Buffer.from("zip bytes");
    readFileMock.mockResolvedValueOnce(bytes);
    getResponsePackageExportFile.mockResolvedValueOnce({
      id: "response_package_export_zip",
      fileName: "response-package.zip",
      contentType: "application/zip",
      byteSize: bytes.byteLength,
      storagePath: "data/response-package-exports/response-package.zip",
      checksumSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    });

    const response = await GET(
      new Request("http://localhost/api/intents/intent_1/response-workspace/package/exports/response_package_export_zip"),
      { params: Promise.resolve({ id: "intent_1", exportId: "response_package_export_zip" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="response-package.zip"');
    expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).toBe("zip bytes");
    expect(markResponsePackageExportDownloaded).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      "intent_1",
      "response_package_export_zip",
    );
  });

  it("returns EXPORT_NOT_FOUND for missing exports", async () => {
    getResponsePackageExportFile.mockRejectedValueOnce(new ResponseWorkspaceValidationError("Export is not available."));

    const response = await GET(
      new Request("http://localhost/api/intents/intent_1/response-workspace/package/exports/missing"),
      { params: Promise.resolve({ id: "intent_1", exportId: "missing" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("EXPORT_NOT_FOUND");
  });

  it("updates response package export review status", async () => {
    updateResponsePackageExportReview.mockResolvedValueOnce(reviewResponse);

    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1/response-workspace/package/exports/response_package_export_1", {
        method: "PATCH",
        body: JSON.stringify({ reviewStatus: "approved", reviewNotes: "Approved" }),
      }),
      { params: Promise.resolve({ id: "intent_1", exportId: "response_package_export_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(reviewResponse);
    expect(updateResponsePackageExportReview).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      "intent_1",
      "response_package_export_1",
      { reviewStatus: "approved", reviewNotes: "Approved" },
    );
  });

  it("rejects invalid response package export review status", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1/response-workspace/package/exports/response_package_export_1", {
        method: "PATCH",
        body: JSON.stringify({ reviewStatus: "reviewed" }),
      }),
      { params: Promise.resolve({ id: "intent_1", exportId: "response_package_export_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(updateResponsePackageExportReview).not.toHaveBeenCalled();
  });
});
