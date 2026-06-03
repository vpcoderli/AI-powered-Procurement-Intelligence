import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import type { RequestPrincipal } from "@/server/auth/principal";
import * as responseWorkspaceService from "@/server/response-workspace/service";
import { IntentNotFoundError } from "@/server/intents/types";
import type { ResponsePackageExportResponse } from "@/server/response-workspace/types";
import { POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/response-workspace/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/response-workspace/service")>();

  return {
    ...actual,
    createResponsePackageExport: vi.fn(),
  };
});

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const createResponsePackageExport = vi.mocked(responseWorkspaceService.createResponsePackageExport);

const businessPrincipal: RequestPrincipal = {
  kind: "authenticated" as const,
  userId: "user_1",
  role: "user" as const,
  tier: "business" as const,
  features: ["bid_search", "response.workspace.create"],
};

const exportResponse: ResponsePackageExportResponse = {
  exportRecord: {
    id: "response_package_export_1",
    snapshotId: "response_package_snapshot_1",
    intentId: "intent_1",
    bidId: "bid_1",
    userId: "user_1",
    requestedByUserId: "user_1",
    status: "ready",
    fileName: "response-package.md",
    contentType: "text/markdown; charset=utf-8",
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
    updatedAt: "2026-06-01T00:00:00.000Z",
    downloadedAt: null,
  },
};

describe("POST /api/intents/[id]/response-workspace/package/exports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(businessPrincipal);
  });

  it("creates an export for a response package snapshot", async () => {
    createResponsePackageExport.mockResolvedValueOnce(exportResponse);

    const response = await POST(
      new Request("http://localhost/api/intents/intent_1/response-workspace/package/exports", {
        method: "POST",
        body: JSON.stringify({ snapshotId: "response_package_snapshot_1" }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual(exportResponse);
    expect(createResponsePackageExport).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1", {
      snapshotId: "response_package_snapshot_1",
    });
  });

  it("rejects a missing snapshot id", async () => {
    const response = await POST(
      new Request("http://localhost/api/intents/intent_1/response-workspace/package/exports", {
        method: "POST",
        body: JSON.stringify({ snapshotId: "" }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(createResponsePackageExport).not.toHaveBeenCalled();
  });

  it("returns INTENT_NOT_FOUND when the intent is missing", async () => {
    createResponsePackageExport.mockRejectedValueOnce(new IntentNotFoundError());

    const response = await POST(
      new Request("http://localhost/api/intents/missing/response-workspace/package/exports", {
        method: "POST",
        body: JSON.stringify({ snapshotId: "response_package_snapshot_1" }),
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("INTENT_NOT_FOUND");
  });
});
